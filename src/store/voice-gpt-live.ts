/**
 * The gpt-live engine on the phone: WebRTC to OpenAI's voice model, opened
 * through the Hermes host (`POST /api/audio/voice-live/session` trades the
 * phone's SDP offer for the answer, so the OpenAI key stays on the host).
 *
 * WebRTC has the microphone and the speaker here, with its own echo
 * cancellation; the call's own audio module is not used.
 */

import { mediaDevices, type MediaStream, RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc'

import type { HermesApi } from '@/core/api'
import { commentaryParts, contextWindow, delegationPrompt, type LiveFragment, type LiveHistoryMessage } from '@/core/gpt-live'
import { isStopPhrase, NEW_TURN, SentenceFeed } from '@/core/live-voice'

import type { EngineEvents, VoiceEngine } from './voice-engine'

const CLOSE_TIMEOUT_MS = 15_000
const ICE_GATHER_TIMEOUT_MS = 10_000
/** Quiet after the last words of the user before the utterance is judged as a whole ("stop" ends the call; "stop the server" is a request). */
const UTTERANCE_SETTLE_MS = 1500
/** The voice counts as speaking for this long after its last words arrived. */
const SPEAKING_HOLD_MS = 1200

interface LiveEvent {
  type: string
  delta?: string
  end_ms?: number
  delegation?: { id: string }
  error?: { code?: string | null; message?: string }
  reason?: string
}

type DataChannel = ReturnType<RTCPeerConnection['createDataChannel']>

export class GptLiveEngine implements VoiceEngine {
  readonly name = 'gpt-live' as const
  readonly ownsAudio = true

  private peer: RTCPeerConnection | null = null
  private channel: DataChannel | null = null
  private microphone: MediaStream | null = null
  private closed = false
  private counter = 0
  private transcript: LiveFragment[] = []
  private utterance = ''
  private utteranceTimer: ReturnType<typeof setTimeout> | null = null
  private delegation: string | null = null
  private spokeAt = 0
  private speakingTimer: ReturnType<typeof setTimeout> | null = null
  private said = 0
  private readonly sentences = new SentenceFeed()

  constructor(
    private readonly api: HermesApi,
    private readonly history: () => LiveHistoryMessage[],
    private readonly events: EngineEvents
  ) {}

  async start(): Promise<void> {
    const peer = new RTCPeerConnection()

    this.peer = peer
    on(peer, 'connectionstatechange', () => {
      if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
        this.finish('Live voice lost its connection to the voice model.')
      }
    })

    // The sound of the answer plays with no more code: React Native WebRTC sends a remote audio track to the speaker.
    this.microphone = await mediaDevices.getUserMedia({ audio: true })

    for (const track of this.microphone.getAudioTracks()) {
      peer.addTrack(track, this.microphone)
    }

    // The data channel must exist before the offer, so the offer names it.
    const channel = peer.createDataChannel('oai-events')

    this.channel = channel
    on(channel, 'message', event => this.onEvent(String(event.data)))
    on(channel, 'close', () => this.finish('Live voice lost its connection to the voice model.'))

    await peer.setLocalDescription(await peer.createOffer({}))
    await gathered(peer)

    const sdp = peer.localDescription?.sdp

    if (!sdp) {
      throw new Error('The phone made no WebRTC offer.')
    }

    // The offer goes as it is: the vendor needs it byte for byte, with its last line end.
    const answer = await this.api.request<{ ok?: boolean; transport?: { sdp?: string } }>({
      path: '/api/audio/voice-live/session',
      method: 'POST',
      body: { sdp, history: this.history() },
      timeoutMs: 45_000
    })

    if (!answer?.transport?.sdp) {
      throw new Error('The Hermes host did not open a voice session.')
    }

    await peer.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: answer.transport.sdp }))
  }

  stop(): void {
    if (this.closed) {
      return
    }

    // Ask for a clean end, so the vendor stops the session (and its cost) now.
    if (this.send({ type: 'session.close' })) {
      setTimeout(() => this.release(), CLOSE_TIMEOUT_MS)
      this.closed = true
      this.microphone?.getTracks().forEach(track => track.stop())

      return
    }

    this.release()
  }

  frame(): void {
    // WebRTC has the microphone.
  }

  playback(): void {
    // WebRTC has the speaker.
  }

  setMuted(muted: boolean): void {
    for (const track of this.microphone?.getAudioTracks() ?? []) {
      track.enabled = !muted
    }

    this.send({ type: muted ? 'session.input_audio.mute' : 'session.input_audio.unmute', event_id: this.id(muted ? 'mute' : 'unmute') })
  }

  speaking(): boolean {
    return Date.now() - this.spokeAt < SPEAKING_HOLD_MS
  }

  audible(): boolean {
    return this.speaking()
  }

  lastSayAt(): number {
    return this.said
  }

  finishTurn(): void {
    // The voice model decides when a turn ends.
  }

  hush(): void {
    // The voice model stops itself when the user talks. Text that waits is dropped.
    this.sentences.clear()
  }

  /** The answer of Hermes, as it streams: the voice says it in its own words. */
  feed(text: string, final = false): void {
    for (const line of this.sentences.feed(text, final)) {
      this.say(line)
    }
  }

  endReply(): void {
    this.feed('', true)
    this.delegation = null
  }

  say(line: string): void {
    this.said = Date.now()

    for (const content of commentaryParts(line)) {
      this.send({ type: 'session.commentary.append', content, delegation_id: this.delegation, event_id: this.id('say') })
    }
  }

  // ── the events of the voice model ────────────────────────────────────────────────────────────

  private onEvent(raw: string): void {
    let event: LiveEvent

    try {
      event = JSON.parse(raw) as LiveEvent
    } catch {
      return
    }

    switch (event.type) {
      case 'session.input_transcript.delta':
        this.transcript.push({ speaker: 'user', text: event.delta ?? '', endMs: event.end_ms ?? 0 })
        this.heard(event.delta ?? '')
        break

      case 'session.output_transcript.delta':
        this.transcript.push({ speaker: 'assistant', text: event.delta ?? '', endMs: event.end_ms ?? 0 })
        this.spokeAt = Date.now()

        if (this.speakingTimer) {
          clearTimeout(this.speakingTimer)
        }

        this.speakingTimer = setTimeout(() => this.events.changed(), SPEAKING_HOLD_MS + 50)
        this.events.changed()
        break

      case 'session.delegation.created':
        if (event.delegation?.id) {
          const { prompt, context } = delegationPrompt(contextWindow(this.transcript))

          this.delegation = event.delegation.id
          this.clearUtterance()
          this.events.utterance(prompt, NEW_TURN, context)
        }

        break

      case 'error':
        // An append that arrives after our own close is expected.
        if (event.error?.code !== 'context_injection_incomplete') {
          this.events.lost(event.error?.message ?? 'The voice model reported an error.')
        }

        break

      case 'session.closed':
        this.finish(event.reason && event.reason !== 'closed' ? `The voice session ended: ${event.reason}.` : 'The voice session ended.')
        break
    }

    if (this.transcript.length > 2000) {
      this.transcript.splice(0, this.transcript.length - 1500)
    }
  }

  /** Words of the user, for the screen. The voice model answers a bare "stop" itself, so the phrase is judged here. */
  private heard(text: string): void {
    this.utterance += text
    this.events.hearing()
    this.events.partial(this.utterance.trim())

    if (this.utteranceTimer) {
      clearTimeout(this.utteranceTimer)
    }

    this.utteranceTimer = setTimeout(() => {
      const said = this.utterance

      this.clearUtterance()

      if (isStopPhrase(said)) {
        this.events.stopWord()
      } else {
        // The voice model answered by itself: there is no turn for Hermes.
        this.events.utterance('', NEW_TURN)
      }
    }, UTTERANCE_SETTLE_MS)
  }

  private clearUtterance(): void {
    this.utterance = ''

    if (this.utteranceTimer) {
      clearTimeout(this.utteranceTimer)
      this.utteranceTimer = null
    }
  }

  private id(prefix: string): string {
    return `${prefix}_${++this.counter}`
  }

  private send(event: Record<string, unknown>): boolean {
    if (this.channel?.readyState !== 'open') {
      return false
    }

    this.channel.send(JSON.stringify(event))

    return true
  }

  private finish(message: string): void {
    if (!this.closed) {
      this.release()
      this.events.lost(message, true)
    } else {
      this.release()
    }
  }

  private release(): void {
    this.closed = true
    this.clearUtterance()

    if (this.speakingTimer) {
      clearTimeout(this.speakingTimer)
    }

    this.microphone?.getTracks().forEach(track => track.stop())
    this.microphone = null
    this.channel?.close()
    this.channel = null
    this.peer?.close()
    this.peer = null
  }
}

/** The WebRTC classes take listeners through a base class whose types this project cannot see. */
function on(target: object, type: string, listener: (event: { data?: unknown }) => void): void {
  ;(target as { addEventListener(type: string, listener: (event: { data?: unknown }) => void): void }).addEventListener(type, listener)
}

/** Wait until the offer has its network candidates. After the timeout the offer goes with those it has. */
function gathered(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    const timer = setTimeout(resolve, ICE_GATHER_TIMEOUT_MS)

    on(peer, 'icegatheringstatechange', () => {
      if (peer.iceGatheringState === 'complete') {
        clearTimeout(timer)
        resolve()
      }
    })
  })
}
