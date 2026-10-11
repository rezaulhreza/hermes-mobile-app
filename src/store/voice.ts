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
import { atom } from 'nanostores'

import type { GatewayEvent } from '@/core/gateway/gateway-events'
import {
  approvalQuestion,
  type DeepgramSettings,
  FRAME_MS,
  INPUT_SAMPLE_RATE,
  isStopPhrase,
  MIC_GAIN_DURING_PLAYBACK,
  pcmBytes,
  spokenVerdict,
  TOOL_LINE_QUIET_MS,
  toolLine,
  type UserTurn
} from '@/core/live-voice'
import { requestSummary } from '@/core/requests'
import { advanceListen, audioExtension, base64Bytes, type CallPhase, dataUrlParts, levelFraction, NEW_LISTEN, recordingMime, speakable } from '@/core/voice'
import { duplexAudio } from '@/native/duplex-audio'

import { $conversations, sendDraft, stopTurn } from './chat'
import { currentApi, onGatewayEvent } from './link'
import { $requests, answerRequest } from './requests'
import { announceSpokenTurn, DeepgramEngine, deepgramStatus } from './voice-deepgram'
import type { EngineEvents, EngineName, VoiceEngine } from './voice-engine'
import { RelayEngine } from './voice-relay'

export interface Call {
  sessionId: string
  phase: CallPhase
  muted: boolean
  /** Unix milliseconds. The timer counts from here. */
  startedAt: number
  /** The microphone level, 0 to 1. */
  level: number
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

/** What the user chose. `auto` takes the fastest engine the host has. */
export const $enginePreference = atom<EngineName | 'auto'>('auto')
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

  const [deepgram, config] = await Promise.all([
    deepgramStatus(api),
    api.request<{ stt?: { streaming?: boolean } }>({ path: '/api/audio/voice-config', timeoutMs: 8000 }).catch(() => null)
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
    }
  ]

  $engines.set(choices)

  return choices
}

/** The engine a call starts with: the choice of the user when the host has it, else the first one that works. */
function pickEngine(choices: readonly EngineChoice[]): EngineName {
  const wanted = $enginePreference.get()
  const usable = choices.filter(choice => !choice.reason)

  return usable.find(choice => choice.name === wanted)?.name ?? usable[0]?.name ?? 'relay'
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
    partial: text => alive() && patch({ partial: text }),
    hearing: () => alive() && $call.get()?.phase !== 'hearing' && patch({ phase: 'hearing' }),
    barge: () => {
      if (alive() && turn) {
        turn.muted = true
      }

      tap()
    },
    transcribing: () => alive() && patch({ phase: 'transcribing' }),
    utterance: (text, userTurn) => {
      if (!alive()) {
        return
      }

      patch({ partial: '' })
      refreshPhase()

      if (text) {
        void onUtterance(sessionId, text, userTurn, alive).catch(error => patch({ error: message(error) }))
      }
    },
    changed: () => alive() && refreshPhase(),
    lost: text => alive() && patch({ error: text })
  }
}

async function onUtterance(sessionId: string, text: string, userTurn: UserTurn, alive: () => boolean): Promise<void> {
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
  await sendDraft(sessionId, text)
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

/** Start a call in this conversation. Throws when the microphone cannot be used. */
export async function startCall(sessionId: string): Promise<void> {
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

  $call.set({ sessionId, phase: 'connecting', muted: false, startedAt: Date.now(), level: 0, heard: '', partial: '', error: null, full: true, engine: 'relay' })

  try {
    const name = pickEngine(await loadEngines())

    if (!alive()) {
      return
    }

    const events = engineEvents(sessionId, mine)
    const next: VoiceEngine = name === 'deepgram' && host?.deepgram ? new DeepgramEngine(api, host.deepgram, events) : new RelayEngine(api, host?.liveStt ?? false, events)

    patch({ engine: next.name })
    await audio.start({ inputRate: INPUT_SAMPLE_RATE, frameMs: FRAME_MS, duckGain: MIC_GAIN_DURING_PLAYBACK, speaker: true })

    if (!alive()) {
      return audio.stop()
    }

    engine = next
    subscriptions = [
      audio.addListener('onFrame', frame => {
        if (alive()) {
          next.frame(pcmBytes(frame.data), frame.level)
          patch({ level: frame.level })
        }
      }),
      audio.addListener('onPlayback', state => alive() && next.playback(state.playing)),
      audio.addListener('onInterruption', state => alive() && state.reason === 'failed' && patch({ error: state.message ?? 'The audio stopped.' }))
    ]
    await next.start()

    if (!alive()) {
      return
    }

    patch({ phase: 'listening' })
    tap()
  } catch (error) {
    if (alive()) {
      endCall()
    }

    throw error
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
  announced.clear()
  $call.set(null)
}

export function setCallMuted(muted: boolean): void {
  duplexAudio?.setMuted(muted)
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
