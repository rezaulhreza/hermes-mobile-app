/**
 * The voice call. There is one call at a time, for one conversation. Screens
 * read `$call` and draw it; two views of a call (the full screen and the strip
 * in the chat) are the same call.
 *
 * The loop is: listen, transcribe, ask, speak, listen again. Every await is
 * followed by a check that the call is still this call: the user can end it,
 * or start another, at any point.
 */

import { AudioModule, type AudioRecorder, createAudioPlayer, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'
import { File, Paths } from 'expo-file-system'
import { atom } from 'nanostores'

import {
  advanceListen,
  audioExtension,
  base64Bytes,
  type CallPhase,
  dataUrlParts,
  isGoodbye,
  levelFraction,
  NEW_LISTEN,
  recordingMime,
  speakable
} from '@/core/voice'

import { $conversations, sendDraft, stopTurn } from './chat'
import { currentApi } from './link'

export interface Call {
  sessionId: string
  phase: CallPhase
  muted: boolean
  /** Unix milliseconds. The timer counts from here. */
  startedAt: number
  /** The microphone level, 0 to 1. */
  level: number
  /** What the user said last, as the backend wrote it down. */
  heard: string
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

/** The answer of the turn that just ended: every assistant row after the last message of the user. */
function lastAnswer(sessionId: string): string {
  const items = $conversations.get()[sessionId]?.transcript.items ?? []
  const from = items.map(item => item.kind).lastIndexOf('user')

  return items
    .slice(from + 1)
    .flatMap(item => (item.kind === 'assistant' ? [item.text.trim()] : []))
    .filter(Boolean)
    .join('\n\n')
}

/** Send the words as a message and wait for the end of the turn. Returns the answer. */
async function ask(sessionId: string, words: string, alive: () => boolean): Promise<string> {
  await sendDraft(sessionId, words)

  while (alive() && $conversations.get()[sessionId]?.transcript.running) {
    await wait(150)
  }

  return alive() ? lastAnswer(sessionId) : ''
}

async function loop(sessionId: string, mine: number): Promise<void> {
  const alive = () => generation === mine && $call.get()?.sessionId === sessionId

  while (alive()) {
    try {
      patch({ phase: 'listening', error: null })

      const uri = await listen(alive, level => patch({ level }), () => $call.get()?.muted ?? false)

      if (!uri || !alive()) {
        continue
      }

      patch({ phase: 'transcribing' })

      const words = await transcribe(uri)

      if (!alive() || !words) {
        continue
      }

      if (isGoodbye(words)) {
        return endCall()
      }

      patch({ heard: words, phase: 'thinking' })

      const answer = await ask(sessionId, words, alive)

      if (alive() && answer) {
        patch({ phase: 'speaking' })
        await speak(answer, alive)
      }
    } catch (error) {
      if (!alive()) {
        return
      }

      // The call goes on: one failed round (a dropped request) must not hang up.
      patch({ error: message(error) })
      await wait(1500)
    }
  }
}

/** Start a call in this conversation. Throws when the microphone cannot be used. */
export async function startCall(sessionId: string): Promise<void> {
  endCall()
  await openMicrophone()

  const mine = ++generation

  $call.set({ sessionId, phase: 'listening', muted: false, startedAt: Date.now(), level: 0, heard: '', error: null, full: true })
  void loop(sessionId, mine)
}

export function endCall(): void {
  generation += 1
  stopPlayback?.()
  $call.set(null)
  // The recorder stops in the loop, which sees the new generation on its next step.
  void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined)
}

export function setCallMuted(muted: boolean): void {
  patch({ muted })
}

export function showCallFull(full: boolean): void {
  patch({ full })
}

/**
 * The tap on the circle. While the user talks: send what was said now. While
 * the agent works: stop the turn. While the voice plays: stop it. Each one
 * takes the call back to listening.
 */
export function interruptCall(): void {
  const call = $call.get()

  if (!call) {
    return
  }

  if (call.phase === 'listening') {
    finishNow = true
  } else if (call.phase === 'thinking') {
    void stopTurn(call.sessionId).catch(() => undefined)
  } else if (call.phase === 'speaking') {
    stopPlayback?.()
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
