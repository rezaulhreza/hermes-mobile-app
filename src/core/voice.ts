/**
 * A voice call with the agent: the user talks, the agent answers aloud.
 *
 * The phone has the microphone and the speaker; the backend has the speech
 * models. One round is: listen until the user stops talking, send the
 * recording for a transcript, send the transcript as a message, wait for the
 * answer, get the answer as speech, play it, listen again.
 *
 * This file has the rules with no audio in them, so they can be tested.
 */

export type CallPhase =
  /** The audio and the speech engine start. */
  | 'connecting'
  /** The microphone is open and waits for the user. */
  | 'listening'
  /** The user talks. */
  | 'hearing'
  /** The recording is at the backend, which writes it down. */
  | 'transcribing'
  /** The agent works on the answer. */
  | 'thinking'
  /** The answer plays. The microphone is still open. */
  | 'speaking'

export const PHASE_HEADING: Readonly<Record<CallPhase, string>> = {
  connecting: 'Connecting.',
  listening: 'I’m listening.',
  hearing: 'I hear you.',
  transcribing: 'Got it.',
  thinking: 'Working on it.',
  speaking: 'Speaking.'
}

/** The line under the heading when there are no words to show yet. */
export const PHASE_HINT: Readonly<Record<CallPhase, string>> = {
  connecting: 'One moment.',
  listening: 'Say what you need. The conversation stays in this chat.',
  hearing: 'Go on. I answer when you stop.',
  transcribing: 'Writing down what you said.',
  thinking: 'Your agent is on it. Talk, or tap the circle, to stop it.',
  speaking: 'Talk over the voice, or tap the circle, to stop it.'
}

/** "00:07", "12:40", "1:02:03" for the call timer. */
export function callTimer(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const pair = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)

  return hours ? `${hours}:${pair(Math.floor((total % 3600) / 60))}:${pair(total % 60)}` : `${pair(Math.floor(total / 60))}:${pair(total % 60)}`
}

/**
 * The state of one listen. The recorder gives a level in decibels a few times
 * a second (0 is the loudest, -160 is silence). The listen ends when the user
 * has spoken and then been quiet for a moment.
 */
export interface Listen {
  /** The user has said something in this listen. */
  spoke: boolean
  /** Milliseconds of quiet since the last sound. */
  quietMs: number
  /** Milliseconds of sound in total. A cough is not a sentence. */
  loudMs: number
  /** Milliseconds since the listen began. */
  totalMs: number
}

export const NEW_LISTEN: Listen = { spoke: false, quietMs: 0, loudMs: 0, totalMs: 0 }

// A level above this is a voice near the phone. A quiet room is near -50.
const SPEECH_DB = -38
// Shorter than this is a click or a cough.
const SPEECH_MIN_MS = 250
// A pause inside a sentence is shorter than this.
const END_QUIET_MS = 1300
// One utterance is cut here, so a noisy room cannot record without end.
const LISTEN_MAX_MS = 60_000

export type ListenStep = { listen: Listen; done: false } | { listen: Listen; done: true; reason: 'said' | 'long' }

/** One level sample later. `done` says the recording is ready to send. */
export function advanceListen(listen: Listen, levelDb: number | undefined, stepMs: number, endQuietMs = END_QUIET_MS): ListenStep {
  const loud = (levelDb ?? -160) > SPEECH_DB
  const loudMs = listen.loudMs + (loud ? stepMs : 0)
  const next: Listen = {
    spoke: listen.spoke || loudMs >= SPEECH_MIN_MS,
    quietMs: loud ? 0 : listen.quietMs + stepMs,
    loudMs,
    totalMs: listen.totalMs + stepMs
  }

  if (next.spoke && next.quietMs >= endQuietMs) {
    return { listen: next, done: true, reason: 'said' }
  }

  return next.spoke && next.totalMs >= LISTEN_MAX_MS ? { listen: next, done: true, reason: 'long' } : { listen: next, done: false }
}

// The speech model reads what it is given. A long answer is cut at a sentence so the voice does not go on for minutes.
const SPEAK_MAX_CHARS = 1400

/**
 * An answer as words to say. Markdown marks are not said, code is named and
 * not read, a table is named, a link is its text.
 */
export function speakable(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, ' (there is code on the screen) ')
    .replace(/^\s*\|.*\|\s*$/gm, '§')
    .replace(/(§\s*)+/g, ' (there is a table on the screen) ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' a link ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length <= SPEAK_MAX_CHARS) {
    return text
  }

  const cut = text.slice(0, SPEAK_MAX_CHARS)
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))

  return `${sentence > SPEAK_MAX_CHARS / 2 ? cut.slice(0, sentence + 1) : cut} The rest is on the screen.`
}

/** The parts of a `data:` address: the type and the base64 text. Null when it is not one. */
export function dataUrlParts(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+)[^,]*;base64,(.+)$/s.exec(dataUrl)

  return match ? { mime: match[1], base64: match[2] } : null
}

export function audioExtension(mime: string): string {
  return mime.includes('wav') ? 'wav' : mime.includes('ogg') || mime.includes('opus') ? 'ogg' : mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a') ? 'm4a' : 'mp3'
}

/** Words that end a call when they are all the user said. */
const GOODBYE = /^(stop|goodbye|bye|end (the )?call|hang up|that'?s all( thanks)?)[.!]?$/i

export function isGoodbye(transcript: string): boolean {
  return GOODBYE.test(transcript.trim())
}
