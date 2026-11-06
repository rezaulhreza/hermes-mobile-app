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

import { requestRecordingPermissionsAsync } from 'expo-audio'
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
  afterSentence,
  stillWorkingLine,
  stillWorkingWait,
  toolLine,
  type UserTurn,
  withLanguage,
  withVoice
} from '@/core/live-voice'
import { type GptLiveStatus, liveHistory } from '@/core/gpt-live'
import { requestSummary } from '@/core/requests'
import { type CallPhase, speakable } from '@/core/voice'
import { duplexAudio } from '@/native/duplex-audio'

import { $conversations, sendDraft, stopTurn } from './chat'
import { currentApi, onGatewayEvent } from './link'
import { $preferences, setPreference } from './preferences'
import { $requests, answerRequest } from './requests'
import { announceSpokenTurn, DeepgramEngine, deepgramStatus } from './voice-deepgram'
import { type EngineEvents, type EngineName, trace, type VoiceEngine } from './voice-engine'
import { GptLiveEngine } from './voice-gpt-live'
import { DICTATION_PREROLL_FRAMES, RelayEngine } from './voice-relay'

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
/**
 * One-shot dictation into the message field: off, the microphone opens, it is
 * open and waits for words, it hears the user, or the text is on its way.
 */
export const $dictation = atom<'off' | 'starting' | 'listening' | 'hearing' | 'transcribing'>('off')
/** The key of the answer that is read aloud now, outside a call. */
export const $reading = atom<string | null>(null)

let stopPlayback: (() => void) | null = null
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
/** The microphone of the call is off. Changes only on a tap. */
export const $callMuted = computed($call, call => call?.muted ?? false)

const LEVEL_EVERY_MS = 80
let levelShownAt = 0
/** The voice of the agent plays now. The level on screen is then the level of that voice. */
let voicePlays = false

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

/** The sound of the call is gone and the phone could not get it back. */
const AUDIO_LOST = 'The sound of Live voice stopped. End Live voice and start it again.'

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

/** The voice the host is set to for the Deepgram engine. Null before the engines were asked for, or with no such engine. */
export function hostVoice(): string | null {
  return host?.deepgram?.voice ?? null
}

/** The language the host is set to, for the Deepgram engine. */
export function hostLanguage(): string | null {
  return host?.deepgram?.language ?? null
}

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
      label: 'Deepgram',
      detail: 'Your speech goes from this phone to Deepgram.',
      reason: deepgram ? null : 'The deepgram-live plugin is not ready on this host.'
    },
    {
      name: 'relay',
      label: 'Hermes voice',
      detail: 'Your speech goes through your Hermes host and its speech settings.',
      reason: null
    },
    {
      name: 'gpt-live',
      label: 'GPT-Live',
      detail: 'An OpenAI voice talks with you and passes tasks to your agent.',
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
  /** The voice stopped for words over it, and those words are not known yet. */
  barged?: boolean
  /** The voice was stopped by mistake in the middle of a sentence: the rest of that sentence stays silent. */
  skipSentence?: boolean
  /** Unix milliseconds of the start, for the lines of a long silence. */
  since: number
  /** How many lines of a long silence this turn has had. */
  stillWorking: number
}

function newTurn(started: boolean): AgentTurn {
  return { done: false, muted: false, spoke: false, started, since: Date.now(), stillWorking: 0 }
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
      if (alive() && turn && !turn.muted) {
        turn.muted = true
        turn.barged = true
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

      if (!text && turn?.barged) {
        // The words that stopped the voice were the voice itself, or no words. The answer goes on.
        turn.muted = false
        turn.barged = false
        turn.skipSentence = true
      }

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

  turn = newTurn(false)
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

const STILL_WORKING_TICK_MS = 1000
let quietMs = 0

/**
 * A long silence while the agent works: the voice says that it still works,
 * so the person does not think the call is dead. A tool that starts has its
 * own line; this is for the model that thinks and the tool that runs long.
 */
function keepCompany(): void {
  const call = $call.get()
  const running = call ? ($conversations.get()[call.sessionId]?.transcript.running ?? false) : false
  // A turn that was sent and did not start yet has no answer on its way for some seconds.
  const works = turn && !turn.done && !turn.muted && (running || Date.now() - turn.since < 15_000)

  if (!call || !engine || !works || approval || call.phase === 'hearing' || call.phase === 'transcribing' || engine.speaking() || engine.audible()) {
    quietMs = 0

    return
  }

  quietMs += STILL_WORKING_TICK_MS

  if (quietMs >= stillWorkingWait(turn!.stillWorking)) {
    engine.say(stillWorkingLine(turn!.stillWorking))
    turn!.stillWorking += 1
    quietMs = 0
  }
}

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
      turn = turn && !turn.done ? { ...turn, started: true } : newTurn(true)
      break

    case 'message.delta':
      if (speaks() && payloadText(event)) {
        if (!turn!.spoke) {
          trace('answer-text')
        }

        const text = turn!.skipSentence ? afterSentence(payloadText(event)) : payloadText(event)

        if (text !== null) {
          turn!.skipSentence = false
          turn!.spoke = true
          engine.feed(text)
        }
      }

      break

    case 'message.interim':
      if (speaks()) {
        turn!.skipSentence = false

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
        turn!.skipSentence = false
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
    throw new Error('This build of the app has no Live voice audio. Install the newest build.')
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
        ? new DeepgramEngine(api, withLanguage(withVoice(host.deepgram, $preferences.get().voice), $preferences.get().language), events)
        : name === 'gpt-live'
          ? new GptLiveEngine(api, () => liveHistory(spokenTurns(sessionId)), events)
          : new RelayEngine(api, host?.liveStt ?? false, events)

    patch({ engine: next.name })
    $callEnded.set(null)

    if (!next.ownsAudio) {
      await audio.start({ inputRate: INPUT_SAMPLE_RATE, frameMs: FRAME_MS, duckGain: MIC_GAIN_WITH_ECHO_CANCELLING, speaker: $preferences.get().speaker })
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

        if (!voicePlays) {
          showLevel(level)
        }
      }),
      audio.addListener('onPlayback', state => {
        if (alive()) {
          trace(`sound ${state.playing}`)
          voicePlays = state.playing
          next.playback(state.playing)
        }
      }),
      // While Hermes speaks the bars show its voice, not the quiet microphone.
      audio.addListener('onOutputLevel', state => alive() && voicePlays && showLevel(state.level)),
      audio.addListener('onInterruption', state => {
        if (alive() && state.reason === 'failed') {
          // The fault of the phone's audio goes to the trace. The person gets what to do.
          trace(`audio lost: ${state.message ?? ''}`)
          patch({ error: AUDIO_LOST })
        }
      })
    ]
    const company = setInterval(keepCompany, STILL_WORKING_TICK_MS)

    quietMs = 0
    subscriptions.push({ remove: () => clearInterval(company) })
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
  voicePlays = false
  $call.set(null)
}

export function setCallMuted(muted: boolean): void {
  duplexAudio?.setMuted(muted)
  engine?.setMuted?.(muted)
  patch({ muted, partial: '' })
}

/** Play the call through the loudspeaker, or through the earpiece as a phone call. The choice stays for the next call. */
export function setCallSpeaker(speaker: boolean): void {
  duplexAudio?.setSpeaker(speaker)
  setPreference('speaker', speaker)
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
      turn.barged = false
    }

    engine.hush()

    if (turn && !turn.done) {
      void stopTurn(call.sessionId).catch(() => undefined)
    }

    refreshPhase()
  }
}

/** The live words of a dictation, while the user talks. */
export const $dictationWords = atom('')

let endDictation: ((words: string) => void) | null = null
/** End the listen that runs and give its words: the user is done talking. Null when no listen runs. */
let finishDictation: (() => void) | null = null

/**
 * Listen and give the words back, for the message field. The user talks for
 * as long as they want: a pause does not end the listen, it ends one part,
 * and the parts add up. The listen ends when the user says so, with a second
 * call or with `finishDictation`. The words show in `$dictationWords` while
 * the user talks, on a host with live speech-to-text, and after each part on
 * every host.
 */
export async function dictate(): Promise<string> {
  if ($dictation.get() === 'starting') {
    // The tap came before the microphone was open: it calls the listen off.
    $dictation.set('off')

    return ''
  }

  if ($dictation.get() !== 'off' && finishDictation) {
    finishDictation()

    return ''
  }

  if ($dictation.get() !== 'off' || dictating || $call.get()) {
    return ''
  }

  const audio = duplexAudio
  const api = currentApi()

  if (!audio) {
    throw new Error('This build of the app has no Live voice audio. Install the newest build.')
  }

  if (!api) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  const permission = await requestRecordingPermissionsAsync()

  if (!permission.granted) {
    throw new Error('Hermes has no access to the microphone. Turn it on in the Settings app.')
  }

  stopPlayback?.()
  $dictation.set('starting')
  $dictationWords.set('')
  dictating = true

  const listeners: { remove(): void }[] = []
  let idle: ReturnType<typeof setTimeout> | null = null

  try {
    // Whether the host writes the words down live. A busy host answers late: the
    // microphone does not wait for it, and the words then come when the user stops.
    if (!host) {
      await Promise.race([loadEngines().catch(() => undefined), wait(HOST_WAIT_MS)])
    }

    await audio.start({ inputRate: INPUT_SAMPLE_RATE, frameMs: FRAME_MS, duckGain: 1, speaker: true })

    if (fedOnly) {
      audio.setMuted(true)
    }

    if ($dictation.get() !== 'starting') {
      return ''
    }

    $dictation.set('listening')

    return await new Promise<string>((resolve, reject) => {
      endDictation = resolve

      // The parts the user said so far, one for each stretch of speech between two pauses.
      const said: string[] = []
      // The user talks now, or the words of the last stretch are on their way.
      let inTurn = false
      // The user said "done": the listen ends with the part that is in flight.
      let finishing = false
      const words = (partial = '') => [...said, partial.trim()].filter(Boolean).join(' ')
      const done = () => resolve(words())
      // A listen that hears nothing does not hold the microphone open for ever. The words said so far are kept.
      const waitForSpeech = () => {
        clearTimeout(idle ?? undefined)
        idle = setTimeout(() => !inTurn && done(), DICTATION_QUIET_MS)
      }

      waitForSpeech()

      const ears = new RelayEngine(api, host?.liveStt ?? false, {
        partial: text => $dictationWords.set(words(text)),
        hearing: () => {
          inTurn = true
          clearTimeout(idle ?? undefined)
          $dictation.set('hearing')
        },
        barge: () => undefined,
        transcribing: () => $dictation.set('transcribing'),
        utterance: text => {
          inTurn = false

          if (text) {
            said.push(text.trim())
          }

          $dictationWords.set(words())

          if (finishing) {
            return done()
          }

          // A pause, or a sound that was not speech. The listen goes on until the user ends it.
          $dictation.set('listening')
          waitForSpeech()
        },
        stopWord: () => undefined,
        changed: () => undefined,
        lost: text => reject(new Error(text))
      }, DICTATION_PREROLL_FRAMES, true)

      finishDictation = () => {
        finishing = true

        if (inTurn) {
          // The part in flight ends now, with no wait for a pause.
          ears.finishTurn()
        } else {
          done()
        }
      }

      dictationEngine = ears
      void ears.start()
      listeners.push(
        audio.addListener('onFrame', frame => {
          const fed = injected.shift()

          ears.frame(fed ?? pcmBytes(frame.data), fed ? frameLevel(fed) : frame.level)
        })
      )
    })
  } finally {
    clearTimeout(idle ?? undefined)
    dictating = false
    listeners.forEach(listener => listener.remove())
    dictationEngine?.stop()
    dictationEngine = null
    endDictation = null
    finishDictation = null
    audio.stop()
    $dictationWords.set('')
    $dictation.set('off')
  }
}

let dictationEngine: RelayEngine | null = null
/** A dictation runs, from the tap to the end of its clean-up. */
let dictating = false
/** How long a dictation waits to learn what the host can do, before it starts with no live words. */
const HOST_WAIT_MS = 1500
/**
 * A dictation with no speech for this long ends, and gives the words it has. A person stops to think in
 * the middle of a message, so a short quiet is not the end. A quiet this long is a microphone that was
 * forgotten.
 */
const DICTATION_QUIET_MS = 90_000

export function cancelDictation(): void {
  endDictation?.('')
}

const READ_STEP_MS = 200
// The first sound of a long answer may take this long on a slow host.
const READ_START_MS = 20_000

/**
 * Read one answer aloud, outside a call. The sound starts with the first
 * sentence: the host streams it. The same button stops it.
 */
export async function readAloud(key: string, text: string): Promise<void> {
  if ($reading.get() === key) {
    stopPlayback?.()

    return
  }

  stopPlayback?.()

  const audio = duplexAudio
  const api = currentApi()
  const words = speakable(text)

  if (!audio || !api || !words || $call.get() || $dictation.get() !== 'off') {
    return
  }

  $reading.set(key)

  let stopped = false
  let failure: string | null = null
  const mouth = new RelayEngine(api, false, {
    partial: () => undefined,
    hearing: () => undefined,
    barge: () => undefined,
    transcribing: () => undefined,
    utterance: () => undefined,
    stopWord: () => undefined,
    changed: () => undefined,
    lost: message => {
      failure = message
    }
  })
  let listener: { remove(): void } | null = null

  stopPlayback = () => {
    stopped = true
  }

  try {
    await audio.start({ inputRate: INPUT_SAMPLE_RATE, frameMs: FRAME_MS, duckGain: 1, speaker: true, playbackOnly: true })
    listener = audio.addListener('onPlayback', state => mouth.playback(state.playing))
    await mouth.start()
    mouth.say(words)

    const startedAt = Date.now()
    let sounded = false

    while (!stopped && !failure) {
      await wait(READ_STEP_MS)
      sounded ||= mouth.audible()

      if (sounded ? mouth.quiet() : Date.now() - startedAt > READ_START_MS) {
        break
      }
    }

    if (failure) {
      throw new Error(failure)
    }
  } finally {
    listener?.remove()
    mouth.stop()
    audio.clear()
    audio.stop()
    stopPlayback = null

    if ($reading.get() === key) {
      $reading.set(null)
    }
  }
}

export function clearVoice(): void {
  endCall()
  cancelDictation()
  $reading.set(null)
}
