/**
 * Bots: the profiles of a Hermes host. Each profile is an agent of its own,
 * with its own role, skills, model and memory, and one long conversation
 * with the owner (its "Bot Chat"). On the phone a bot is a person in a list:
 * who it is, what it does now, and a tap to talk.
 */

import type { ProfileRow } from './gateway/gateway-contract.generated'

/** The title the host gives the one long conversation of a bot. It is plumbing: a person sees the bot's name. */
export const BOT_CHAT_TITLE = 'Bot Chat'

export interface Bot {
  /** The name of the profile on the host: the id in every call. */
  name: string
  /** The name a person reads. */
  title: string
  description: string
  model: string
  /** The profile the host itself runs as. It cannot be deleted. */
  isDefault: boolean
  /** The stored id of its Bot Chat. Null for a bot nobody has talked to. */
  chatId: string | null
  /** The last words of its chat, for the row. */
  preview: string
  /** Unix seconds of its last activity, in a chat or as a worker. */
  lastActive: number
  /** It works on a task now (a kanban or tool worker was active a moment ago). */
  working: boolean
  skillCount: number
  hasAvatar: boolean
  /** The section the user filed this bot under on the Bots list. Null: not filed. */
  section: BotSection | null
  /** The user keeps this bot at the top. */
  pinned: boolean
  /** The user put this bot away. It shows in its own group at the end. */
  hidden: boolean
  /** The group chats this bot is a member of, by name. */
  groups: string[]
  /** Names the profile had before a rename. A group chat can still name a member by one of them. */
  formerNames: string[]
}

export interface BotSection {
  id: string
  name: string
}

/** Where the desktop app keeps what the user set for a bot on the Bots list: one record in the profile's `ui_meta`. */
export const BOT_META_KEY = 'hermes-bots'
/** Where the desktop app keeps a copy of the group chats: on the main profile. */
export const GROUP_META_KEY = 'hermes-bots-groups'

function metaOf(row: ProfileRow): Record<string, unknown> {
  const meta = (row.ui_meta as Record<string, unknown> | null | undefined)?.[BOT_META_KEY]

  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}
}

/** A worker row this fresh means the bot is at work. */
const WORKING_WINDOW_S = 120

function titleOf(row: ProfileRow): string {
  // The name the user gave the bot on the Bots list wins: it is written as they want it ("QA", not "Qa").
  const given = metaOf(row).title

  if (typeof given === 'string' && given.trim()) {
    return given.trim()
  }

  const shown = (row.display_name || row.name).trim()

  return shown.charAt(0).toUpperCase() + shown.slice(1)
}

export function botRows(profiles: readonly ProfileRow[], nowS: number): Bot[] {
  return profiles
    // A profile that exists only to finish a setup is not a bot yet.
    .filter(row => row.role !== 'setup')
    .map(row => {
      const chat = row.canonical_session
      const workerAt = row.worker_session?.last_active ?? 0

      return {
        name: row.name,
        title: titleOf(row),
        description: (row.description ?? '').trim(),
        model: row.model ?? '',
        isDefault: Boolean(row.is_default),
        chatId: chat?.resolved_id || chat?.id || null,
        preview: (chat?.preview ?? row.last_session?.preview ?? '').replace(/\s+/g, ' ').trim(),
        lastActive: Math.max(chat?.last_active ?? 0, row.last_session?.last_active ?? 0, workerAt),
        working: workerAt > 0 && nowS - workerAt < WORKING_WINDOW_S,
        skillCount: row.skill_count ?? 0,
        hasAvatar: Boolean(row.has_avatar),
        ...filing(metaOf(row)),
        formerNames: Array.isArray(row.previous_names) ? row.previous_names.filter((name): name is string => typeof name === 'string') : []
      }
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.working) - Number(a.working) || b.lastActive - a.lastActive || a.title.localeCompare(b.title))
}

function filing(meta: Record<string, unknown>): Pick<Bot, 'section' | 'pinned' | 'hidden' | 'groups'> {
  const id = typeof meta.sectionId === 'string' ? meta.sectionId : ''
  const name = typeof meta.sectionName === 'string' ? meta.sectionName.trim() : ''

  return {
    section: id && name ? { id, name } : null,
    pinned: meta.pinned === true,
    hidden: meta.hidden === true,
    groups: Array.isArray(meta.groups) ? meta.groups.filter((group): group is string => typeof group === 'string') : []
  }
}

/** A row of the Bots list: a bot, or a group chat of bots. */
export type ListRow = { kind: 'bot'; bot: Bot } | { kind: 'room'; room: Room }

export interface BotGroup {
  key: string
  /** Empty for the bots when the list has no other heading. */
  title: string
  rows: ListRow[]
  /** The section of the user that this group is. Absent for the headings the list makes itself. */
  section?: BotSection
}

/**
 * What the desktop app keeps on its own machine only, so the phone keeps its
 * own copy on the main profile: the sections that hold no bot, and the section
 * of each group chat (by the id of the room).
 */
export interface Filing {
  sections: BotSection[]
  rooms: Record<string, string>
}

export const NO_FILING: Filing = { sections: [], rooms: {} }
/** Where the phone keeps its `Filing`: a record of its own in the `ui_meta` of the main profile. */
export const FILING_META_KEY = 'hermes-native-filing'

export function filingOf(profiles: readonly ProfileRow[]): Filing {
  const stored = (profiles.find(row => row.is_default)?.ui_meta as Record<string, unknown> | null | undefined)?.[FILING_META_KEY] as { sections?: unknown; rooms?: unknown } | undefined
  const seen = new Set<string>()

  return {
    sections: (Array.isArray(stored?.sections) ? stored.sections : []).flatMap((entry): BotSection[] => {
      const { id, name } = (entry ?? {}) as { id?: unknown; name?: unknown }

      if (typeof id !== 'string' || !id || typeof name !== 'string' || !name.trim() || seen.has(id)) {
        return []
      }

      seen.add(id)

      return [{ id, name: name.trim() }]
    }),
    rooms: Object.fromEntries(Object.entries(stored?.rooms && typeof stored.rooms === 'object' ? stored.rooms : {}).filter((pair): pair is [string, string] => typeof pair[1] === 'string' && Boolean(pair[1])))
  }
}

/**
 * The Bots list under its headings, as the desktop app files it: pinned bots
 * first, then each section of the user with its group chats and its bots, then
 * "Unassigned" for what is in no section, then the bots the user put away.
 * With no section at all, the group chats and the bots each have their own
 * heading. The order inside a group is the order of `rooms`, then of `bots`.
 */
export function botGroups(bots: readonly Bot[], rooms: readonly Room[] = [], filing: Filing = NO_FILING): BotGroup[] {
  const shown = bots.filter(bot => !bot.hidden)
  const pinned = shown.filter(bot => bot.pinned)
  const rest = shown.filter(bot => !bot.pinned)
  const hidden = bots.filter(bot => bot.hidden)
  const sections = knownSections(bots, filing.sections)
  const known = new Set(sections.map(section => section.id))
  // A room filed under a section that is gone is in no section: it must not vanish.
  const sectionOf = (room: Room) => (known.has(filing.rooms[room.id]) ? filing.rooms[room.id] : null)
  const botRow = (bot: Bot): ListRow => ({ kind: 'bot', bot })
  const roomRow = (room: Room): ListRow => ({ kind: 'room', room })
  const looseRooms = rooms.filter(room => !sectionOf(room)).map(roomRow)
  const looseBots = rest.filter(bot => !bot.section).map(botRow)

  const loose: BotGroup[] = sections.length
    ? [{ key: 'loose', title: 'Unassigned', rows: [...looseRooms, ...looseBots] }]
    : [
        { key: 'rooms', title: 'Group chats', rows: looseRooms },
        { key: 'loose', title: pinned.length || looseRooms.length ? 'Bots' : '', rows: looseBots }
      ]

  return [
    ...(pinned.length ? [{ key: 'pinned', title: 'Pinned', rows: pinned.map(botRow) }] : []),
    // A section with nothing in it shows too: the user made it to file something there.
    ...sections.map(section => ({
      key: `section:${section.id}`,
      title: section.name,
      section,
      rows: [...rooms.filter(room => sectionOf(room) === section.id).map(roomRow), ...rest.filter(bot => bot.section?.id === section.id).map(botRow)]
    })),
    ...loose.filter(group => group.rows.length),
    ...(hidden.length ? [{ key: 'hidden', title: 'Put away', rows: hidden.map(botRow) }] : [])
  ]
}

/** The bots by every name a group chat can use for them: the name of the profile now, and its names before. */
export function botsByAnyName(bots: readonly Bot[]): Map<string, Bot> {
  const found = new Map<string, Bot>()

  for (const bot of bots) {
    for (const name of bot.formerNames) {
      found.set(name, bot)
    }
  }

  // The name of today wins over an old name of another bot.
  for (const bot of bots) {
    found.set(bot.name, bot)
  }

  return found
}

/**
 * Every section the user made, by name: the sections the bots name, and the
 * sections in `made` that no bot names. The name on the bots wins: a rename
 * on the desktop app reaches the phone on them.
 */
export function knownSections(bots: readonly Bot[], made: readonly BotSection[] = []): BotSection[] {
  const seen = new Map<string, BotSection>()

  for (const bot of bots) {
    if (bot.section && !seen.has(bot.section.id)) {
      seen.set(bot.section.id, bot.section)
    }
  }

  for (const section of made) {
    if (!seen.has(section.id)) {
      seen.set(section.id, section)
    }
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** An id for a new section, in the form the desktop app gives its own. */
export function newSectionId(): string {
  return `sec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export interface RoomMessage {
  id: string
  /** The name of the profile that wrote it. Empty for the user. */
  from: string
  mine: boolean
  text: string
  /** Unix milliseconds. */
  at: number
  /** The host keeps only the start of this message in the record. The rest can be read from the host. */
  cut?: boolean
  /** The thread the message belongs to. Absent for a message from before threads. */
  thread?: string
}

/** What the host and the desktop app put at the end of a message they cut. */
const CUT_MARK = '… [truncated]'

export interface Room {
  id: string
  name: string
  /** Profile names. */
  members: string[]
  /** What the host calls a member in a mention ("@cos-bot"), by the name of its profile. Absent: the name itself. */
  handles: Record<string, string>
  /** The newest messages that the host has a copy of. */
  messages: RoomMessage[]
  /** Earlier messages that only the desktop app has. */
  omitted: number
  /**
   * The desktop app knows this group (its bots name it) and the host has no
   * record of it yet: nothing was said in it, or the desktop did not publish it.
   */
  unmade?: boolean
}

/** The id of a group that has no record on the host yet: its name is all there is. */
export const UNMADE_ROOM = 'name:'

interface StoredRoom {
  name?: unknown
  roomId?: unknown
  room_id?: unknown
  members?: unknown
  log?: unknown
  omitted?: unknown
}

/** One room of the record the host keeps. Null for a record with no name. */
export function roomRow(key: string, value: unknown): Room | null {
  const room = (value ?? {}) as StoredRoom

  if (typeof room.name !== 'string' || !room.name.trim()) {
    return null
  }

  const messages = (Array.isArray(room.log) ? room.log : []).flatMap((entry, index): RoomMessage[] => {
    const { id, from, text, at, thread } = (entry ?? {}) as { id?: unknown; from?: { kind?: unknown; name?: unknown }; text?: unknown; at?: unknown; thread?: unknown }

    if (typeof text !== 'string' || !text.trim()) {
      return []
    }

    // The mark is not a part of the message: the screen says in its own words that there is more.
    const cut = text.endsWith(CUT_MARK)

    return [
      {
        id: typeof id === 'string' ? id : `m${index}`,
        from: typeof from?.name === 'string' ? from.name : '',
        mine: from?.kind === 'user',
        text: cut ? `${text.slice(0, -CUT_MARK.length).trimEnd()}…` : text,
        at: typeof at === 'number' ? at : 0,
        ...(cut ? { cut: true } : {}),
        ...(typeof thread === 'string' && thread ? { thread } : {})
      }
    ]
  })

  const members = (Array.isArray(room.members) ? room.members : []).filter((member): member is { name: string; handle?: unknown } => typeof (member as { name?: unknown })?.name === 'string')

  // A record from an older plugin of the host can be out of order. With a time on every message, the time decides.
  if (messages.every(message => message.at > 0)) {
    messages.sort((a, b) => a.at - b.at)
  }

  return {
    id: typeof room.roomId === 'string' ? room.roomId : typeof room.room_id === 'string' ? room.room_id : key,
    name: room.name.trim(),
    members: members.map(member => member.name),
    handles: Object.fromEntries(members.flatMap(member => (typeof member.handle === 'string' && member.handle ? [[member.name, member.handle]] : []))),
    messages,
    omitted: typeof room.omitted === 'number' ? room.omitted : 0
  }
}

const newestAt = (room: Room) => room.messages[room.messages.length - 1]?.at ?? 0

/**
 * The group chats of the host. A group is in two places: the record on the
 * main profile (rooms with their newest messages) and the list of groups each
 * bot names in its own record. A group that only the bots name has no
 * messages on the host yet; it shows too, with the bots that name it, or the
 * phone would hide a group the desktop app shows. The newest room first, a
 * group with nothing said last.
 */
export function groupRooms(profiles: readonly ProfileRow[]): Room[] {
  const main = profiles.find(row => row.is_default)
  const stored = (main?.ui_meta as Record<string, unknown> | null | undefined)?.[GROUP_META_KEY] as { rooms?: Record<string, unknown>; deleted?: Record<string, unknown> } | undefined
  const made = Object.entries(stored?.rooms ?? {}).flatMap(([key, value]) => roomRow(key, value) ?? [])
  const known = new Set(made.map(room => room.name.toLowerCase()))
  const closed = new Set(Object.keys(stored?.deleted ?? {}).map(key => key.toLowerCase()))
  const named = new Map<string, string[]>()

  for (const row of profiles) {
    const groups = ((row.ui_meta as Record<string, unknown> | null | undefined)?.[BOT_META_KEY] as { groups?: unknown } | undefined)?.groups

    for (const group of Array.isArray(groups) ? groups : []) {
      const name = typeof group === 'string' ? group.trim() : ''

      if (name && !known.has(name.toLowerCase()) && !closed.has(`${UNMADE_ROOM}${name}`.toLowerCase())) {
        named.set(name, [...(named.get(name) ?? []), row.name])
      }
    }
  }

  return [
    ...made.sort((a, b) => newestAt(b) - newestAt(a)),
    ...[...named].sort(([a], [b]) => a.localeCompare(b)).map(([name, members]): Room => ({ id: `${UNMADE_ROOM}${name}`, name, members, handles: {}, messages: [], omitted: 0, unmade: true }))
  ]
}

/** The rooms with one of them read again: it takes the place of its older copy, or goes first. */
export function withRoom(rooms: readonly Room[], room: Room): Room[] {
  return rooms.some(known => known.id === room.id) ? rooms.map(known => (known.id === room.id ? room : known)) : [room, ...rooms]
}

/** The host runs a round for two to six bots. */
export const ROOM_MEMBERS = { min: 2, max: 6 } as const

/** Why these members cannot be a room, in words. Null: they can. */
export function roomMembersProblem(count: number): string | null {
  return count < ROOM_MEMBERS.min ? `Choose at least ${ROOM_MEMBERS.min} bots.` : count > ROOM_MEMBERS.max ? `A group chat has at most ${ROOM_MEMBERS.max} bots.` : null
}

export function filterBots(bots: readonly Bot[], query: string): Bot[] {
  const needle = query.trim().toLowerCase()

  return needle ? bots.filter(bot => `${bot.title} ${bot.name} ${bot.description}`.toLowerCase().includes(needle)) : [...bots]
}

/** What a person types as a name, as the host stores it: lowercase, with hyphens for spaces. */
export function botSlug(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Why a new bot cannot have this name, or null. */
export function botNameProblem(typed: string, taken: readonly string[]): string | null {
  const slug = botSlug(typed)

  if (!slug) {
    return 'Give the bot a name with letters or digits.'
  }

  if (slug.length > 48) {
    return 'The name is too long. Use 48 characters or less.'
  }

  if (slug === 'default') {
    return '“default” is the name of the main profile.'
  }

  return taken.includes(slug) ? `A bot named “${slug}” exists already.` : null
}

/** One or two letters for a bot with no picture. */
export function botInitials(title: string): string {
  const words = title.split(/[\s-]+/).filter(Boolean)

  return (words.length > 1 ? words[0][0] + words[1][0] : title.slice(0, 2)).toUpperCase()
}
