/**
 * The audio of a live call: the microphone as PCM frames and a PCM queue to
 * the speaker, both at once, with echo cancellation. The native side is
 * `modules/hermes-duplex-audio` (iOS: AVAudioEngine with voice processing).
 */

import { requireOptionalNativeModule } from 'expo'
import type { EventSubscription } from 'expo-modules-core'

export interface DuplexOptions {
  /** The rate of the microphone frames, in Hz. */
  inputRate: number
  /** The length of one frame, in milliseconds. */
  frameMs: number
  /** The gain of the microphone while the voice plays. 1 leaves it alone. */
  duckGain: number
  speaker: boolean
  /** Echo cancellation. On by default; off is for a check of the hardware only. */
  voiceProcessing?: boolean
  /** The speaker only, with no microphone: an answer read aloud outside a call. */
  playbackOnly?: boolean
}

export interface MicFrame {
  /** Mono int16 PCM, little-endian, as base64 text. */
  data: string
  /** 0 to 1. */
  level: number
}

interface DuplexModule {
  start(options: DuplexOptions): Promise<{ voiceProcessing: boolean }>
  stop(): void
  /** Numbers for a check of the audio path. */
  stats(): { taps: number; convertFailures: number; hardware: string; running: boolean; voiceProcessing: boolean }
  /** Queue mono int16 PCM at this rate. */
  play(pcm: ArrayBuffer, sampleRate: number): void
  /** Queue one encoded sound (MP3, WAV, M4A) behind what plays now. */
  playEncoded(sound: ArrayBuffer, fileExtension: string): void
  /** Drop what is queued, in the middle of a word. */
  clear(): void
  setMuted(muted: boolean): void
  setSpeaker(speaker: boolean): void
  addListener(event: 'onFrame', listener: (frame: MicFrame) => void): EventSubscription
  addListener(event: 'onPlayback', listener: (state: { playing: boolean }) => void): EventSubscription
  addListener(event: 'onInterruption', listener: (state: { reason: 'began' | 'ended' | 'failed'; message?: string }) => void): EventSubscription
}

/** Null in a build made before the module was added. */
export const duplexAudio = requireOptionalNativeModule<DuplexModule>('HermesDuplexAudio')
