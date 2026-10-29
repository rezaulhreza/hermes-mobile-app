/**
 * The list of conversations: what a row shows, how the list is filtered and
 * grouped, and which actions a conversation has.
 *
 * The rows come from REST (`GET /api/sessions`), not from the `session.list`
 * RPC: only the REST row says if a conversation is pinned, archived or unread.
 */

import { previewLine, readableDates } from './format'
import type { SessionActiveItem } from './gateway/gateway-contract.generated'

/**
 * The source the app gives a session it opens. The backend adds the tools
 * that need a screen (the browser preview: `open_preview`, `read_preview`,
 * `drive_preview`) only to a session whose source is `desktop`
 * (`tui_gateway/server.py::_gui_surface_toolsets`). With `mobile` the agent
 * has no preview on the phone. The old mobile shell was the desktop renderer
 * and sent `desktop` too.
 */
export const SESSION_SOURCE = 'desktop'

export interface SessionRow {
  id: string
  title?: string | null
  /** The head of the FIRST user message (stock Hermes). The title of a chat with no title. */
  preview?: string | null
  /** The last message of the user or the assistant, from the `phone-chat-list` plugin. Absent on a host without it. */
  last?: LastMessage | null
  /** Where the conversation started: desktop, mobile, telegram, cli, cron, ... */
  source?: string | null
  started_at?: number | null
  /** Unix seconds of the last message. The list is in this order. */
  last_active?: number | null
  pinned?: boolean | null
  archived?: boolean | null
  unread?: boolean | null
  /** The profile (the bot) that owns the conversation. The list of all profiles sets it. */
  profile?: string | null
  is_default_profile?: boolean | null
}

/**
 * The profile to name in a call for this conversation. A conversation of the
 * host's own profile needs none; one of a bot is in that bot's store, and a
 * call with no profile does not find it.
 */
export function rowProfile(row: Pick<SessionRow, 'profile' | 'is_default_profile'>): string | undefined {
  return row.profile && !row.is_default_profile ? row.profile : undefined
}

/** `current`: the normal list. `archived`: only what the user put away. */
export type SessionView = 'current' | 'archived'

/** The backend gives at most this many rows a request. The list asks for the next page at its end. */
export const SESSION_PAGE = 100

export interface SessionPage {
  /** Only the conversations from this source. The backend filters: a rare source is not in the newest rows. */
  source?: string | null
  offset?: number
  /** Only the conversations of this profile (a bot). Null lists every profile. */
  profile?: string | null
}

export function sessionListPath(view: SessionView, { source, offset = 0, profile }: SessionPage = {}): string {
  // The list across profiles: each bot is a profile with its own store of conversations.
  const base = `/api/profiles/sessions?limit=${SESSION_PAGE}&order=recent&archived=${view === 'archived' ? 'only' : 'exclude'}`

  return [
    base,
    `&profile=${profile ? encodeURIComponent(profile) : 'all'}`,
    offset ? `&offset=${offset}` : '',
    source ? `&source=${encodeURIComponent(source)}` : ''
  ].join('')
}

/** One more page under the rows on screen. A row that moved between two requests shows once. */
export function withSessionPage(rows: readonly SessionRow[], page: readonly SessionRow[]): SessionRow[] {
  const seen = new Set(rows.map(row => row.id))

  return [...rows, ...page.filter(row => !seen.has(row.id))]
}

/**
 * Sources that the newest rows may not show: a host with many desktop chats
 * has its Telegram and API chats far down the list. The app asks the backend
 * once for the count of each, so the filter offers every source that has a
 * conversation.
 */
export const SOURCES_TO_PROBE = ['telegram', 'api_server', 'discord', 'slack', 'whatsapp', 'signal', 'matrix', 'email', 'cron', 'kanban'] as const

/** The filter choices: the sources already known, then the new ones, in the order they were found. */
export function withSources(known: readonly string[], found: readonly (string | null | undefined)[]): string[] {
  const next = [...known]

  for (const source of found) {
    if (source && !next.includes(source)) {
      next.push(source)
    }
  }

  return next.length === known.length ? (known as string[]) : next
}

/**
 * The rows that belong in a view. The backend's `archived=only` list also
 * returns a pinned conversation that is not archived (seen 2026-10-09), so the
 * flag on the row decides.
 */
export function rowsInView(rows: readonly SessionRow[], view: SessionView): SessionRow[] {
  return rows.filter(row => Boolean(row.archived) === (view === 'archived'))
}

// The app sends an attachment as a reference line under the words. In a one-line preview it is noise.
const TRAILING_REFERENCES = /(\s+@file:\S*)+$/

export function sessionPreview(row: SessionRow): string {
  return previewLine(row.preview ?? '').replace(TRAILING_REFERENCES, '')
}

export function sessionTitle(row: SessionRow): string {
  // A title is a label: a date in it reads as a date, not as the host wrote it.
  return readableDates(row.title?.trim() || sessionPreview(row)) || 'Untitled conversation'
}

export interface LastMessage {
  role: 'user' | 'assistant'
  text: string
}

/** The plugin route that gives the last message of a page of chats in one request. */
export const LAST_MESSAGES_PATH = '/api/plugins/phone-chat-list/last'

/**
 * The second line of a row, as in a messaging app: the last message, with "You: " for the
 * user's own. Before the host answers, and on a host without the plugin, the first message,
 * but only under a title of its own: an untitled row shows that message as its title already.
 */
export function sessionLine(row: SessionRow): string {
  if (!row.last) {
    return row.title?.trim() ? sessionPreview(row) : ''
  }

  const line = previewLine(row.last.text).replace(TRAILING_REFERENCES, '')

  if (!line || line === sessionTitle(row)) {
    return ''
  }

  return row.last.role === 'user' ? `You: ${line}` : line
}

/** The rows with the last messages the host gave. A row the answer does not name keeps what it had. */
export function withLastMessages(rows: readonly SessionRow[], last: Readonly<Record<string, LastMessage>>): SessionRow[] {
  return rows.map(row => (last[row.id] ? { ...row, last: last[row.id] } : row))
}

/**
 * A new page of rows with the last message each row had on screen. The list then does not
 * show the first message for a moment, until the host answers with the new last messages.
 */
export function keepLastMessages(page: readonly SessionRow[], shown: readonly SessionRow[]): SessionRow[] {
  const known = new Map(shown.filter(row => row.last).map(row => [row.id, row.last]))

  return page.map(row => (row.last || !known.has(row.id) ? row : { ...row, last: known.get(row.id) }))
}

/** What a conversation does now: Hermes works in it, or it waits for an answer of the user. */
export type LiveState = 'working' | 'waiting'

/**
 * The state of each conversation that is live on the host, by its stored id.
 * A conversation that is idle has no entry. `session.active_list` knows only
 * the conversations of the process the app talks to: a turn that a Telegram
 * message or a schedule started runs in another process and has no state here.
 */
export function liveStates(items: readonly Pick<SessionActiveItem, 'session_key' | 'status'>[]): Record<string, LiveState> {
  const states: Record<string, LiveState> = {}

  for (const item of items) {
    if (item.session_key && item.status !== 'idle') {
      states[item.session_key] = item.status === 'waiting' ? 'waiting' : 'working'
    }
  }

  return states
}

export function sameLiveStates(a: Record<string, LiveState>, b: Record<string, LiveState>): boolean {
  const keys = Object.keys(a)

  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key])
}

/** The icon of a channel, as a Feather icon name. */
export type ChannelIcon = 'monitor' | 'smartphone' | 'terminal' | 'send' | 'code' | 'clock' | 'columns' | 'zap' | 'slack' | 'mail' | 'message-circle'

const CHANNELS: Record<string, { label: string; icon: ChannelIcon }> = {
  desktop: { label: 'Desktop app', icon: 'monitor' },
  mobile: { label: 'Phone', icon: 'smartphone' },
  cli: { label: 'Terminal', icon: 'terminal' },
  tui: { label: 'Terminal app', icon: 'terminal' },
  telegram: { label: 'Telegram', icon: 'send' },
  api_server: { label: 'API', icon: 'code' },
  cron: { label: 'Schedules', icon: 'clock' },
  kanban: { label: 'Kanban', icon: 'columns' },
  oneshot: { label: 'One-shot runs', icon: 'zap' },
  slack: { label: 'Slack', icon: 'slack' },
  discord: { label: 'Discord', icon: 'message-circle' },
  whatsapp: { label: 'WhatsApp', icon: 'message-circle' },
  signal: { label: 'Signal', icon: 'message-circle' },
  matrix: { label: 'Matrix', icon: 'message-circle' },
  email: { label: 'Email', icon: 'mail' }
}

/**
 * How a source reads to a person: "API", not "api_server". A source the app
 * does not know keeps its own name, with spaces and a capital.
 */
export function channel(source: string): { label: string; icon: ChannelIcon } {
  const words = source.replace(/[_-]+/g, ' ').trim()

  return CHANNELS[source] ?? { label: words ? `${words[0]!.toUpperCase()}${words.slice(1)}` : source, icon: 'message-circle' }
}

export function filterSessions(rows: readonly SessionRow[], query: string, source: string | null): SessionRow[] {
  const needle = query.trim().toLowerCase()

  return rows.filter(
    row => (!source || row.source === source) && (!needle || `${row.title ?? ''} ${row.preview ?? ''}`.toLowerCase().includes(needle))
  )
}

export interface SessionSection {
  /** Null for a list with one group only: one group needs no heading. */
  title: string | null
  data: SessionRow[]
}

/**
 * The conversations Hermes works in now (or that wait for the user) first,
 * then the pinned ones, each under a heading. The order inside a group is the
 * order given.
 */
export function sessionSections(rows: readonly SessionRow[], live: Readonly<Record<string, LiveState>> = {}): SessionSection[] {
  const working = rows.filter(row => live[row.id])
  const pinned = rows.filter(row => !live[row.id] && row.pinned)
  const rest = rows.filter(row => !live[row.id] && !row.pinned)

  if (!working.length && !pinned.length) {
    return rest.length ? [{ title: null, data: rest }] : []
  }

  return [
    ...(working.length ? [{ title: 'Working now', data: working }] : []),
    ...(pinned.length ? [{ title: 'Pinned', data: pinned }] : []),
    ...(rest.length ? [{ title: 'Recent', data: rest }] : [])
  ]
}

/** A conversation that has the searched words in a message. `snippet` marks each match as `>>>words<<<`. */
export interface SearchHit extends SessionRow {
  snippet?: string | null
}

/** The list's own filter reads titles. Shorter words than this are not sent to the search of the host. */
export const SEARCH_MIN_CHARS = 3

/** The search of the host reads the messages of one profile. With no profile it reads the host's own. */
export function sessionSearchPath(query: string, { profile, source }: Pick<SessionPage, 'profile' | 'source'> = {}): string {
  return [
    `/api/sessions/search?limit=30&q=${encodeURIComponent(query.trim())}`,
    profile ? `&profile=${encodeURIComponent(profile)}` : '',
    source ? `&source=${encodeURIComponent(source)}` : ''
  ].join('')
}

/** A snippet in parts, for a line that shows the match in bold. Line ends and Markdown marks are noise in one line. */
export function snippetParts(snippet: string): { text: string; hit: boolean }[] {
  return snippet
    .replace(/\s+/g, ' ')
    .replace(/[*_`#]+/g, '')
    // A match in a tool result is JSON text: its escaped quotes read as noise.
    .replace(/\\+"/g, '"')
    .split(/>>>|<<</)
    .map((text, index) => ({ text, hit: index % 2 === 1 }))
    .filter(part => part.text)
}

/** The list with the message matches under the title matches. A conversation shows once. */
export function withMessageHits(sections: readonly SessionSection[], hits: readonly SearchHit[]): SessionSection[] {
  const shown = new Set(sections.flatMap(section => section.data.map(row => row.id)))
  const extra = hits.filter((hit, index) => !shown.has(hit.id) && hits.findIndex(other => other.id === hit.id) === index)

  return extra.length ? [...sections, { title: 'In messages', data: extra }] : [...sections]
}

/** The name of the host's own profile. */
export const DEFAULT_PROFILE = 'default'

export type SessionActionId = 'pin' | 'rename' | 'branch' | 'export' | 'export-text' | 'archive' | 'select' | 'delete'

export interface SessionAction {
  id: SessionActionId
  label: string
  icon: 'bookmark' | 'edit-2' | 'git-branch' | 'share' | 'file-text' | 'archive' | 'inbox' | 'check-circle' | 'trash-2'
  danger?: boolean
}

/** The actions of one conversation, in the order of the sheet. The labels say what a tap does now. */
export function sessionActions(row: SessionRow): SessionAction[] {
  return [
    { id: 'pin', label: row.pinned ? 'Unpin' : 'Pin to the top', icon: 'bookmark' },
    { id: 'rename', label: 'Rename', icon: 'edit-2' },
    { id: 'branch', label: 'Branch into a new conversation', icon: 'git-branch' },
    { id: 'export-text', label: 'Export to read (Markdown)', icon: 'file-text' },
    { id: 'export', label: 'Export all data (JSON)', icon: 'share' },
    row.archived ? { id: 'archive', label: 'Move back to the list', icon: 'inbox' } : { id: 'archive', label: 'Archive', icon: 'archive' },
    { id: 'select', label: 'Select more to delete', icon: 'check-circle' },
    { id: 'delete', label: 'Delete', icon: 'trash-2', danger: true }
  ]
}

/** The list after a change the backend has not confirmed yet. An archived row leaves the view it was in. */
export function withSessionChange(rows: readonly SessionRow[], id: string, change: Partial<SessionRow>): SessionRow[] {
  return rows.flatMap(row => {
    if (row.id !== id) {
      return [row]
    }

    return change.archived !== undefined && change.archived !== Boolean(row.archived) ? [] : [{ ...row, ...change }]
  })
}

/** A file name for an exported conversation: the title, without what a file system refuses. */
export function exportFileName(row: SessionRow): string {
  const base = sessionTitle(row)
    .replace(/[^\p{L}\p{N} _-]+/gu, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)

  return `${base || 'conversation'}.json`
}

/**
 * A conversation as a Markdown text a person can read: the title, then each
 * message under the name of who wrote it. A tool call is one line; its output
 * stays on the host.
 */
export function sessionMarkdown(row: SessionRow, messages: readonly { role: string; text?: string | null; name?: string | null; context?: string | null }[]): string {
  const parts = [`# ${sessionTitle(row)}`]

  for (const message of messages) {
    const text = (message.text ?? '').trim()

    if (message.role === 'tool') {
      parts.push(`> Tool: ${message.name ?? 'tool'}${message.context ? ` — ${message.context}` : ''}`)
    } else if (text) {
      parts.push(`## ${message.role === 'user' ? 'You' : 'Hermes'}\n\n${text}`)
    }
  }

  return `${parts.join('\n\n')}\n`
}

/**
 * The ids to delete in one request for each profile. The host deletes in one profile a request and wants
 * the profile named, also its own: a host with several profiles refuses a delete with no name.
 */
export function deleteGroups(rows: readonly SessionRow[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()

  for (const row of rows) {
    const profile = row.profile || DEFAULT_PROFILE

    groups.set(profile, [...(groups.get(profile) ?? []), row.id])
  }

  return groups
}
