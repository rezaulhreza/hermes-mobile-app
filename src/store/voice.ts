/**
 * The voice call. There is one call at a time, for one conversation. Screens
 * read `$call` and draw it; two views of a call (the full screen and the strip
 * in the chat) are the same call.
 *
 * The call is full duplex: the microphone stays open while the agent speaks,
 * and the answer is spoken while it streams. A speech engine
 * (`voice-engine.ts`) is the ears and the mouth. This file owns the turn:
 * each finished utterance goes to the chat as a normal message, and the
 * events of the answer go to the voice. The rules are those of the desktop's
 * `deepgram-live` plugin.
 *
 * Every await is followed by a check that the call is still this call: the
 * user can end it, or start another, at any point.
 */

import { AudioModule, type AudioRecorder, createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import * as Haptics from 'expo-haptics'
import { atom, computed } from 'nanostores'

import type { GatewayEvent } from '@/core/gateway/gateway-events'
import {
  approvalQuestion,
  type DeepgramSettings,
  FRAME_MS,
  frameLevel,
  INPUT_SAMPLE_RATE,
  isStopPhrase,
  MIC_GAIN_WITH_ECHO_CANCELLING,
  pcmBytes,
  spokenVerdict,
  TOOL_LINE_QUIET_MS,
  toolLine,
  type UserTurn
} from '@/core/live-voice'
import { type GptLiveStatus, liveHistory } from '@/core/gpt-live'
import { requestSummary } from '@/core/requests'
import { advanceListen, audioExtension, base64Bytes, type CallPhase, dataUrlParts, levelFraction, NEW_LISTEN, recordingMime, speakable } from '@/core/voice'
import { duplexAudio } from '@/native/duplex-audio'

import { $conversations, sendDraft, stopTurn } from './chat'
import { currentApi, onGatewayEvent } from './link'
import { $preferences } from './preferences'
import { $requests, answerRequest } from './requests'
import { announceSpokenTurn, DeepgramEngine, deepgramStatus } from './voice-deepgram'
import { type EngineEvents, type EngineName, trace, type VoiceEngine } from './voice-engine'
import { GptLiveEngine } from './voice-gpt-live'
import { RelayEngine } from './voice-relay'

export interface Call {
  sessionId: string
  phase: CallPhase
  muted: boolean
  /** Unix milliseconds. The timer counts from here. */
  startedAt: number
  /** What the user said last, as the engine wrote it down. */
  heard: string
  /** The words of the user so far, while they talk. */
  partial: string
  /** The speech engine of this call. */
  engine: EngineName
  error: string | null
  /** The full-screen view is up. False: only the strip in the chat shows. */
  full: boolean
}

export const $call = atom<Call | null>(null)
/** Why the last call ended by itself (a lost connection). Null after the user has read it. */
export const $callEnded = atom<string | null>(null)
/** One-shot dictation into the message field: off, the microphone is open, or the text is on its way. */
export const $dictation = atom<'off' | 'listening' | 'transcribing'>('off')
/** The key of the answer that is read aloud now, outside a call. */
export const $reading = atom<string | null>(null)

const LEVEL_STEP_MS = 100
// Speech does not need music quality. A small file is at the backend sooner.
const RECORDING = { ...RecordingPresets.HIGH_QUALITY, sampleRate: 16_000, numberOfChannels: 1, bitRate: 48_000, isMeteringEnabled: true }

let recorder: AudioRecorder | null = null
let stopPlayback: (() => void) | null = null
/** Set to end the listen in progress now and send what there is. */
let finishNow = false
let generation = 0

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * The microphone level of the call, 0 to 1. It has an atom of its own: it
 * changes many times a second, and only the bars and the circle may draw
 * again for it. In `$call` it made the whole chat screen draw 50 times a second.
 */
export const $callLevel = atom(0)

/** True while a call is open in a conversation, and which one. Changes only when a call starts or ends. */
export const $callSession = computed($call, call => call?.sessionId ?? null)

const LEVEL_EVERY_MS = 80
let levelShownAt = 0

function showLevel(level: number): void {
  const now = Date.now()

  if (now - levelShownAt >= LEVEL_EVERY_MS && Math.abs(level - $callLevel.get()) > 0.02) {
    levelShownAt = now
    $callLevel.set(level)
  }
}

function patch(change: Partial<Call>): void {
  const call = $call.get()

  if (call) {
    $call.set({ ...call, ...change })
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function openMicrophone(): Promise<void> {
  const permission = await requestRecordingPermissionsAsync()

  if (!permission.granted) {
    throw new Error('Hermes has no access to the microphone. Turn it on in the Settings app.')
  }

  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
}

/**
 * Record until the user has spoken and gone quiet. Returns the file, or null
 * when the listen was called off. `alive` is asked after every step; `level`
 * gets each sample for the screen. While `muted` answers true nothing is recorded.
 */
async function listen(alive: () => boolean, level: (fraction: number) => void, muted: () => boolean = () => false): Promise<string | null> {
  // The class is a property of the native module object, which the lint rule cannot see into.
  // eslint-disable-next-line import/namespace
  recorder ??= new AudioModule.AudioRecorder(RECORDING)

  while (alive()) {
    // A muted call keeps its place in the loop and records nothing.
    if (muted()) {
      level(0)
      await wait(200)
      continue
    }

    await recorder.prepareToRecordAsync()
    recorder.record()
    finishNow = false

    let state = NEW_LISTEN
    let done = false

    while (alive() && !muted() && !done) {
      await wait(LEVEL_STEP_MS)

      const db = recorder.getStatus().metering
      const step = advanceListen(state, db, LEVEL_STEP_MS)

      state = step.listen
      done = step.done || (finishNow && state.totalMs > 300)
      level(levelFraction(db))
    }

    await recorder.stop()
    level(0)

    if (alive() && done && (state.spoke || finishNow)) {
      return recorder.uri
    }
  }

  return null
}

async function transcribe(uri: string): Promise<string> {
  const api = currentApi()

  if (!api) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  const mime = recordingMime(uri)
  const base64 = await new File(uri).base64()
  const result = await api.request<{ transcript?: string }>({
    path: '/api/audio/transcribe',
    method: 'POST',
    body: { data_url: `data:${mime};base64,${base64}`, mime_type: mime },
    timeoutMs: 60_000
  })

  return (result.transcript ?? '').trim()
}

let spoken = 0

/** Say the text. Resolves when the voice ends or `stopSpeaking` is called. */
async function speak(text: string, alive: () => boolean): Promise<void> {
  const api = currentApi()
  const words = speakable(text)

  if (!api || !words) {
    return
  }

  const result = await api.request<{ data_url?: string }>({ path: '/api/audio/speak', method: 'POST', body: { text: words }, timeoutMs: 90_000 })
  const audio = dataUrlParts(result.data_url ?? '')

  if (!audio || !alive()) {
    return
  }

  const file = new File(Paths.cache, `hermes-voice-${++spoken % 4}.${audioExtension(audio.mime)}`)

  if (file.exists) {
    file.delete()
  }

  file.create()
  file.write(base64Bytes(audio.base64))

  await new Promise<void>(resolve => {
    const playing = createAudioPlayer(file.uri)
    const end = () => {
      subscription.remove()
      playing.pause()
      playing.remove()
      stopPlayback = null
      resolve()
    }
    const subscription = playing.addListener('playbackStatusUpdate', status => {
      if (status.didJustFinish) {
        end()
      }
    })

    stopPlayback = end
    playing.play()
  })
}

/** A way to hold a call on this host. `reason` says why it cannot be chosen. */
export interface EngineChoice {
  name: EngineName
  label: string
  detail: string
  reason: string | null
}

/** The engines of the active workspace. Null until `loadEngines` has answered. */
export const $engines = atom<EngineChoice[] | null>(null)

interface Host {
  deepgram: DeepgramSettings | null
  liveStt: boolean
}

let host: Host | null = null

/** Ask the host which engines it has. The answer is kept for the link. */
export async function loadEngines(): Promise<EngineChoice[]> {
  const api = currentApi()

  if (!api) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  const [deepgram, config, live] = await Promise.all([
    deepgramStatus(api),
    api.request<{ stt?: { streaming?: boolean } }>({ path: '/api/audio/voice-config', timeoutMs: 8000 }).catch(() => null),
    api.request<GptLiveStatus>({ path: '/api/audio/voice-live/status', timeoutMs: 8000 }).catch(() => null)
  ])

  host = { deepgram, liveStt: Boolean(config?.stt?.streaming) }

  const choices: EngineChoice[] = [
    {
      name: 'deepgram',
      label: 'Deepgram live',
      detail: 'The fastest. The same voice path as the desktop plugin.',
      reason: deepgram ? null : 'The deepgram-live plugin is not ready on this host.'
    },
    {
      name: 'relay',
      label: 'Hermes voice',
      detail: 'The speech providers of your Hermes host.',
      reason: null
    },
    {
      name: 'gpt-live',
      label: 'GPT-Live',
      detail: 'OpenAI’s voice model talks with you and hands the work to your agent.',
      reason: live?.available ? null : gptLiveReason(live)
    }
  ]

  $engines.set(choices)

  return choices
}

function gptLiveReason(status: GptLiveStatus | null): string {
  if (!status) {
    return 'This Hermes host has no GPT-Live.'
  }

  return /api key/i.test(status.reason ?? '') ? 'Needs an OpenAI API key on your Hermes host.' : status.reason || 'Not ready on this Hermes host.'
}

/** The engine a call starts with: the choice of the user when the host has it, else the first one that works. */
function pickEngine(choices: readonly EngineChoice[]): EngineName {
  const wanted = $preferences.get().engine
  const usable = choices.filter(choice => !choice.reason)

  return usable.find(choice => choice.name === wanted)?.name ?? usable[0]?.name ?? 'relay'
}

/** The text turns of the chat, for a voice model that starts with the conversation so far. */
function spokenTurns(sessionId: string): { role: 'assistant' | 'user'; text: string }[] {
  return ($conversations.get()[sessionId]?.transcript.items ?? []).flatMap(item =>
    item.kind === 'user' || item.kind === 'assistant' ? [{ role: item.kind, text: item.text }] : []
  )
}

/** One turn of the agent, as the call follows it. */
interface AgentTurn {
  done: boolean
  /** The user talked over this answer, or stopped it. The rest of it stays silent. */
  muted: boolean
  /** Text of this turn went to the voice. */
  spoke: boolean
  /** Only text that streams after the start of this turn is spoken: late text of a stopped answer stays silent. */
  started: boolean
}

let engine: VoiceEngine | null = null
let turn: AgentTurn | null = null
/** The approval that waits for a spoken answer. */
let approval: string | null = null
const announced = new Set<string>()
let subscriptions: { remove(): void }[] = []

let injected: Uint8Array[] = []
/** A check feeds speech. The microphone then stays muted through every start of the audio, so the room is never heard. */
let fedOnly = false

export function isFedOnly(): boolean {
  return fedOnly
}

/**
 * For a check with no sound in the room: this speech (mono int16 PCM at
 * 16 kHz) goes to the call in the place of the microphone, at the speed of
 * speech. Mute the call first, so the room is not heard between the frames.
 */
export function injectSpeech(pcm: Uint8Array): void {
  fedOnly = true
  duplexAudio?.setMuted(true)

  const size = (INPUT_SAMPLE_RATE * FRAME_MS * 2) / 1000

  for (let at = 0; at < pcm.length; at += size) {
    const frame = new Uint8Array(size)

    frame.set(pcm.subarray(at, at + size))
    injected.push(frame)
  }
}

/** The next fed frame of a check, if one waits. */
export function takeInjected(): Uint8Array | undefined {
  return injected.shift()
}

function tap(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}

function refreshPhase(): void {
  const call = $call.get()

  if (!call || !engine || call.phase === 'connecting') {
    return
  }

  const phase: CallPhase = engine.speaking() ? 'speaking' : turn && !turn.done ? 'thinking' : 'listening'

  if (phase !== call.phase) {
    patch({ phase })
  }
}

function engineEvents(sessionId: string, mine: number): EngineEvents {
  const alive = () => generation === mine && $call.get()?.sessionId === sessionId

  return {
    partial: text => {
      if (alive()) {
        trace(`partial "${text.slice(-30)}"`)
        patch({ partial: text })
      }
    },
    hearing: () => alive() && $call.get()?.phase !== 'hearing' && patch({ phase: 'hearing' }),
    barge: () => {
      if (alive() && turn) {
        turn.muted = true
      }

      tap()
    },
    transcribing: () => alive() && patch({ phase: 'transcribing' }),
    utterance: (text, userTurn, context) => {
      if (!alive()) {
        return
      }

      trace(`utterance "${text.slice(0, 40)}"`)
      patch({ partial: '' })
      refreshPhase()

      if (text) {
        void onUtterance(sessionId, text, userTurn, alive, context).catch(error => patch({ error: message(error) }))
      }
    },
    stopWord: () => {
      if (alive()) {
        void interruptIfBusy(sessionId).then(endCall)
      }
    },
    changed: () => alive() && refreshPhase(),
    lost: (text, ended) => {
      if (!alive()) {
        return
      }

      if (ended) {
        // The call cannot go on. The reason stays on the screen of the chat.
        endCall()
        $callEnded.set(text)
      } else {
        patch({ error: text })
      }
    }
  }
}

async function onUtterance(sessionId: string, text: string, userTurn: UserTurn, alive: () => boolean, context?: string): Promise<void> {
  if (approval) {
    return answerApproval(approval, text, userTurn)
  }

  if (isStopPhrase(text)) {
    await interruptIfBusy(sessionId)

    return endCall()
  }

  engine?.hush()
  patch({ heard: text, error: null })
  await interruptIfBusy(sessionId)

  const api = currentApi()

  // Tell the agent half that this turn was spoken, so the answer comes back as plain sentences.
  if (api && host?.deepgram) {
    await announceSpokenTurn(api, text)
  }

  if (!alive()) {
    return
  }

  turn = { done: false, muted: false, spoke: false, started: false }
  tap()
  refreshPhase()
  await sendDraft(sessionId, text, 'queue', context)
}

/** Stop the running turn and wait until it is gone, so the next message starts a turn of its own. */
async function interruptIfBusy(sessionId: string): Promise<void> {
  const running = () => $conversations.get()[sessionId]?.transcript.running ?? false

  if (!running()) {
    return
  }

  if (turn) {
    turn.muted = true
  }

  await stopTurn(sessionId).catch(() => undefined)

  const deadline = Date.now() + 4000

  while (running() && Date.now() < deadline) {
    await wait(100)
  }
}

function answerApproval(id: string, text: string, userTurn: UserTurn): void {
  const verdict = spokenVerdict(text, userTurn)

  if (verdict === 'unclear') {
    engine?.say('I need a clear answer. Should I let it run?')

    return
  }

  approval = null
  answerRequest(id, { kind: 'approval', choice: verdict })
  engine?.say(verdict === 'deny' ? 'Okay, I blocked it.' : 'Okay, going ahead.')
}

/** The agent stopped for the user. Say so: on a call the user may not look at the screen. */
$requests.listen(requests => {
  const call = $call.get()

  if (!call || !engine) {
    return
  }

  const waiting = requests.filter(request => request.sessionId === call.sessionId)

  if (approval && !waiting.some(request => request.id === approval)) {
    // Answered on the screen, or withdrawn.
    approval = null
  }

  const next = waiting.find(request => !announced.has(request.id))

  if (!next) {
    return
  }

  announced.add(next.id)
  engine.feed('', true)

  if (next.kind === 'approval') {
    approval = next.id
    engine.say(approvalQuestion(next))
  } else {
    engine.say(`Hermes needs you. ${requestSummary(next)}. Please answer on the screen.`)
  }
})

function speaks(): boolean {
  return Boolean(turn?.started && !turn.muted)
}

function payloadText(event: GatewayEvent): string {
  const text = (event.payload as { text?: unknown } | undefined)?.text

  return typeof text === 'string' ? text : ''
}

/** The events of the answer go to the voice as they come. */
onGatewayEvent(event => {
  const call = $call.get()

  if (!call || !engine || event.session_id !== call.sessionId) {
    return
  }

  switch (event.type) {
    case 'message.start':
      // A typed message during a call is spoken too.
      turn = turn && !turn.done ? { ...turn, started: true } : { done: false, muted: false, spoke: false, started: true }
      break

    case 'message.delta':
      if (speaks() && payloadText(event)) {
        if (!turn!.spoke) {
          trace('answer-text')
        }

        turn!.spoke = true
        engine.feed(payloadText(event))
      }

      break

    case 'message.interim':
      if (speaks()) {
        if (!(event.payload as { already_streamed?: boolean } | undefined)?.already_streamed && payloadText(event)) {
          turn!.spoke = true
          engine.feed(payloadText(event))
        }

        // The words before a tool call are a finished thought: say them now.
        engine.feed('', true)
      }

      break

    case 'tool.start':
      if (speaks()) {
        engine.feed('', true)

        if (Date.now() - engine.lastSayAt() > TOOL_LINE_QUIET_MS && !engine.audible()) {
          engine.say(toolLine((event.payload as { name?: unknown } | undefined)?.name))
        }
      }

      break

    case 'message.complete':
      if (turn?.started) {
        if (!turn.muted) {
          engine.feed(turn.spoke ? '' : payloadText(event), true)
          engine.endReply()
        }

        turn.done = true
      }

      break

    default:
      // A turn that ended with no answer (stopped, or an error) is over too.
      if (turn?.started && !turn.done && !($conversations.get()[call.sessionId]?.transcript.running ?? false)) {
        turn.done = true

        if (!turn.muted) {
          engine.endReply()
        }
      }
  }

  refreshPhase()
})

/**
 * Start a call in this conversation. Throws when the microphone cannot be
 * used. With a `greeting`, the voice says it when the call is open.
 */
export async function startCall(sessionId: string, options: { greeting?: string } = {}): Promise<void> {
  endCall()

  const audio = duplexAudio
  const api = currentApi()

  if (!audio) {
    throw new Error('This build of the app has no call audio. Install the newest build.')
  }

  if (!api) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  const permission = await requestRecordingPermissionsAsync()

  if (!permission.granted) {
    throw new Error('Hermes has no access to the microphone. Turn it on in the Settings app.')
  }

  const mine = ++generation
  const alive = () => generation === mine

  $call.set({ sessionId, phase: 'connecting', muted: false, startedAt: Date.now(), heard: '', partial: '', error: null, full: true, engine: 'relay' })

  try {
    const name = pickEngine(await loadEngines())

    if (!alive()) {
      return
    }

    const events = engineEvents(sessionId, mine)
    const next: VoiceEngine =
      name === 'deepgram' && host?.deepgram
        ? new DeepgramEngine(api, host.deepgram, events)
        : name === 'gpt-live'
          ? new GptLiveEngine(api, () => liveHistory(spokenTurns(sessionId)), events)
          : new RelayEngine(api, host?.liveStt ?? false, events)

    patch({ engine: next.name })
    $callEnded.set(null)

    if (!next.ownsAudio) {
      await audio.start({ inputRate: INPUT_SAMPLE_RATE, frameMs: FRAME_MS, duckGain: MIC_GAIN_WITH_ECHO_CANCELLING, speaker: true })
    }

    if (!alive()) {
      return next.ownsAudio ? undefined : audio.stop()
    }

    if (fedOnly) {
      audio.setMuted(true)
      patch({ muted: true })
    }

    engine = next
    subscriptions = next.ownsAudio ? [] : [
      audio.addListener('onFrame', frame => {
        if (!alive()) {
          return
        }

        // A check feeds a recording in the place of the microphone, one frame for one frame.
        const fed = injected.shift()
        const level = fed ? frameLevel(fed) : frame.level

        if (fed && !injected.length) {
          trace('fed-end')
        }

        next.frame(fed ?? pcmBytes(frame.data), level)
        showLevel(level)
      }),
      audio.addListener('onPlayback', state => {
        if (alive()) {
          trace(`sound ${state.playing}`)
          next.playback(state.playing)
        }
      }),
      audio.addListener('onInterruption', state => alive() && state.reason === 'failed' && patch({ error: state.message ?? 'The audio stopped.' }))
    ]
    await next.start()

    if (!alive()) {
      return
    }

    patch({ phase: 'listening' })
    tap()

    if (options.greeting) {
      next.say(options.greeting)
    }
  } catch (error) {
    if (alive()) {
      endCall()
    }

    throw error
  }
}

/** Go on with the same call on the engine the user just chose. */
export async function restartCall(): Promise<void> {
  const call = $call.get()

  if (call) {
    await startCall(call.sessionId)
  }
}

export function endCall(): void {
  generation += 1
  stopPlayback?.()
  subscriptions.forEach(subscription => subscription.remove())
  subscriptions = []

  if (engine) {
    engine.stop()
    engine = null
    duplexAudio?.stop()
  } else if ($call.get()) {
    duplexAudio?.stop()
  }

  turn = null
  approval = null
  injected = []
  announced.clear()
  $callLevel.set(0)
  $call.set(null)
}

export function setCallMuted(muted: boolean): void {
  duplexAudio?.setMuted(muted)
  engine?.setMuted?.(muted)
  patch({ muted, partial: '' })
}

export function showCallFull(full: boolean): void {
  patch({ full })
}

/**
 * The tap on the circle. While the user talks: send what was said now. While
 * the agent works: stop the turn. While the voice plays: stop it. The
 * microphone stays open through all of them.
 */
export function interruptCall(): void {
  const call = $call.get()

  if (!call || !engine) {
    return
  }

  if (call.phase === 'hearing') {
    engine.finishTurn()
  } else if (call.phase === 'thinking' || call.phase === 'speaking') {
    if (turn) {
      turn.muted = true
    }

    engine.hush()

    if (turn && !turn.done) {
      void stopTurn(call.sessionId).catch(() => undefined)
    }

    refreshPhase()
  }
}

/** Listen once and give the words back, for the message field. A second call while it listens ends the listen. */
export async function dictate(): Promise<string> {
  if ($dictation.get() === 'listening') {
    finishNow = true

    return ''
  }

  if ($dictation.get() !== 'off' || $call.get()) {
    return ''
  }

  await openMicrophone()
  $dictation.set('listening')

  try {
    const uri = await listen(() => $dictation.get() === 'listening', () => undefined)

    if (!uri) {
      return ''
    }

    $dictation.set('transcribing')

    return await transcribe(uri)
  } finally {
    $dictation.set('off')
    void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined)
  }
}

export function cancelDictation(): void {
  $dictation.set('off')
}

/** Read one answer aloud, outside a call. The same button stops it. */
export async function readAloud(key: string, text: string): Promise<void> {
  if ($reading.get() === key) {
    stopPlayback?.()

    return
  }

  stopPlayback?.()
  $reading.set(key)

  try {
    await setAudioModeAsync({ playsInSilentMode: true })
    await speak(text, () => $reading.get() === key)
  } finally {
    if ($reading.get() === key) {
      $reading.set(null)
    }
  }
}

export function clearVoice(): void {
  endCall()
  $dictation.set('off')
  $reading.set(null)
}
