/**
 * The live call: both sides talk at the same time, as on the desktop.
 *
 * The rules here are the rules of the desktop's `deepgram-live` plugin
 * (`~/.hermes/desktop-plugins/deepgram-live/plugin.js`), so a call on the
 * phone and a call on the desktop behave the same. The microphone stays open
 * while the agent speaks. The answer is spoken sentence by sentence while it
 * streams. Words over the voice stop the voice (barge-in).
 *
 * This file has no audio and no sockets in it, so it can be tested.
 */

/** What `GET /api/plugins/deepgram-live/status` answers. */
export interface DeepgramSettings {
  available: boolean
  reason?: string | null
  voice: string
  listen_model: string
  eot_threshold: number
  eot_timeout_ms: number
  speed: number
  keyterms: string[]
  mip_opt_out: boolean
}

export const INPUT_SAMPLE_RATE = 16_000
export const OUTPUT_SAMPLE_RATE = 24_000
/** The listening model is tuned for frames of this length. */
export const FRAME_MS = 80

// Deepgram rate-limits Flush on the speak socket. The first sentence of a
// reply is flushed at once, so speech starts with no delay.
export const FLUSH_MIN_INTERVAL_MS = 3200
export const SPEAK_TEXT_LIMIT = 1000
/**
 * The gain of the microphone while the voice plays. The desktop ducks to 0.2,
 * because a browser's echo cancellation leaves some of the speaker in the
 * microphone. The phone's voice processing leaves none, and it already makes
 * the user quieter while the voice plays: with 0.2 on top the listening model
 * heard no words at all over the voice, so nothing could interrupt it.
 */
export const MIC_GAIN_WITH_ECHO_CANCELLING = 1
/**
 * Speech reported this soon after playback ends may still be the speaker. The
 * desktop uses 350 ms. On the phone a report is later: the microphone gives
 * 100 ms buffers, and the frame then goes to the listening model and back. A
 * call heard the end of its own answer 460 ms after playback ended.
 */
export const PLAYBACK_TAIL_MS = 900
const ECHO_MEMORY_MS = 20_000
/** A tool that starts with nothing said recently gets a stock line, so long work is never silent. */
export const TOOL_LINE_QUIET_MS = 2500

export function listenUrl(settings: DeepgramSettings): string {
  const params = [
    ['encoding', 'linear16'],
    ['eot_threshold', String(settings.eot_threshold)],
    ['eot_timeout_ms', String(settings.eot_timeout_ms)],
    ['mip_opt_out', String(settings.mip_opt_out !== false)],
    ['model', settings.listen_model],
    ['sample_rate', String(INPUT_SAMPLE_RATE)],
    ...(settings.keyterms ?? []).map(term => ['keyterm', term])
  ]

  return `wss://api.deepgram.com/v2/listen?${query(params)}`
}

export function speakUrl(settings: DeepgramSettings): string {
  const params = [
    ['encoding', 'linear16'],
    ['mip_opt_out', String(settings.mip_opt_out !== false)],
    ['model', settings.voice],
    ['sample_rate', String(OUTPUT_SAMPLE_RATE)]
  ]

  if (Number(settings.speed) && Number(settings.speed) !== 1) {
    params.push(['speed', String(settings.speed)])
  }

  return `wss://api.deepgram.com/v1/speak?${query(params)}`
}

function query(params: string[][]): string {
  return params.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
}

/** Lowercase words only: the form in which a transcript and spoken text are compared. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One line of an answer as words to say. The agent is asked for plain prose on a spoken turn; a model can still write Markdown. */
export function speakableLine(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|]+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const BOUNDARY = /[.!?…]["')\]]*\s+|\n+/g
// Short parts ("Sure.", "1.") sound better with what follows.
const MIN_SENTENCE = 24

/**
 * Streamed answer text in, whole sentences out. Code is on the screen and is
 * never read aloud: a code block that has not closed holds back what follows it.
 */
export class SentenceFeed {
  private pending = ''

  /** Add text. Returns the sentences that are complete now. `final` returns all that is left. */
  feed(text: string, final = false): string[] {
    this.pending += text

    let ready = this.pending.replace(/```[\s\S]*?```/g, ' ')
    let held = ''
    const fence = ready.indexOf('```')

    if (fence !== -1) {
      held = ready.slice(fence)
      ready = ready.slice(0, fence)
    }

    if (final) {
      this.pending = ''

      return ready.trim() ? [ready] : []
    }

    const lines: string[] = []
    let cut = 0

    for (const match of ready.matchAll(BOUNDARY)) {
      const end = match.index + match[0].length

      if (end - cut >= MIN_SENTENCE) {
        lines.push(ready.slice(cut, end))
        cut = end
      }
    }

    this.pending = ready.slice(cut) + held

    return lines
  }

  clear(): void {
    this.pending = ''
  }
}

/**
 * What the voice said in the last seconds. The microphone can hear the
 * speaker; a transcript that is only those words is an echo, not the user.
 */
export class EchoMemory {
  private spoken: { at: number; text: string }[] = []

  remember(line: string, now: number): void {
    this.spoken = [...this.recent(now), { at: now, text: normalise(line) }]
  }

  isEcho(transcript: string, now: number): boolean {
    const heard = normalise(transcript)

    if (!heard) {
      return true
    }

    const recent = this.recent(now)
      .map(entry => entry.text)
      .join(' ')
    const words = heard.split(' ')

    if (words.length > 3) {
      return recent.includes(heard)
    }

    const said = new Set(recent.split(' '))

    return words.every(word => said.has(word))
  }

  private recent(now: number) {
    return this.spoken.filter(entry => now - entry.at < ECHO_MEMORY_MS)
  }
}

/** One turn of the user, as the listening model reports it. */
export interface UserTurn {
  /** The turn began while the voice played. */
  duringPlayback: boolean
  /** The user's words broke through the voice. */
  barged: boolean
}

export const NEW_TURN: UserTurn = { duringPlayback: false, barged: false }

export interface TurnInfo {
  event?: string
  transcript?: string
}

export interface TurnStep {
  turn: UserTurn
  /** Stop the voice now: the user talks over it. */
  hush: boolean
  /** The user talks and the voice is quiet: show "hearing". */
  hearing: boolean
  /** The words so far, for the screen. */
  partial: string
  /** The turn ended with these words. Send them. */
  utterance: string | null
}

/**
 * One `TurnInfo` message of the listening model later. `audible` says the
 * voice plays now or did a moment ago; `isEcho` says a transcript is only the
 * voice itself.
 */
export function advanceTurn(turn: UserTurn, info: TurnInfo, audible: boolean, isEcho: (transcript: string) => boolean): TurnStep {
  const transcript = String(info.transcript ?? '').trim()
  let next = turn

  if (info.event === 'StartOfTurn') {
    next = { barged: false, duringPlayback: audible }
  }

  if (info.event === 'StartOfTurn' || info.event === 'Update') {
    const hush = audible && !next.barged && Boolean(transcript) && !isEcho(transcript)

    if (hush) {
      next = { ...next, barged: true }
    }

    // Words under the voice that did not break through are the voice: they are not shown.
    const own = !next.duringPlayback || next.barged

    return { turn: next, hush, hearing: !audible || hush, partial: own ? transcript : '', utterance: null }
  }

  if (info.event !== 'EndOfTurn') {
    return { turn: next, hush: false, hearing: false, partial: '', utterance: null }
  }

  // A turn that began under the voice and never broke through it is the voice itself.
  const real = Boolean(transcript) && !(next.duringPlayback && !next.barged)

  return { turn: NEW_TURN, hush: false, hearing: false, partial: '', utterance: real ? transcript : null }
}

const STOP_PHRASES = new Set(['stop', 'stop listening', 'goodbye', 'bye', 'end voice chat', 'end the call', 'end call', 'hang up'])

/** Words that end the call when they are all the user said. */
export function isStopPhrase(transcript: string): boolean {
  return STOP_PHRASES.has(normalise(transcript))
}

// Approval by voice is narrow on purpose: the whole utterance must match, and
// it allows this one call, never "always". Anything else is asked again.
const APPROVE_PHRASES = new Set([
  'yes',
  'yeah',
  'yep',
  'yes please',
  'approve',
  'approved',
  'go ahead',
  'yes go ahead',
  'do it',
  'yes do it',
  'run it',
  'yes run it',
  'allow it',
  'yes allow it',
  'let it',
  'yes let it'
])
const DENY_PATTERN = /^(no|nope|no thanks|deny|denied|dont|do not|cancel|stop|reject)\b/

export type SpokenVerdict = 'deny' | 'once' | 'unclear'

/**
 * What a spoken answer to "Should I let it?" means. To allow, the answer must
 * be clear and must start after the question ended: an answer that began over
 * the voice could be the voice. To block is accepted at any time.
 */
export function spokenVerdict(transcript: string, turn: UserTurn): SpokenVerdict {
  const heard = normalise(transcript)

  if (DENY_PATTERN.test(heard)) {
    return 'deny'
  }

  return APPROVE_PHRASES.has(heard) && !turn.duringPlayback ? 'once' : 'unclear'
}

const TOOL_LINES: readonly (readonly [RegExp, string])[] = [
  [/^(terminal|shell|bash|process|execute_code)/, 'Running a command.'],
  [/^(read_file|search_files|list_|file_)/, 'Looking through the files.'],
  [/^(write_file|patch|edit)/, 'Making an edit.'],
  [/^(web_search|web_extract|x_search)/, 'Searching the web.'],
  [/^(browser|open_preview|read_preview|drive_preview)/, 'Using the browser.'],
  [/^computer_use/, 'Working on your screen.'],
  [/^(memory|session_search)/, 'Checking my memory.'],
  [/^(delegate|subagent)/, 'Handing part of this to a helper.'],
  [/^(image_generate|vision)/, 'Working on an image.']
]

/** The line said when a tool starts in silence. */
export function toolLine(name: unknown): string {
  const tool = String(name || '').toLowerCase()

  for (const [pattern, line] of TOOL_LINES) {
    if (pattern.test(tool)) {
      return line
    }
  }

  return tool ? `Using ${tool.replace(/[_-]+/g, ' ')}.` : 'Working on it.'
}

/** An approval as words. The question never has an accepting word in it, so the microphone cannot approve by hearing the voice ask. */
export function approvalQuestion(approval: { description?: string; command?: string }): string {
  const description = String(approval.description || '').replace(/\s+/g, ' ').trim()
  const command = String(approval.command || '').replace(/\s+/g, ' ').trim()
  const what =
    description && command && command.length <= 80
      ? `${description}. The command is: ${command}`
      : description || (command ? `run this command: ${command.slice(0, 120)}` : 'run a command')

  return `Hermes wants to ${what}. Should I let it?`
}

/**
 * When the next Flush may go to the speak socket: 0 for now, else the wait in
 * milliseconds.
 */
export function flushWait(lastFlushAt: number, now: number): number {
  return Math.max(0, lastFlushAt + FLUSH_MIN_INTERVAL_MS - now)
}

/** Cut a line into parts the speak socket takes. */
export function speakParts(line: string): string[] {
  const parts: string[] = []

  for (let index = 0; index < line.length; index += SPEAK_TEXT_LIMIT) {
    parts.push(line.slice(index, index + SPEAK_TEXT_LIMIT))
  }

  return parts
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = (() => {
  const table = new Uint8Array(128)

  for (let index = 0; index < BASE64.length; index++) {
    table[BASE64.charCodeAt(index)] = index
  }

  return table
})()

/** The bytes of clean base64 text (no line breaks). One microphone frame comes this way 12 times a second. */
export function pcmBytes(base64: string): Uint8Array {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const bytes = new Uint8Array((base64.length / 4) * 3 - padding)
  let at = 0

  for (let index = 0; index < base64.length; index += 4) {
    const chunk =
      (LOOKUP[base64.charCodeAt(index)] << 18) |
      (LOOKUP[base64.charCodeAt(index + 1)] << 12) |
      (LOOKUP[base64.charCodeAt(index + 2)] << 6) |
      LOOKUP[base64.charCodeAt(index + 3)]

    bytes[at++] = chunk >> 16

    if (at < bytes.length) {
      bytes[at++] = (chunk >> 8) & 255
    }

    if (at < bytes.length) {
      bytes[at++] = chunk & 255
    }
  }

  return bytes
}

/** A WAV file (mono, 16 bit) around PCM frames, for a backend route that takes a recording. */
export function wavFile(frames: readonly Uint8Array[], sampleRate: number): Uint8Array {
  const size = frames.reduce((sum, frame) => sum + frame.length, 0)
  const file = new Uint8Array(44 + size)
  const view = new DataView(file.buffer)
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + size, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, size, true)

  let at = 44

  for (const frame of frames) {
    file.set(frame, at)
    at += frame.length
  }

  return file
}

/** Bytes as base64 text. */
export function bytesBase64(bytes: Uint8Array): string {
  let text = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index]
    const b = bytes[index + 1] ?? 0
    const c = bytes[index + 2] ?? 0

    text += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4)]
    text += index + 1 < bytes.length ? BASE64[((b & 15) << 2) | (c >> 6)] : '='
    text += index + 2 < bytes.length ? BASE64[c & 63] : '='
  }

  return text
}

/** The loudness of one PCM frame as the native side reports it: 0 to 1. */
export function frameLevel(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2))
  let energy = 0

  for (let offset = 0; offset < view.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true)

    energy += sample * sample
  }

  return view.byteLength ? Math.min(1, (Math.sqrt(energy / (view.byteLength / 2)) / 32768) * 6) : 0
}
