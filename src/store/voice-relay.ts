/**
 * The relay engine: Hermes's own speech providers, on the Hermes host. It
 * works with every provider the host has, also one that runs only there.
 *
 * Ears: the phone decides when the user's turn ends (from the level of the
 * microphone). With live speech-to-text on the host (`stt.streaming`), the
 * frames go to `/api/audio/transcribe-stream` while the user talks and the
 * words come back at once. Without it, the frames of one turn go to
 * `POST /api/audio/transcribe` as one recording.
 *
 * Mouth: `/api/audio/speak-stream`. The text of the answer goes in while it
 * streams; the host cuts sentences and sends PCM back.
 */

import type { HermesApi } from '@/core/api'
import { bytesBase64, EchoMemory, pcmBytes, FRAME_MS, INPUT_SAMPLE_RATE, PLAYBACK_TAIL_MS, SentenceFeed, speakableLine, type UserTurn, wavFile } from '@/core/live-voice'
import { advanceListen, audioExtension, dataUrlParts, type Listen, NEW_LISTEN } from '@/core/voice'
import { duplexAudio } from '@/native/duplex-audio'

import { openSiblingSocket } from './link'
import { type EngineEvents, SampleJoiner, trace, type VoiceEngine } from './voice-engine'

// The native level is the loudness of one frame, 0 to 1. A quiet room is under 0.03.
const SPEECH_LEVEL = 0.07
// Over the voice, only a clear voice near the phone counts: what is left of the speaker after echo cancellation is quieter.
const BARGE_LEVEL = 0.22
const START_MS = 160
const BARGE_MS = 320
// A pause inside a sentence is shorter than this.
const END_QUIET_MS = 900
// With live words, a sentence that reads complete needs less quiet to end the turn.
const END_QUIET_SENTENCE_MS = 550
// A sound that never became speech is dropped after this much quiet.
const NOISE_QUIET_MS = 700
const PREROLL_FRAMES = 6
/**
 * A dictation keeps three seconds: the person tapped to talk, so all of it is
 * theirs. A first word said softly is under the level that starts a turn, and
 * the turn then starts at the second or third word.
 */
export const DICTATION_PREROLL_FRAMES = 38
// The host cuts a sentence when white space follows it. A sentence with nothing after it for this long is said now.
const SENTENCE_FLUSH_MS = 150
/** After text goes to the voice, sound is expected for this long. */
const SOUND_EXPECTED_MS = 2500

interface Reply {
  socket: WebSocket | null
  /** Frames that wait for the socket to open. */
  queue: string[]
  rate: number
  /** All the text given to this reply, for the other path when the host sends no sound. */
  text: string
  /** The text is complete. The sound of it may still come. */
  closed: boolean
  /** The user stopped this reply. Its sound is dropped. */
  hushed: boolean
  /** Sound has come for this reply. */
  heard: boolean
}

export class RelayEngine implements VoiceEngine {
  readonly name = 'relay' as const

  private active = false
  private playing = false
  private playbackEndedAt = 0
  private said = 0
  private soundTimer: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null

  private preroll: Uint8Array[] = []
  private frames: Uint8Array[] | null = null
  private listen: Listen = NEW_LISTEN
  private loudRun = 0
  private turn: UserTurn = { duringPlayback: false, barged: false }
  private finishNow = false
  private busy = false
  private stream: WebSocket | null = null
  /** Live sessions in a row that the host refused. One refusal may be a slow provider; two means the host has no live words. */
  private streamRefusals = 0
  /** The live words read as a whole sentence. */
  private sentenceHeard = false
  private streamFinal: ((text: string | null) => void) | null = null

  private reply: Reply | null = null
  /**
   * The host's stream gave no sound (its speech provider writes a file the
   * host could not decode). The phone then cuts the sentences and asks for
   * each one with `POST /api/audio/speak`, as the desktop does.
   */
  private bySentence = false
  private readonly sentences = new SentenceFeed()
  private waiting: string[] = []
  private working = false
  private spoken = 0
  private readonly lines = new SentenceFeed()
  private readonly echo = new EchoMemory()
  private readonly samples = new SampleJoiner()

  constructor(
    private readonly api: HermesApi,
    private liveStt: boolean,
    private readonly events: EngineEvents,
    /** How many frames from before the start of a turn go with it. */
    private readonly prerollFrames = PREROLL_FRAMES
  ) {}

  async start(): Promise<void> {
    this.active = true
  }

  stop(): void {
    this.active = false
    this.frames = null
    this.preroll = []
    this.stream?.close()
    this.stream = null
    this.streamFinal?.(null)
    this.closeReply(true)

    if (this.soundTimer) {
      clearTimeout(this.soundTimer)
      this.soundTimer = null
    }
  }

  private cancelFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
  }

  playback(playing: boolean): void {
    if (playing === this.playing) {
      return
    }

    this.playing = playing

    if (!playing) {
      this.playbackEndedAt = Date.now()
    }

    this.events.changed()
  }

  speaking(): boolean {
    return this.playing || this.working || (Boolean(this.reply) && Date.now() - this.said < SOUND_EXPECTED_MS)
  }

  audible(): boolean {
    return this.playing || Date.now() - this.playbackEndedAt < PLAYBACK_TAIL_MS
  }

  /** Nothing plays and nothing more comes: all that was given to the voice has been said. */
  quiet(): boolean {
    return !this.playing && !this.working && !this.reply && !this.waiting.length
  }

  lastSayAt(): number {
    return this.said
  }

  finishTurn(): void {
    this.finishNow = true
  }

  // ── hearing ──────────────────────────────────────────────────────────────────────────────────

  frame(pcm: Uint8Array, level: number): void {
    if (!this.active || this.busy) {
      return
    }

    if (!this.frames) {
      this.preroll.push(pcm)

      if (this.preroll.length > this.prerollFrames) {
        this.preroll.shift()
      }

      const audible = this.audible()

      this.loudRun = level > (audible ? BARGE_LEVEL : SPEECH_LEVEL) ? this.loudRun + FRAME_MS : 0

      if (this.loudRun >= (audible ? BARGE_MS : START_MS)) {
        this.begin(audible)
      }

      return
    }

    this.frames.push(pcm)

    if (this.stream?.readyState === WebSocket.OPEN) {
      this.stream.send(pcm)
    }

    // The level as decibels: 0 is the loudest.
    const step = advanceListen(this.listen, 20 * Math.log10(Math.max(level, 0.0001) / 6), FRAME_MS, this.sentenceHeard ? END_QUIET_SENTENCE_MS : END_QUIET_MS)

    this.listen = step.listen

    if (step.done || (this.finishNow && this.listen.totalMs > 300)) {
      void this.end()
    } else if (!this.listen.spoke && this.listen.quietMs >= NOISE_QUIET_MS) {
      this.cancel()
    }
  }

  private begin(audible: boolean): void {
    this.turn = { duringPlayback: audible, barged: audible }
    this.frames = [...this.preroll]
    this.preroll = []
    this.listen = { ...NEW_LISTEN, loudMs: this.loudRun, totalMs: this.loudRun }
    this.loudRun = 0
    this.finishNow = false
    this.sentenceHeard = false

    if (audible) {
      this.hush()
      this.events.barge()
    }

    this.events.hearing()

    if (this.liveStt) {
      void this.openStream(this.frames)
    }
  }

  private cancel(): void {
    const turn = this.turn

    this.frames = null
    this.stream?.close()
    this.stream = null
    this.events.utterance('', turn)
  }

  private async end(): Promise<void> {
    const frames = this.frames ?? []
    const turn = this.turn

    this.frames = null
    this.busy = true
    this.events.transcribing()

    try {
      let words = await this.finishStream()

      words ??= await this.transcribe(frames)

      if (!this.active) {
        return
      }

      // A turn that began under the voice may be the voice itself.
      const said = turn.duringPlayback && this.echo.isEcho(words, Date.now()) ? '' : words

      this.events.utterance(said, turn)

      if (said && this.active && !this.bySentence) {
        // Dial the voice now, while the agent thinks: the first sentence then has no wait for a socket.
        this.reply ??= this.openReply()
      }
    } catch (error) {
      this.events.utterance('', turn)
      this.events.lost(error instanceof Error ? error.message : String(error))
    } finally {
      this.busy = false
    }
  }

  private async openStream(backlog: readonly Uint8Array[]): Promise<void> {
    try {
      const socket = await openSiblingSocket('/api/audio/transcribe-stream')

      this.stream = socket
      socket.onopen = () => {
        socket.send(JSON.stringify({ sample_rate: INPUT_SAMPLE_RATE }))
        // The frames from before the socket opened, with those that came while it dialled.
        ;(this.frames ?? backlog).forEach(frame => socket.send(frame))
      }
      socket.onmessage = event => {
        const data = parse(String(event.data))

        if (data?.type === 'partial' && typeof data.text === 'string') {
          this.streamRefusals = 0
          this.sentenceHeard = /[.?!]$/.test(data.text.trim())
          this.events.partial(data.text)
        } else if (data?.type === 'final') {
          this.streamFinal?.(String(data.transcript ?? '').trim())
        } else if (data?.type === 'error') {
          // The recording path takes over for this turn, and for the rest of the call when the host refuses again.
          trace(`transcribe-stream error ${String((data as { message?: unknown }).message ?? '')}`)
          this.streamRefusals += 1
          this.liveStt = this.streamRefusals < 2

          if (this.stream === socket) {
            this.stream = null
          }

          socket.close()
          this.streamFinal?.(null)
        }
      }
      socket.onclose = () => {
        if (this.stream === socket) {
          this.stream = null
        }

        this.streamFinal?.(null)
      }
    } catch {
      this.liveStt = false
    }
  }

  /** The words from the live socket, or null when there is none (the recording path then runs). */
  private finishStream(): Promise<string | null> {
    const socket = this.stream

    if (!socket || socket.readyState !== WebSocket.OPEN || !this.liveStt) {
      trace(`transcribe-stream not ready ${socket?.readyState ?? 'none'}`)
      socket?.close()
      this.stream = null

      return Promise.resolve(null)
    }

    return new Promise(resolve => {
      const timer = setTimeout(() => this.streamFinal?.(null), 15_000)

      this.streamFinal = text => {
        clearTimeout(timer)
        this.streamFinal = null
        this.stream = null
        socket.close()
        resolve(text)
      }
      socket.send(JSON.stringify({ eos: true }))
    })
  }

  private async transcribe(frames: readonly Uint8Array[]): Promise<string> {
    const result = await this.api.request<{ transcript?: string }>({
      path: '/api/audio/transcribe',
      method: 'POST',
      body: { data_url: `data:audio/wav;base64,${bytesBase64(wavFile(frames, INPUT_SAMPLE_RATE))}`, mime_type: 'audio/wav' },
      timeoutMs: 60_000
    })

    return (result.transcript ?? '').trim()
  }

  // ── speaking ─────────────────────────────────────────────────────────────────────────────────

  feed(text: string, final = false): void {
    if (!this.active) {
      return
    }

    for (const line of this.lines.feed(text, final)) {
      this.echo.remember(speakableLine(line), Date.now())
    }

    if (this.bySentence) {
      return this.speakLines(this.sentences.feed(text, final))
    }

    // The host cuts sentences at white space. A finished thought gets a line end, so it is said now.
    const out = text + (final && this.reply ? '\n' : '')

    if (out) {
      this.cancelFlush()
      this.send({ text: out })

      // Not after a digit: "3." may be the start of "3.14".
      if (/[^\d\s][.?!]["')\]]?$/.test(out)) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null

          if (this.active && this.reply && !this.reply.closed) {
            this.send({ text: '\n' })
          }
        }, SENTENCE_FLUSH_MS)
      }
    }
  }

  endReply(): void {
    this.feed('', true)

    if (this.reply && !this.bySentence) {
      this.send({ done: true })
      this.reply.closed = true
    }
  }

  say(line: string): void {
    const alone = !this.reply || this.reply.closed

    this.echo.remember(speakableLine(line), Date.now())

    if (this.bySentence) {
      return this.speakLines([line])
    }

    this.send({ text: `${line}\n` })

    if (alone) {
      this.send({ done: true })

      if (this.reply) {
        this.reply.closed = true
      }
    }
  }

  hush(): void {
    this.lines.clear()
    this.sentences.clear()
    this.waiting = []
    this.spoken += 1
    this.working = false
    this.closeReply(true)
    this.samples.reset()
    duplexAudio?.clear()
    this.events.changed()
  }

  private send(frame: { text?: string; done?: boolean }): void {
    if (!this.reply || this.reply.closed) {
      this.reply = this.openReply()
    }

    const reply = this.reply
    const text = JSON.stringify(frame)

    trace(`say ${text.slice(0, 60)}`)

    if (frame.text) {
      reply.text += frame.text
      this.said = Date.now()

      if (this.soundTimer) {
        clearTimeout(this.soundTimer)
      }

      this.soundTimer = setTimeout(() => this.events.changed(), SOUND_EXPECTED_MS + 50)
      this.events.changed()
    }

    if (reply.socket?.readyState === WebSocket.OPEN) {
      reply.socket.send(text)
    } else {
      reply.queue.push(text)
    }
  }

  private openReply(): Reply {
    const reply: Reply = { socket: null, queue: [], rate: 24_000, text: '', closed: false, hushed: false, heard: false }

    void openSiblingSocket('/api/audio/speak-stream')
      .then(socket => {
        if (reply.hushed) {
          socket.close()

          return
        }

        socket.binaryType = 'arraybuffer'
        reply.socket = socket
        socket.onopen = () => {
          trace('speak-stream open')
          reply.queue.forEach(text => socket.send(text))
          reply.queue = []
        }
        socket.onmessage = event => {
          if (typeof event.data !== 'string') {
            const pcm = this.samples.push(event.data as ArrayBuffer)

            if (!reply.heard) {
              reply.heard = true
              trace(`speak-stream first bytes ${(event.data as ArrayBuffer).byteLength}`)
            }

            if (pcm && this.active && !reply.hushed) {
              duplexAudio?.play(pcm, reply.rate)
            }

            return
          }

          const data = parse(event.data)

          if (data?.type === 'start' && typeof data.sample_rate === 'number') {
            trace(`speak-stream pcm ${data.sample_rate}`)
            reply.rate = data.sample_rate
          } else if (data?.type === 'fallback' && !reply.hushed) {
            // Say this reply again by the other path, and use that path for the rest of the call.
            trace('speak-stream fallback')
            this.bySentence = true
            this.closeReply(false)
            this.speakLines(this.sentences.feed(reply.text, reply.closed))
          }
        }
        socket.onclose = () => {
          if (this.reply === reply) {
            this.reply = null
            this.events.changed()
          }
        }
      })
      .catch(error => {
        if (this.reply === reply) {
          this.reply = null
          this.events.lost(`The voice did not connect: ${error instanceof Error ? error.message : String(error)}`)
        }
      })

    return reply
  }

  /** Ask the host for the sound of each line, one at a time, in order. */
  private speakLines(lines: readonly string[]): void {
    this.waiting.push(...lines.map(speakableLine).filter(Boolean))

    if (this.working || !this.waiting.length) {
      return
    }

    const mine = this.spoken

    this.working = true
    this.said = Date.now()
    this.events.changed()

    void (async () => {
      while (this.active && mine === this.spoken && this.waiting.length) {
        const text = this.waiting.shift()!

        try {
          const result = await this.api.request<{ data_url?: string }>({ path: '/api/audio/speak', method: 'POST', body: { text }, timeoutMs: 60_000 })
          const sound = dataUrlParts(result.data_url ?? '')

          if (sound && this.active && mine === this.spoken) {
            this.said = Date.now()
            duplexAudio?.playEncoded(pcmBytes(sound.base64).buffer as ArrayBuffer, audioExtension(sound.mime))
          }
        } catch (error) {
          this.events.lost(`The voice gave no sound: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      if (mine === this.spoken) {
        this.working = false
        this.events.changed()
      }
    })()
  }

  private closeReply(stop: boolean): void {
    const reply = this.reply

    this.cancelFlush()

    this.reply = null

    if (!reply) {
      return
    }

    reply.queue = []
    reply.hushed = true

    if (stop && reply.socket?.readyState === WebSocket.OPEN) {
      reply.socket.send(JSON.stringify({ stop: true }))
    }

    reply.socket?.close()
  }
}

function parse(text: string): { type?: string; text?: unknown; transcript?: unknown; sample_rate?: unknown } | null {
  try {
    return JSON.parse(text) as { type?: string }
  } catch {
    return null
  }
}
