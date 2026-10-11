/**
 * The wake word on the phone. While it is on and the app is open, the
 * microphone goes to the Hermes host as PCM. When the host hears the phrase,
 * a call starts in a new chat and the voice answers.
 *
 * The microphone belongs to one thing at a time: the wake word gives it to a
 * call and takes it back when the call ends.
 */

import { router } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { requestRecordingPermissionsAsync } from 'expo-audio'
import { atom } from 'nanostores'
import { AppState } from 'react-native'

import type { WakeDetectedPayload, WakeFeedResult, WakeStartResult, WakeStatusResult, WakeStopResult } from '@/core/gateway/gateway-contract.generated'
import { FRAME_MS, INPUT_SAMPLE_RATE, pcmBytes } from '@/core/live-voice'
import { FeedQueue, MAX_FEED_FAILURES, WAKE_OFF, WAKE_REPLY, wakeNotice, type WakeState } from '@/core/wake'
import { duplexAudio } from '@/native/duplex-audio'

import { $conversations, createConversation } from './chat'
import { $linkState, onGatewayEvent, rpc } from './link'
import { $preferences, setPreference } from './preferences'
import { $call, isFedOnly, startCall, takeInjected } from './voice'

export const $wake = atom<WakeState>(WAKE_OFF)

// The phone is a client with a screen, as the desktop is. The host arms the detector for that kind only.
const SURFACE = { surface: 'gui', client_capture: true }
// The first start installs the engine on the host.
const START_TIMEOUT_MS = 180_000

let capture: { remove(): void } | null = null
const queue = new FeedQueue()
let feeding = false
let failures = 0

function patch(change: Partial<WakeState>): void {
  $wake.set({ ...$wake.get(), ...change })
}

function stopCapture(): void {
  if (capture) {
    capture.remove()
    capture = null
    queue.clear()

    // A call has its own use of the audio. Stop it only when no call took it over.
    if (!$call.get()) {
      duplexAudio?.stop()
    }
  }
}

async function drain(): Promise<void> {
  if (feeding) {
    return
  }

  feeding = true

  try {
    for (let pcm = queue.take(); pcm && capture; pcm = queue.take()) {
      const result = await rpc<WakeFeedResult>('wake.feed', { pcm, sample_rate: INPUT_SAMPLE_RATE }).catch(() => null)

      failures = result?.fed ? 0 : failures + 1

      if (failures >= MAX_FEED_FAILURES && capture) {
        stopCapture()
        patch({ listening: false, notice: wakeNotice(result) || 'The host stopped listening for the wake word. Turn it on again.' })
      }
    }
  } finally {
    feeding = false
  }
}

async function startCapture(): Promise<void> {
  const audio = duplexAudio

  if (capture || !audio || $call.get()) {
    return
  }

  failures = 0
  // No voice plays while the phone waits for the phrase, so the microphone needs no echo cancellation.
  await audio.start({ inputRate: INPUT_SAMPLE_RATE, frameMs: FRAME_MS, duckGain: 1, speaker: true })

  if (isFedOnly()) {
    audio.setMuted(true)
  }

  capture = audio.addListener('onFrame', frame => {
    queue.push(takeInjected() ?? pcmBytes(frame.data))
    void drain()
  })
}

/** Read the state of the host, and listen again when the wake word is on there. Called when the link opens. */
export async function syncWake(): Promise<void> {
  try {
    const status = await rpc<WakeStatusResult>('wake.status', SURFACE)

    patch({ available: status.available, phrase: status.phrase || WAKE_OFF.phrase, notice: status.available ? '' : status.hint })

    // The wake word is a choice for each phone: an open microphone is not something the host turns on from afar.
    if (status.available && $preferences.get().wake && (!status.listening || status.owned_by_caller)) {
      await setWake(true)
    }
  } catch {
    // An older host has no wake word methods. The switch stays hidden.
  }
}

/**
 * Turn the wake word on or off for this phone. To turn it on also turns the
 * wake word on in the host's config (`persist`): the host refuses to arm
 * while it is off there. To turn it off here leaves the host's setting alone,
 * because the desktop app uses the same one.
 */
export async function setWake(on: boolean): Promise<void> {
  if ($wake.get().pending) {
    return
  }

  setPreference('wake', on)

  patch({ pending: true, notice: on ? 'Starting. The first time can take a minute: the host installs the engine.' : '' })

  try {
    if (!on) {
      stopCapture()

      const result = await rpc<WakeStopResult>('wake.stop', {})

      return patch({ listening: false, pending: false, notice: result.stopped ? '' : wakeNotice(result) })
    }

    if (!duplexAudio) {
      return patch({ pending: false, notice: 'This build of the app has no call audio. Install the newest build.' })
    }

    if (!(await requestRecordingPermissionsAsync()).granted) {
      return patch({ pending: false, notice: 'Hermes has no access to the microphone. Turn it on in the Settings app.' })
    }

    const result = await rpc<WakeStartResult>('wake.start', { ...SURFACE, persist: true }, START_TIMEOUT_MS)

    if (!result.started) {
      return patch({ listening: false, pending: false, notice: wakeNotice(result) })
    }

    patch({ listening: true, pending: false, notice: '', phrase: result.phrase || $wake.get().phrase })
    await startCapture()
  } catch (error) {
    patch({ listening: false, pending: false, notice: error instanceof Error ? error.message : String(error) })
  }
}

/** The phrase was heard: open a chat, start the call, and answer aloud. */
async function onDetected(payload: WakeDetectedPayload | undefined): Promise<void> {
  // The host has paused its detector. The call takes the microphone.
  stopCapture()
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)

  try {
    const open = Object.values($conversations.get()).at(-1)
    const conversation = payload?.start_new_session === false && open ? open : await createConversation()

    router.push({ pathname: '/chat/[id]', params: { id: conversation.storedId, live: '1' } })
    await startCall(conversation.sessionId, { greeting: WAKE_REPLY })
  } catch (error) {
    patch({ notice: error instanceof Error ? error.message : String(error) })
    await resume()
  }
}

/** Give the microphone back to the wake word. */
async function resume(): Promise<void> {
  if (!$wake.get().listening || $call.get() || AppState.currentState !== 'active') {
    return
  }

  await rpc('wake.resume', {}).catch(() => undefined)
  await startCapture().catch(error => patch({ listening: false, notice: error instanceof Error ? error.message : String(error) }))
}

onGatewayEvent(event => {
  if (event.type === 'wake.detected' && $wake.get().listening) {
    void onDetected(event.payload as WakeDetectedPayload | undefined)
  }
})

// The call ended: listen for the phrase again.
$call.listen(call => {
  if (!call) {
    void resume()
  }
})

// The wake word listens only while the app is on screen. In the background the microphone is closed.
AppState.addEventListener('change', state => {
  if (state === 'active') {
    void resume()
  } else if (!$call.get()) {
    stopCapture()
  }
})

$linkState.listen(state => {
  if (state === 'open') {
    void syncWake()
  } else {
    stopCapture()
  }
})

export function clearWake(): void {
  stopCapture()
  $wake.set(WAKE_OFF)
}
