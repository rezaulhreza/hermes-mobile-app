/**
 * The wake word: the user says the phrase ("hey hermes") and a call starts.
 * The detector runs on the Hermes host. The phone sends it the microphone as
 * PCM (`wake.feed`) after `wake.start`, and the host answers with the event
 * `wake.detected`. This file has the rules with no audio in them.
 */

import { bytesBase64 } from './live-voice'

export interface WakeState {
  /** The host has a wake word engine. */
  available: boolean
  /** The phone listens for the phrase now. */
  listening: boolean
  phrase: string
  /** Why it does not listen, in words for the user. Empty when all is well. */
  notice: string
  /** A start or a stop is on its way. The first start can take a minute: the host installs the engine. */
  pending: boolean
}

export const WAKE_OFF: WakeState = { available: false, listening: false, phrase: 'hey hermes', notice: '', pending: false }

/** What the voice says when the phrase was heard, so the user knows the call is open with no look at the screen. */
export const WAKE_REPLY = 'Yes?'

const REASONS: Readonly<Record<string, string>> = {
  unavailable: 'This Hermes host has no wake word engine.',
  disabled: 'The wake word is off on this Hermes host.',
  disabled_for_surface: 'The wake word of this Hermes host is set for another kind of app (wake_word.surface in config.yaml).',
  owned: 'Another app listens for the wake word on this Hermes host. Turn it off there first.',
  not_owner: 'Another app listens for the wake word on this Hermes host.'
}

/** A refusal of the host as words for the user. */
export function wakeNotice(result: { reason?: string | null; hint?: string | null; owner_surface?: string | null } | null | undefined): string {
  const reason = result?.reason ?? ''

  if (reason === 'owned' && result?.owner_surface) {
    return `The ${result.owner_surface === 'gui' ? 'desktop app' : result.owner_surface} listens for the wake word on this Hermes host. Turn it off there first.`
  }

  return REASONS[reason] ?? result?.hint ?? (reason ? `The host refused: ${reason}.` : '')
}

/** Frames are sent four at a time: three calls a second, not twelve. */
export const FRAMES_PER_FEED = 4
/** With a slow link the oldest frames go, so the detector hears recent sound with no gap inside it. */
const MAX_QUEUED_FRAMES = 24

/** The frames that wait for the host. */
export class FeedQueue {
  private frames: Uint8Array[] = []

  push(frame: Uint8Array): void {
    this.frames.push(frame)

    if (this.frames.length > MAX_QUEUED_FRAMES) {
      this.frames.splice(0, this.frames.length - MAX_QUEUED_FRAMES)
    }
  }

  /** The next `pcm` text for `wake.feed`, or null when a full group has not come yet. */
  take(): string | null {
    if (this.frames.length < FRAMES_PER_FEED) {
      return null
    }

    const group = this.frames.splice(0, FRAMES_PER_FEED)
    const joined = new Uint8Array(group.reduce((sum, frame) => sum + frame.length, 0))
    let at = 0

    for (const frame of group) {
      joined.set(frame, at)
      at += frame.length
    }

    return bytesBase64(joined)
  }

  clear(): void {
    this.frames = []
  }
}

/** Refused feeds in a row before the phone stops and says so: the host no longer listens for this phone. */
export const MAX_FEED_FAILURES = 5
