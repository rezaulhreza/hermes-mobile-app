/**
 * Mentions of bots: "@scout" in a message. The phone must say the same thing
 * as the two places that read a mention, so its rules are copies of theirs.
 *
 * In a normal chat the desktop app reads the mention (`resolveRosterMentions`
 * in its `hermes-bots` plugin) and tells the agent in a note which bots the
 * user means. In a group chat the host reads it (`resolve_mentions` in
 * `gateway/hosted_room_discussion.py`): only the bots that are named answer.
 */

import type { Bot, Room } from './bots'
import { readableName } from './capabilities'

/** What a reference brings to the agent: its kind picks the icon. */
export type ReferenceKind = 'file' | 'folder' | 'url' | 'git' | 'plugin'

/**
 * What a mention stands for, in the words a person reads: a bot, all the bots
 * of a group, or a thing the message refers to ("@file:notes.md").
 */
export type MentionTarget =
  | { kind: 'bot'; /** The name of the profile. */ name: string; title: string }
  | { kind: 'everyone'; title: string }
  | { kind: 'reference'; type: ReferenceKind; title: string }

/** A piece of a text: plain words, or a mention that reaches something. */
export interface TextPart {
  text: string
  mention: boolean
  /** What the mention stands for. Absent for plain words. */
  target?: MentionTarget
}

interface Found {
  /** Where the "@" is. */
  start: number
  /** The name after the "@". */
  token: string
}

function partsOf<F extends Found>(text: string, found: readonly F[], targetOf: (found: F) => MentionTarget | null | undefined): TextPart[] {
  const parts: TextPart[] = []
  let last = 0

  for (const one of found) {
    const { start, token } = one
    const target = start >= last ? targetOf(one) : null

    if (!target) {
      continue
    }

    if (start > last) {
      parts.push({ text: text.slice(last, start), mention: false })
    }

    last = start + token.length + 1
    parts.push({ text: text.slice(start, last), mention: true, target })
  }

  if (last < text.length) {
    parts.push({ text: text.slice(last), mention: false })
  }

  return parts
}

/** The word that is still being typed at the end of the draft, when it can be the name of a bot: "@sc". */
export function typedMention(draft: string): string | null {
  return /(?:^|\s)@([A-Za-z0-9._:-]*)$/.exec(draft)?.[1] ?? null
}

// --- a normal chat ----------------------------------------------------------------------------

/** Names that mean something else to the desktop app: no bot takes one of them from its title. */
const RESERVED = ['all', 'everyone', 'user', 'default', 'hermes']

/** What a person can type after "@" for a name with spaces: "CoS Bot" is "cos-bot" and "cosbot". */
export function mentionForms(name: string): string[] {
  const lower = name.trim().toLowerCase()
  const slug = lower.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  const collapsed = lower.replace(/[^a-z0-9_-]+/g, '')

  return [...new Set([slug, collapsed])].filter(form => /^[a-z0-9][a-z0-9_-]*$/.test(form) && !RESERVED.includes(form))
}

/** The name of the profile as a mention. The main profile is "hermes" on every host. */
function botHandle(bot: Bot): string {
  return bot.name.trim().toLowerCase() === 'default' ? 'hermes' : bot.name
}

/** What the suggestion list writes for a bot: the name the user gave it, or the name of its profile. */
export function botTag(bot: Bot): string {
  return mentionForms(bot.title)[0] ?? botHandle(bot)
}

/** Every mention a bot answers to, by its lowercase form. A form that two bots share reaches no bot. */
function botForms(bots: readonly Bot[], active?: string): Map<string, Bot | null> {
  const others = bots.filter(bot => bot.name !== active)
  const byForm = new Map<string, Bot | null>()

  for (const bot of others) {
    for (const form of new Set([botHandle(bot).toLowerCase(), bot.name.toLowerCase(), ...mentionForms(bot.title)])) {
      const taken = byForm.get(form)

      byForm.set(form, taken === undefined || taken === bot ? bot : null)
    }
  }

  // A name the bot had before fills a gap only: the name of today of another bot wins.
  for (const bot of others) {
    for (const form of bot.formerNames.flatMap(mentionForms)) {
      if (!byForm.has(form)) {
        byForm.set(form, bot)
      }
    }
  }

  return byForm
}

/** The words of a message with its code blanked out: a mention inside code is code. */
const proseOf = (text: string) => text.replace(/```[\s\S]*?```|`[^`\n]*`/g, code => ' '.repeat(code.length))

function chatMentions(text: string): Found[] {
  return [...proseOf(text).matchAll(/(^|\s)@([a-z0-9][a-z0-9_-]*)/gi)].map(match => ({ start: match.index + match[1].length, token: match[2] }))
}

const botTarget = (bot: Bot): MentionTarget => ({ kind: 'bot', name: bot.name, title: bot.title })

// --- a reference ------------------------------------------------------------------------------

/** The references Hermes itself reads. Every other "@word:" belongs to a plugin of the host. */
const BUILT_IN = ['file', 'folder', 'git', 'url']

/**
 * A reference as the host reads it (`REFERENCE_PATTERN` and
 * `_PLUGIN_REFERENCE_PATTERN` in `agent/context_references.py`): "@diff",
 * "@staged", or "@kind:value" where the value has no space or is in quotes.
 */
const REFERENCE = /(^|[^\w/])@(?:(diff|staged)\b|([a-zA-Z][a-zA-Z0-9_-]*):((?:`[^`\n]+`|"[^"\n]+"|'[^'\n]+')(?::\d+(?:-\d+)?)?|\S+))/g
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** A value with no quotes ends before the full stop of its sentence, and before a bracket that was opened ahead of it. */
function withoutTail(value: string): string {
  let kept = value.replace(/[,.;!?]+$/, '')

  while (kept && CLOSERS[kept[kept.length - 1]] && kept.split(kept[kept.length - 1]).length > kept.split(CLOSERS[kept[kept.length - 1]]).length) {
    kept = kept.slice(0, -1)
  }

  return kept
}

/** The prefixes that plugins of the host answer to, from the rows the host offers for a lone "@" ("@issue:"). */
export function referencePlugins(rows: readonly { text: string }[]): string[] {
  return [...new Set(rows.flatMap(row => /^@([a-z][a-z0-9_-]*):$/i.exec(row.text)?.[1].toLowerCase() ?? []))].filter(prefix => !BUILT_IN.includes(prefix))
}

/** A reference in the words a person reads: the name of the file, the site, the plugin and what it was asked for. */
function referenceTarget(simple: string | undefined, kind: string, value: string, plugins: readonly string[]): MentionTarget | null {
  if (simple) {
    return { kind: 'reference', type: 'git', title: simple === 'diff' ? 'Changes' : 'Staged changes' }
  }

  const ranged = /^(.+?):(\d+)(?:-(\d+))?$/.exec(value)
  const bare = (ranged?.[1] ?? value).replace(/^([`"'])(.+)\1$/, '$2')

  switch (kind) {
    case 'file':
    case 'folder': {
      const name = bare.replace(/\/+$/, '').split('/').pop() || bare
      const lines = ranged ? (ranged[3] && ranged[3] !== ranged[2] ? `, lines ${ranged[2]} to ${ranged[3]}` : `, line ${ranged[2]}`) : ''

      return { kind: 'reference', type: kind, title: name + (kind === 'file' ? lines : '') }
    }

    case 'url':
      return { kind: 'reference', type: 'url', title: /^(?:[a-z]+:\/\/)?(?:www\.)?([^/?#]+)/i.exec(bare)?.[1] ?? bare }

    case 'git':
      return { kind: 'reference', type: 'git', title: /^\d+$/.test(bare) && bare !== '1' ? `Last ${bare} commits` : 'Last commit' }

    default:
      return plugins.includes(kind.toLowerCase()) ? { kind: 'reference', type: 'plugin', title: `${readableName(kind)}: ${bare}` } : null
  }
}

function references(text: string, plugins: readonly string[]): (Found & { target?: MentionTarget })[] {
  return [...proseOf(text).matchAll(REFERENCE)].flatMap(match => {
    const value = match[4] === undefined || /^[`"']/.test(match[4]) ? match[4] : withoutTail(match[4])
    const target = value === '' ? null : referenceTarget(match[2], match[3] ?? '', value ?? '', plugins)

    return target ? [{ start: match.index + match[1].length, token: match[2] ?? `${match[3]}:${value}`, target }] : []
  })
}

/** The bots a message names, in the order it names them. `active` is the bot of the chat: it does not name itself. */
export function mentionedBots(text: string, bots: readonly Bot[], active?: string): Bot[] {
  const byForm = botForms(bots, active)
  const named = new Set<Bot>()

  for (const { token } of chatMentions(text)) {
    const bot = byForm.get(token.toLowerCase())

    if (bot) {
      named.add(bot)
    }
  }

  return [...named]
}

/**
 * A message of a normal chat in its parts: the words, the bots it names, and
 * the things it refers to. `plugins` are the prefixes the plugins of the host
 * answer to; without it only the references of Hermes itself count. Null: no
 * reference counts, as in the answer of a bot, which the host does not read
 * for them. A reference wins over a bot of the same name ("@file:a" is a file).
 */
export function chatMentionParts(text: string, bots: readonly Bot[], active?: string, plugins: readonly string[] | null = []): TextPart[] {
  const byForm = botForms(bots, active)
  const referred = plugins ? references(text, plugins) : []
  const taken = new Set(referred.map(found => found.start))
  const found: (Found & { target?: MentionTarget })[] = [...referred, ...chatMentions(text).filter(({ start }) => !taken.has(start))].sort((a, b) => a.start - b.start)

  return partsOf(text, found, one => {
    const bot = byForm.get(one.token.toLowerCase())

    return one.target ?? (bot ? botTarget(bot) : null)
  })
}

const NOTE_START = '[@mentions resolved from the Bot Mode roster'
const NOTE = /\n*\[@mentions resolved from the Bot Mode roster[^\]]*\]/g

/**
 * What the agent reads under a message that names bots: who each mention is.
 * The words are the words of the desktop app, so the agent reads one form
 * from both, and `withoutMentionNote` takes both out of a stored message.
 * Empty when the message names no bot.
 */
export function mentionNote(text: string, bots: readonly Bot[], active?: string): string {
  const lines = mentionedBots(text, bots, active).map(bot => `@${botHandle(bot)} = agent profile "${bot.name}" ("${bot.title}")`)

  return lines.length
    ? `\n\n${NOTE_START} — the user is referring to: ${lines.join('; ')}. If they want one of these agents contacted, compose your own message and send it with your message_agent tool (agents on other connected machines are reachable too — the Desktop relays it); never forward the user’s text verbatim. If this session has no message_agent tool, agent messaging is unavailable here — say so.]`
    : ''
}

/** A stored message without the note for the agent: the words of the user. */
export function withoutMentionNote(stored: string): string {
  return stored.replace(NOTE, '')
}

/** A row of a suggestion list, in the form the host gives its own rows. */
export interface MentionChoice {
  text: string
  display: string
  meta: string
  /** The name of the profile, when the row is a bot: the row shows its picture. */
  bot?: string
}

/** The bots to offer for the word that is being typed ("@sc"). Nothing for a word that is a file reference. */
export function botChoices(bots: readonly Bot[], word: string, active?: string): MentionChoice[] {
  if (!/^@[a-z0-9_-]*$/i.test(word)) {
    return []
  }

  const typed = word.slice(1).toLowerCase()
  const byForm = botForms(bots, active)

  return bots
    .filter(bot => bot.name !== active)
    .flatMap(bot => {
      // A name that two bots share reaches neither: offer the name of the profile then.
      const tag = byForm.get(botTag(bot).toLowerCase()) === bot ? botTag(bot) : botHandle(bot)
      const matches = [tag, botHandle(bot), bot.name, bot.title].some(form => form.toLowerCase().startsWith(typed))

      return matches && byForm.get(tag.toLowerCase()) === bot ? [{ text: `@${tag}`, display: bot.title, meta: `@${tag}`, bot: bot.name }] : []
    })
}

/** The bots first, then the rows of the host. The host lists each bot too, by the name of its profile: that copy goes. */
export function withBotChoices<Row extends { text: string }>(choices: readonly MentionChoice[], rows: readonly Row[], bots: readonly Bot[]): (MentionChoice | Row)[] {
  const taken = new Set([...choices.map(choice => choice.text), ...bots.flatMap(bot => [`@${bot.name}`, `@${botHandle(bot)}`])].map(text => text.toLowerCase()))

  return [...choices, ...rows.filter(row => !taken.has(row.text.toLowerCase()))]
}

// --- a group chat -----------------------------------------------------------------------------

/** The handle the host gives a member of a room for its round. Keep it the same as `_engine_members` of the plugin. */
export function roomHandle(name: string, stored?: string): string {
  return (stored || name).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || name
}

/** Somebody a message to a room can name. */
export interface RoomTarget {
  /** What to type after the "@". */
  handle: string
  /** The name of the profile. Empty for all of the bots. */
  name: string
  /** The name a person reads. */
  title: string
}

const EVERYONE: RoomTarget = { handle: 'everyone', name: '', title: 'All bots' }

/** The bots of a room, with the handle the host knows each by. */
export function roomTargets(room: Room, titles: ReadonlyMap<string, Bot>): RoomTarget[] {
  return room.members.map(name => ({ handle: roomHandle(name, room.handles[name]), name, title: titles.get(name)?.title ?? name }))
}

/** The members to offer for the word that is being typed, then all of them. */
export function roomChoices(targets: readonly RoomTarget[], typed: string): RoomTarget[] {
  const wanted = typed.toLowerCase()

  return [...targets, EVERYONE].filter(target => [target.handle, target.name, target.title].some(form => form.toLowerCase().startsWith(wanted)))
}

const EVERYONE_NAMES = ['all', 'everyone']
const isEveryone = (token: string) => EVERYONE_NAMES.includes(token.toLowerCase())

/**
 * The mentions in a message to a room, as the host reads them. A handle can
 * hold "." and ":", so the host takes them as a part of the name. The word as
 * it is written is tried first; only when it names nobody is one "." or ":"
 * taken off its end and the rest tried again. So "@qa." at the end of a
 * sentence reaches "qa", and a bot that is called "qa." keeps its name.
 * Keep it the same as `resolve_mentions` of the host (host/patches).
 */
function roomMentions(text: string, handles: ReadonlySet<string>): Found[] {
  return [...text.matchAll(/@([A-Za-z0-9][A-Za-z0-9._:-]*)/g)].map(match => {
    let token = match[1]

    while (!isEveryone(token) && !handles.has(token.toLowerCase()) && /[.:]$/.test(token)) {
      token = token.slice(0, -1)
    }

    return { start: match.index, token }
  })
}

/** A message of a room in its parts: the words, and the bots the host gives the message to. */
export function roomMentionParts(text: string, targets: readonly RoomTarget[]): TextPart[] {
  const byHandle = new Map(targets.map(target => [target.handle.toLowerCase(), target]))

  return partsOf(text, roomMentions(text, new Set(byHandle.keys())), ({ token }) => {
    const target = byHandle.get(token.toLowerCase())

    return isEveryone(token) ? { kind: 'everyone', title: EVERYONE.title } : target && { kind: 'bot', name: target.name, title: target.title }
  })
}

/**
 * Who answers a message to a room, in words. The host gives the message to
 * the bots it names, and to all of them when it names none. It does not say
 * that a name is wrong: this line does. Null for a message with no mention.
 */
export function roomAnswerLine(text: string, targets: readonly RoomTarget[]): string | null {
  const byHandle = new Map(targets.map(target => [target.handle.toLowerCase(), target]))
  const found = roomMentions(text, new Set(byHandle.keys()))
  const named = [...new Set(found.flatMap(({ token }) => byHandle.get(token.toLowerCase()) ?? []))]
  const everyone = found.some(({ token }) => isEveryone(token))
  // A word with "@" inside is an address, not a wrong name.
  const unknown = [...new Set(found.filter(({ start, token }) => !isEveryone(token) && !byHandle.has(token.toLowerCase()) && !/\S/.test(text[start - 1] ?? ' ')).map(({ token }) => `@${token}`))]

  if (!found.length || (!named.length && !everyone && !unknown.length)) {
    return null
  }

  const wrong = unknown.length ? `${words(unknown)} ${unknown.length > 1 ? 'are not bots' : 'is not a bot'} in this group.` : ''
  const who = everyone || !named.length ? 'All bots answer.' : `Only ${words(named.map(target => target.title))} ${named.length > 1 ? 'answer' : 'answers'}.`

  return named.length && !everyone ? [who, wrong].filter(Boolean).join(' ') : [wrong, who].filter(Boolean).join(' ')
}

function words(list: readonly string[]): string {
  return list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : (list[0] ?? '')
}
