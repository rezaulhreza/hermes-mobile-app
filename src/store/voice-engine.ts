/**
 * What a call needs from a speech engine. An engine is the ears and the
 * mouth only: it turns the microphone into the user's words and the agent's
 * words into sound. Hermes is the only model; `store/voice.ts` owns the turn.
 */

import type { UserTurn } from '@/core/live-voice'

export type EngineName = 'deepgram' | 'relay' | 'gpt-live'

export interface EngineEvents {
  /** The words of the user so far, while they talk. */
  partial(text: string): void
  /** The user talks and the voice is quiet. */
  hearing(): void
  /** The user talked over the voice. The engine has stopped the voice. */
  barge(): void
  /** A recording is at the backend, which writes it down. */
  transcribing(): void
  /** The user's turn ended with these words. An empty text means nothing was said. */
  utterance(text: string, turn: UserTurn): void
  /** The voice is busy or quiet now. Read `engine.speaking()`. */
  changed(): void
  /** The engine cannot go on. */
  lost(message: string): void
}

export interface VoiceEngine {
  readonly name: EngineName
  start(): Promise<void>
  stop(): void
  /** One frame of the microphone: mono int16 PCM at 16 kHz. */
  frame(pcm: Uint8Array, level: number): void
  /** The speaker started or ended. */
  playback(playing: boolean): void
  /** Text of the answer as it streams. `final` ends the thought: say what is left now. */
  feed(text: string, final?: boolean): void
  /** The answer is complete. Nothing more comes for this turn. */
  endReply(): void
  /** Say one whole line now. */
  say(line: string): void
  /** Stop the voice in the middle of a word and drop what it was going to say. */
  hush(): void
  /** The user asked to send what was said now (a tap). An engine with its own end-of-turn model ignores it. */
  finishTurn(): void
  /** Sound comes out, or is on its way. */
  speaking(): boolean
  /** The voice plays now, or did a moment ago. */
  audible(): boolean
  /** Unix milliseconds of the last line given to the voice. */
  lastSayAt(): number
}

/** Mono int16 PCM that may arrive cut in the middle of a sample. Gives whole samples back. */
export class SampleJoiner {
  private carry: number | null = null

  push(chunk: ArrayBuffer): ArrayBuffer | null {
    const bytes = new Uint8Array(chunk)
    const total = bytes.length + (this.carry === null ? 0 : 1)
    const whole = total - (total % 2)

    if (this.carry === null && whole === bytes.length) {
      return whole ? chunk : null
    }

    const joined = new Uint8Array(whole)
    let at = 0

    if (this.carry !== null && whole) {
      joined[at++] = this.carry
    }

    joined.set(bytes.subarray(0, whole - at), at)
    this.carry = total % 2 ? bytes[bytes.length - 1] : whole ? null : this.carry

    return whole ? joined.buffer : null
  }

  reset(): void {
    this.carry = null
  }
}
