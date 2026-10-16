/**
 * The Deepgram engine: the same path as the desktop's `deepgram-live` plugin.
 * Two sockets go from the phone to Deepgram. The listening model hears the
 * user and says when the turn ends; Aura speaks. The Deepgram key stays on
 * the Hermes host: each socket opens with a 30 second token from
 * `POST /api/plugins/deepgram-live/auth`.
 */

import type { HermesApi } from '@/core/api'
import {
  advanceTurn,
  type DeepgramSettings,
  EchoMemory,
  flushWait,
  listenUrl,
  NEW_TURN,
  OUTPUT_SAMPLE_RATE,
  PLAYBACK_TAIL_MS,
  SentenceFeed,
  speakableLine,
  speakParts,
  speakUrl,
  type TurnInfo,
  type UserTurn
} from '@/core/live-voice'
import { duplexAudio } from '@/native/duplex-audio'

import { type EngineEvents, SampleJoiner, trace, type VoiceEngine } from './voice-engine'

const PLUGIN = '/api/plugins/deepgram-live'
const SOCKET_OPEN_TIMEOUT_MS = 10_000
const LISTEN_RETRIES = 2
// Deepgram answers a Clear with Cleared. Without that answer, sound is let through again after this long.
const CLEAR_WAIT_MS = 1500

/** The plugin's settings, or the reason the engine cannot run on this host. */
export async function deepgramStatus(api: HermesApi): Promise<DeepgramSettings | null> {
  try {
    const settings = await api.request<DeepgramSettings>({ path: `${PLUGIN}/status`, timeoutMs: 8000 })

    return settings?.available ? settings : null
  } catch {
    // A host without the plugin answers 404.
    return null
  }
}

/** Tell the agent half that this turn was spoken, so the answer comes back as plain sentences. */
export function announceSpokenTurn(api: HermesApi, text: string): Promise<unknown> {
  return api.request({ path: `${PLUGIN}/turn`, method: 'POST', body: { text }, timeoutMs: 5000 }).catch(() => undefined)
}

export class DeepgramEngine implements VoiceEngine {
  readonly name = 'deepgram' as const

  private active = false
  private listen: WebSocket | null = null
  private speak: WebSocket | null = null
  private speakOpening: Promise<WebSocket> | null = null
  private listenRetries = 0
  private playing = false
  private playbackEndedAt = 0
  private pendingFlushes = 0
  private lastFlushAt = 0
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private unflushed = false
  private said = 0
  /** Sound that was on its way when the voice was stopped is dropped until Deepgram confirms the stop. */
  private dropUntil = 0
  private turn: UserTurn = NEW_TURN
  private readonly sentences = new SentenceFeed()
  private readonly echo = new EchoMemory()
  private readonly samples = new SampleJoiner()

  constructor(
    private readonly api: HermesApi,
    private readonly settings: DeepgramSettings,
    private readonly events: EngineEvents
  ) {}

  async start(): Promise<void> {
    this.active = true
    await Promise.all([this.openListen(), this.ensureSpeak()])
  }

  stop(): void {
    this.active = false

    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    send(this.listen, JSON.stringify({ type: 'CloseStream' }))
    send(this.speak, JSON.stringify({ type: 'Close' }))
    this.listen?.close()
    this.speak?.close()
    this.listen = null
    this.speak = null
    this.speakOpening = null
    this.sentences.clear()
    this.pendingFlushes = 0
    this.playing = false
  }

  frame(pcm: Uint8Array): void {
    if (this.listen?.readyState === WebSocket.OPEN) {
      this.listen.send(pcm)
    }
  }

  playback(playing: boolean): void {
    if (playing === this.playing) {
      return
    }

    trace(`playback ${playing}`)

    this.playing = playing

    if (!playing) {
      this.playbackEndedAt = Date.now()
      this.echo.quiet(this.playbackEndedAt)
    }

    this.events.changed()
  }

  speaking(): boolean {
    return this.playing || this.pendingFlushes > 0
  }

  audible(): boolean {
    return this.playing || Date.now() - this.playbackEndedAt < PLAYBACK_TAIL_MS
  }

  lastSayAt(): number {
    return this.said
  }

  finishTurn(): void {
    // The listening model decides when a turn ends.
  }

  feed(text: string, final = false): void {
    for (const line of this.sentences.feed(text, final)) {
      this.say(line)
    }
  }

  endReply(): void {
    this.feed('', true)
  }

  say(text: string): void {
    const line = speakableLine(text)

    if (!line || !this.active) {
      return
    }

    this.said = Date.now()
    this.echo.remember(line, this.said)

    void this.ensureSpeak()
      .then(socket => {
        for (const part of speakParts(line)) {
          socket.send(JSON.stringify({ text: part, type: 'Speak' }))
        }

        this.unflushed = true
        this.scheduleFlush()
      })
      .catch(error => this.events.lost(`The voice did not connect: ${message(error)}`))
  }

  hush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    this.unflushed = false
    this.sentences.clear()
    if (this.speak?.readyState === WebSocket.OPEN) {
      this.speak.send(JSON.stringify({ type: 'Clear' }))
      this.dropUntil = Date.now() + CLEAR_WAIT_MS
    }

    this.samples.reset()
    duplexAudio?.clear()
    this.pendingFlushes = 0
    this.events.changed()
  }

  // ── sockets ──────────────────────────────────────────────────────────────────────────────────

  private async openSocket(url: string): Promise<WebSocket> {
    const auth = await this.api.request<{ scheme: string; value: string }>({ path: `${PLUGIN}/auth`, method: 'POST', timeoutMs: 15_000 })
    const socket = new WebSocket(url, [auth.scheme, auth.value])

    socket.binaryType = 'arraybuffer'

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Deepgram connection timed out')), SOCKET_OPEN_TIMEOUT_MS)

      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error('Deepgram connection failed'))
      }
    })

    socket.onerror = null

    return socket
  }

  private async openListen(): Promise<void> {
    const socket = await this.openSocket(listenUrl(this.settings))

    if (!this.active) {
      socket.close()

      return
    }

    socket.onmessage = event => {
      if (typeof event.data === 'string') {
        this.onListenMessage(event.data)
      }
    }
    socket.onclose = () => {
      if (this.listen === socket && this.active) {
        this.listen = null
        void this.reopenListen()
      }
    }
    this.listen = socket
    this.listenRetries = 0
  }

  private async reopenListen(): Promise<void> {
    if (this.listenRetries >= LISTEN_RETRIES) {
      this.events.lost('Live voice lost its connection to Deepgram.')

      return
    }

    this.listenRetries += 1

    try {
      await this.openListen()
    } catch {
      void this.reopenListen()
    }
  }

  /** The speak socket opens on demand: Deepgram closes it when idle, and an answer can come long after the last one. */
  private ensureSpeak(): Promise<WebSocket> {
    if (this.speak?.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.speak)
    }

    this.speakOpening ??= this.openSocket(speakUrl(this.settings))
      .then(socket => {
        if (!this.active) {
          socket.close()

          throw new Error('Live voice ended')
        }

        socket.onmessage = event => this.onSpeakMessage(event.data)
        socket.onclose = () => {
          if (this.speak === socket) {
            this.speak = null
            this.pendingFlushes = 0
            this.events.changed()
          }
        }
        this.speak = socket

        return socket
      })
      .finally(() => {
        this.speakOpening = null
      })

    return this.speakOpening
  }

  private onSpeakMessage(data: unknown): void {
    if (typeof data !== 'string') {
      const pcm = Date.now() < this.dropUntil ? null : this.samples.push(data as ArrayBuffer)

      if (pcm && this.active) {
        duplexAudio?.play(pcm, OUTPUT_SAMPLE_RATE)
      }

      return
    }

    const parsed = parse(data)

    if (parsed?.type === 'Flushed') {
      this.pendingFlushes = Math.max(0, this.pendingFlushes - 1)
      this.events.changed()
    } else if (parsed?.type === 'Cleared') {
      this.dropUntil = 0
      this.pendingFlushes = 0
      this.events.changed()
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer || !this.unflushed) {
      return
    }

    const wait = flushWait(this.lastFlushAt, Date.now())

    if (wait > 0) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        this.scheduleFlush()
      }, wait)

      return
    }

    if (this.speak?.readyState !== WebSocket.OPEN) {
      return
    }

    this.speak.send(JSON.stringify({ type: 'Flush' }))
    this.unflushed = false
    this.lastFlushAt = Date.now()
    this.pendingFlushes += 1
    this.events.changed()
  }

  // ── hearing ──────────────────────────────────────────────────────────────────────────────────

  private onListenMessage(raw: string): void {
    const info = parse(raw) as (TurnInfo & { type?: string }) | null

    if (info?.type !== 'TurnInfo') {
      return
    }

    const now = Date.now()
    const step = advanceTurn(this.turn, info, this.audible(), {
      isEcho: transcript => this.echo.isEcho(transcript, now),
      unsaid: transcript => this.echo.unsaid(transcript, now)
    })
    const turn = this.turn

    trace(`${info.event} audible=${this.audible()} hush=${step.hush} barged=${step.turn.barged} "${String(info.transcript ?? '').slice(-60)}"`)
    this.turn = step.turn

    if (step.hush) {
      this.hush()
      this.events.barge()
    }

    if (info.event === 'EndOfTurn') {
      this.events.utterance(step.utterance ?? '', turn)

      return
    }

    if (step.hearing) {
      this.events.hearing()
    }

    if (step.partial) {
      this.events.partial(step.partial)
    }
  }
}

function send(socket: WebSocket | null, text: string): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(text)
  }
}

function parse(text: string): { type?: string } | null {
  try {
    return JSON.parse(text) as { type?: string }
  } catch {
    return null
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
