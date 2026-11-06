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
  /** The language the host is set to: en-GB, fr, multi, … */
  language?: string | null
  /** A language for the multilingual listening model, from the host or the phone. */
  language_hint?: string | null
  /** flux (ten languages, with turn events) or nova (every other language; a pause ends a turn). */
  listen_engine?: 'flux' | 'nova'
  /** How lively a Flux voice sounds, -2 (calm) to 2 (animated). */
  expressivity?: number
  /** Spoken numbers as digits ("25", "10 pm"). On when the host does not say. */
  numerals?: boolean
}

/** A voice of the Deepgram speech model that a call can use. */
export interface VoiceChoice {
  id: string
  name: string
  /** How it sounds, in two or three words. */
  tone: string
}

/** The languages a phone can choose for Live voice: every language Deepgram hears live. */
export const LANGUAGES: readonly { code: string; name: string }[] = [
  ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['en-AU', 'English (Australia)'], ['en-IN', 'English (India)'],
  ['en-NZ', 'English (New Zealand)'], ['en-CA', 'English (Canada)'], ['multi', 'Any language'],
  ['af', 'Afrikaans'], ['ar', 'Arabic'], ['bn', 'Bangla'], ['be', 'Belarusian'], ['bs', 'Bosnian'], ['bg', 'Bulgarian'],
  ['zh-HK', 'Cantonese'], ['ca', 'Catalan'], ['zh', 'Chinese (Mandarin)'], ['hr', 'Croatian'], ['cs', 'Czech'], ['da', 'Danish'],
  ['nl', 'Dutch'], ['et', 'Estonian'], ['fi', 'Finnish'], ['nl-BE', 'Flemish'], ['fr', 'French'], ['gl', 'Galician'], ['de', 'German'],
  ['el', 'Greek'], ['gu', 'Gujarati'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['hu', 'Hungarian'], ['id', 'Indonesian'], ['it', 'Italian'],
  ['ja', 'Japanese'], ['kn', 'Kannada'], ['ko', 'Korean'], ['lv', 'Latvian'], ['lt', 'Lithuanian'], ['mk', 'Macedonian'], ['ms', 'Malay'],
  ['mr', 'Marathi'], ['no', 'Norwegian'], ['fa', 'Persian'], ['pl', 'Polish'], ['pt', 'Portuguese'], ['ro', 'Romanian'], ['ru', 'Russian'],
  ['sr', 'Serbian'], ['sk', 'Slovak'], ['sl', 'Slovenian'], ['es', 'Spanish'], ['sv', 'Swedish'], ['tl', 'Tagalog'], ['ta', 'Tamil'],
  ['te', 'Telugu'], ['th', 'Thai'], ['tr', 'Turkish'], ['uk', 'Ukrainian'], ['vi', 'Vietnamese'], ['xh', 'Xhosa'], ['zu', 'Zulu']
].map(([code, name]) => ({ code, name }))

/** The language name for a code, or the code itself. */
export function languageName(code: string): string {
  return LANGUAGES.find(language => language.code === code)?.name ?? code
}

/** A Flux voice speaks on Deepgram's second speak address. */
export function isFluxVoice(settings: DeepgramSettings): boolean {
  return settings.voice.startsWith('flux-')
}

const FLUX_VOICES: readonly VoiceChoice[] = [
  { id: 'flux-colin-en', name: 'Colin', tone: 'Flux. British, warm and trusted' },
  { id: 'flux-kit-en', name: 'Kit', tone: 'Flux. British, friendly and lively' },
  { id: 'flux-gemma-en', name: 'Gemma', tone: 'Flux. British, kind and happy' },
  { id: 'flux-jack-en', name: 'Jack', tone: 'Flux. British, clear and thoughtful' },
  { id: 'flux-sean-en', name: 'Sean', tone: 'Flux. British, calm and mature' },
  { id: 'flux-maeve-en', name: 'Maeve', tone: 'Flux. Irish, friendly and gentle' },
  { id: 'flux-hannah-en', name: 'Hannah', tone: 'Flux. American, clear and sure' },
  { id: 'flux-alexis-en', name: 'Alexis', tone: 'Flux. American, calm and caring' },
  { id: 'flux-miles-en', name: 'Miles', tone: 'Flux. American, calm and sincere' },
  { id: 'flux-drew-en', name: 'Drew', tone: 'Flux. American, relaxed and soft' },
  { id: 'flux-camille-fr', name: 'Camille', tone: 'Flux. French' },
  { id: 'flux-julien-fr', name: 'Julien', tone: 'Flux. French' },
  { id: 'flux-nadine-de', name: 'Nadine', tone: 'Flux. German' },
  { id: 'flux-moritz-de', name: 'Moritz', tone: 'Flux. German' },
  { id: 'flux-carmen-es', name: 'Carmen', tone: 'Flux. Spanish' },
  { id: 'flux-rafael-es', name: 'Rafael', tone: 'Flux. Spanish' },
  { id: 'flux-sofia-it', name: 'Sofia', tone: 'Flux. Italian' },
  { id: 'flux-matteo-it', name: 'Matteo', tone: 'Flux. Italian' },
  { id: 'flux-mariana-pt', name: 'Mariana', tone: 'Flux. Portuguese' },
  { id: 'flux-sanne-nl', name: 'Sanne', tone: 'Flux. Dutch' },
  { id: 'flux-anjali-hi', name: 'Anjali', tone: 'Flux. Hindi' },
  { id: 'flux-natalia-ru', name: 'Natalia', tone: 'Flux. Russian' },
  { id: 'flux-sayaka-ja', name: 'Sayaka', tone: 'Flux. Japanese' }
]

/** Voices of Deepgram's second Aura family, English, then the Flux voices. The id is the model name the speak socket takes. */
export const DEEPGRAM_VOICES: readonly VoiceChoice[] = [
  { id: 'aura-2-thalia-en', name: 'Thalia', tone: 'Clear and bright' },
  { id: 'aura-2-andromeda-en', name: 'Andromeda', tone: 'Easy and warm' },
  { id: 'aura-2-helena-en', name: 'Helena', tone: 'Friendly and calm' },
  { id: 'aura-2-luna-en', name: 'Luna', tone: 'Young and light' },
  { id: 'aura-2-athena-en', name: 'Athena', tone: 'Calm and smooth' },
  { id: 'aura-2-apollo-en', name: 'Apollo', tone: 'Sure and easy' },
  { id: 'aura-2-arcas-en', name: 'Arcas', tone: 'Natural and smooth' },
  { id: 'aura-2-aries-en', name: 'Aries', tone: 'Warm and lively' },
  { id: 'aura-2-orion-en', name: 'Orion', tone: 'Calm and polite' },
  { id: 'aura-2-zeus-en', name: 'Zeus', tone: 'Deep and steady' },
  { id: 'aura-2-pandora-en', name: 'Pandora', tone: 'British, smooth and calm' },
  { id: 'aura-2-draco-en', name: 'Draco', tone: 'British, warm and deep' },
  ...FLUX_VOICES
]

/** The name of a voice for a person: "Thalia" for `aura-2-thalia-en`. A voice the list does not have shows its own middle word. */
export function voiceName(id: string): string {
  const known = DEEPGRAM_VOICES.find(voice => voice.id === id)

  if (known) {
    return known.name
  }

  const word = id.replace(/^(aura(-\d+)?|flux)-/, '').replace(/-[a-z]{2}$/, '')

  return word ? word.charAt(0).toUpperCase() + word.slice(1) : 'The voice of the host'
}

/** How lively a Flux voice sounds. The same names and order as the desktop plugin and Brah. Aura voices ignore it. */
export const EXPRESSIVITY: readonly { value: number; name: string }[] = [
  { value: -2, name: 'Calm' },
  { value: -1, name: 'Quiet' },
  { value: 0, name: 'Normal' },
  { value: 1, name: 'Lively' },
  { value: 2, name: 'Animated' }
]

/** The name of an expressivity level: "Lively" for 1. */
export function expressivityName(value: number): string {
  return EXPRESSIVITY.find(level => level.value === value)?.name ?? 'Normal'
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
/** A line is kept this long after its sound: the listening model reports late, and the time of the sound is an estimate. */
const ECHO_MEMORY_MS = 20_000
/** The voice says about this many characters in a second. For the time at which a line that waits will sound. */
const SPOKEN_CHARS_PER_SECOND = 14
/** A tool that starts with nothing said recently gets a stock line, so long work is never silent. */
export const TOOL_LINE_QUIET_MS = 2500

export function listenUrl(settings: DeepgramSettings): string {
  if (settings.listen_engine === 'nova') {
    return novaListenUrl(settings)
  }

  const params = [
    ['encoding', 'linear16'],
    ['eot_threshold', String(settings.eot_threshold)],
    ['eot_timeout_ms', String(settings.eot_timeout_ms)],
    ['mip_opt_out', String(settings.mip_opt_out !== false)],
    ['model', settings.listen_model],
    ['numerals', String(settings.numerals !== false)],
    ['sample_rate', String(INPUT_SAMPLE_RATE)],
    ...(settings.keyterms ?? []).map(term => ['keyterm', term]),
    ...(settings.language_hint ? [['language_hint', settings.language_hint]] : [])
  ]

  return `wss://api.deepgram.com/v2/listen?${query(params)}`
}

/** Nova-3 with many languages: the chosen one as a hint. A second of quiet sends UtteranceEnd. */
function novaListenUrl(settings: DeepgramSettings): string {
  const params = [
    ['encoding', 'linear16'],
    ['endpointing', '300'],
    ['interim_results', 'true'],
    ['language', 'multi'],
    ['mip_opt_out', String(settings.mip_opt_out !== false)],
    ['model', 'nova-3'],
    ['numerals', 'true'],
    ['sample_rate', String(INPUT_SAMPLE_RATE)],
    ['smart_format', 'true'],
    ['utterance_end_ms', '1000'],
    ...(settings.keyterms ?? []).map(term => ['keyterm', term]),
    ...(settings.language_hint ? [['language_hint', settings.language_hint]] : [])
  ]

  return `wss://api.deepgram.com/v1/listen?${query(params)}`
}

/** Turns from Nova-3: the first words start a turn, a second of quiet (UtteranceEnd) ends it.
 *  It gives the TurnInfo messages Flux sends, so the call code stays the same. Other messages pass through. */
export class NovaTurns {
  private finals: string[] = []
  private interim = ''
  private active = false

  private words(): string {
    return [...this.finals, this.interim].filter(Boolean).join(' ')
  }

  feed(message: Record<string, unknown> | null): Record<string, unknown>[] {
    if (!message) {
      return []
    }

    if (message.type === 'Results') {
      const channel = message.channel as { alternatives?: { transcript?: string }[] } | undefined
      const text = String(channel?.alternatives?.[0]?.transcript ?? '').trim()

      if (!text) {
        return []
      }

      if (message.is_final) {
        this.finals.push(text)
        this.interim = ''
      } else {
        this.interim = text
      }

      const events: Record<string, unknown>[] = []

      if (!this.active) {
        this.active = true
        events.push({ type: 'TurnInfo', event: 'StartOfTurn', transcript: this.words() })
      }

      events.push({ type: 'TurnInfo', event: 'Update', transcript: this.words() })

      return events
    }

    if (message.type === 'UtteranceEnd') {
      const said = this.words()
      const ended = this.active && Boolean(said)

      this.finals = []
      this.interim = ''
      this.active = false

      return ended ? [{ type: 'TurnInfo', event: 'EndOfTurn', transcript: said }] : []
    }

    return [message]
  }
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

  if (!isFluxVoice(settings)) {
    return `wss://api.deepgram.com/v1/speak?${query(params)}`
  }

  if (Number(settings.expressivity)) {
    params.push(['expressivity', String(Math.trunc(Number(settings.expressivity)))])
  }

  return `wss://api.deepgram.com/v2/speak?${query(params)}`
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

// The listening model writes "I am" where the voice was given "I'm", and the other way round.
const CONTRACTIONS: readonly (readonly [RegExp, string])[] = [
  [/\b(can)[’']t\b/g, '$1 not'],
  [/\b(won)[’']t\b/g, 'will not'],
  [/n[’']t\b/g, ' not'],
  [/[’']m\b/g, ' am'],
  [/[’']re\b/g, ' are'],
  [/[’']ve\b/g, ' have'],
  [/[’']ll\b/g, ' will'],
  [/\b(it|that|there|what|he|she|here|let)[’']s\b/g, '$1 is']
]
// A number comes back as digits or as a word, and a sound of doubt is not a word of the user.
const NOT_COUNTED = /^(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|uh|um|er|hm|hmm|mm)$/
/** This share of a transcript, in the order the voice said it, makes the transcript an echo. */
const ECHO_SHARE = 0.7

function echoWords(text: string): string[] {
  const whole = CONTRACTIONS.reduce((words, [pattern, long]) => words.replace(pattern, long), text.toLowerCase())

  return normalise(whole)
    .split(' ')
    .filter(word => word && !NOT_COUNTED.test(word))
}

/**
 * One spoken word as the listening model can write it: the same, cut short
 * ("check" for "checking", while the word is still in the air), or one letter
 * different.
 */
function sameWord(heard: string, said: string): boolean {
  if (heard === said) {
    return true
  }

  const [short, long] = heard.length <= said.length ? [heard, said] : [said, heard]

  if (short.length < 3) {
    return false
  }

  if (long.startsWith(short)) {
    return true
  }

  if (short.length < 4 || long.length - short.length > 1) {
    return false
  }

  let at = 0

  while (at < short.length && short[at] === long[at]) {
    at++
  }

  return short.slice(at + (short.length === long.length ? 1 : 0)) === long.slice(at + 1)
}

/** How many of the heard words are in this stretch of spoken words, in the same order. */
function inOrder(heard: readonly string[], said: readonly string[]): number {
  let row = new Array<number>(said.length + 1).fill(0)

  for (const word of heard) {
    const next = [0]

    for (let index = 0; index < said.length; index++) {
      next.push(sameWord(word, said[index]) ? row[index] + 1 : Math.max(row[index + 1], next[index]))
    }

    row = next
  }

  return row[said.length]
}

/**
 * What the voice said in the last seconds. The microphone can hear the
 * speaker; a transcript that is only those words is an echo, not the user.
 * The listening model does not write the echo as the voice was given it: a
 * word comes cut short or a little wrong, so the match is loose.
 */
export class EchoMemory {
  // `until`: when the sound of the line ends. A long answer comes as text in two seconds and
  // sounds for a minute, so the time the text came says nothing about when the microphone hears it.
  private spoken: { until: number; words: string[] }[] = []

  remember(line: string, now: number): void {
    const kept = this.recent(now)
    const from = Math.max(now, kept.at(-1)?.until ?? 0)

    this.spoken = [...kept, { until: from + (line.length / SPOKEN_CHARS_PER_SECOND) * 1000, words: echoWords(line) }]
  }

  /** The words of a transcript that the voice did not say: the words that can only be the user, or a noise. */
  unsaid(transcript: string, now: number): string[] {
    const said = this.recent(now).flatMap(entry => entry.words)

    return echoWords(transcript).filter(word => !said.some(spoken => sameWord(word, spoken)))
  }

  /** The speaker is quiet now: all that waited has sounded, or was dropped. */
  quiet(now: number): void {
    this.spoken = this.spoken.map(entry => ({ ...entry, until: Math.min(entry.until, now) }))
  }

  isEcho(transcript: string, now: number): boolean {
    const heard = echoWords(transcript)

    if (!heard.length) {
      return true
    }

    const said = this.recent(now).flatMap(entry => entry.words)

    if (heard.length <= 3) {
      return heard.every(word => said.some(spoken => sameWord(word, spoken)))
    }

    // The same words in the same place: a long transcript of the user has common words of the voice, but not in its order.
    const needed = Math.ceil(heard.length * ECHO_SHARE)
    const stretch = heard.length + 2

    for (let start = 0; start + needed <= said.length; start++) {
      if (inOrder(heard, said.slice(start, start + stretch)) >= needed) {
        return true
      }
    }

    return false
  }

  private recent(now: number) {
    return this.spoken.filter(entry => now - entry.until < ECHO_MEMORY_MS)
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

// One new word over the voice stops it only when it is a word a person says to stop a voice.
// The listening model writes a piece of the echo, or a tap on the phone, as one wrong word
// ("caller", "hi") now and then, alone or among words of the voice.
const BREAK_IN_WORDS = new Set(['stop', 'wait', 'hey', 'hermes', 'no', 'yes', 'yeah', 'okay', 'ok', 'sorry', 'hello', 'pause', 'quiet', 'enough', 'thanks', 'goodbye', 'bye'])

/**
 * Words over the voice that are enough to stop it: two words the voice did
 * not say, or a short call to stop. `unsaid` are the words of the transcript
 * that the voice did not say.
 */
export function breaksThrough(transcript: string, unsaid: readonly string[]): boolean {
  const words = normalise(transcript).split(' ').filter(Boolean)

  return unsaid.length > 1 || (words.length <= 3 && words.some(word => BREAK_IN_WORDS.has(word)))
}

/** What the engine knows of its own voice, for one transcript. */
export interface OwnVoice {
  /** The transcript is only the voice itself. */
  isEcho(transcript: string): boolean
  /** The words of the transcript that the voice did not say. */
  unsaid(transcript: string): string[]
}

/**
 * One `TurnInfo` message of the listening model later. `audible` says the
 * voice plays now or did a moment ago; `isEcho` says a transcript is only the
 * voice itself.
 */
export function advanceTurn(turn: UserTurn, info: TurnInfo, audible: boolean, voice: OwnVoice): TurnStep {
  const transcript = String(info.transcript ?? '').trim()
  let next = turn

  if (info.event === 'StartOfTurn') {
    next = { barged: false, duringPlayback: audible }
  }

  if (info.event === 'StartOfTurn' || info.event === 'Update') {
    const hush = audible && !next.barged && Boolean(transcript) && !voice.isEcho(transcript) && breaksThrough(transcript, voice.unsaid(transcript))

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

  // A turn that began under the voice is judged by its last words, not by whether it stopped the
  // voice: a person who starts to talk as the voice ends says one word under it and the rest in
  // the quiet, and all of it is theirs. While the voice still plays, the words must be enough to
  // stop it. In the quiet, one word the voice did not say is enough.
  const mine = !next.duringPlayback || (!voice.isEcho(transcript) && (!audible || breaksThrough(transcript, voice.unsaid(transcript))))
  const real = Boolean(transcript) && mine

  return { turn: NEW_TURN, hush: false, hearing: false, partial: '', utterance: real ? transcript : null }
}

const STOP_PHRASES = new Set(['stop', 'stop listening', 'goodbye', 'bye', 'end voice chat', 'end the call', 'end call', 'end live voice', 'end live', 'hang up'])

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
  [/^(delegate|subagent)/, 'Handing part of this to an agent.'],
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

// The waits grow: a long job is not silent, and the voice does not talk the whole time.
const STILL_WORKING_WAITS_MS = [5000, 9000, 14_000, 20_000]
const STILL_WORKING_LINES = ['One moment.', 'Still working on it.', 'Still on it. This one takes a little longer.', 'Still working.', 'Still checking.']

/** How long the call may be silent, while the agent works, before the voice says line number `count`. */
export function stillWorkingWait(count: number): number {
  return STILL_WORKING_WAITS_MS[Math.min(count, STILL_WORKING_WAITS_MS.length - 1)]
}

/** Line number `count` of a long silence. The last two take turns after the first three. */
export function stillWorkingLine(count: number): string {
  return count < 3 ? STILL_WORKING_LINES[count] : STILL_WORKING_LINES[3 + ((count - 3) % 2)]
}

/**
 * Text of an answer after the voice was stopped by mistake: what comes after
 * the end of the sentence that was cut, or null while that sentence goes on.
 */
export function afterSentence(text: string): string | null {
  const end = /[.!?…]["')\]]*\s+|\n+/.exec(text)

  return end ? text.slice(end.index + end[0].length) : null
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
