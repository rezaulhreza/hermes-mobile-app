/**
 * The list of conversations: what a row shows, how the list is filtered and
 * grouped, and which actions a conversation has.
 *
 * The rows come from REST (`GET /api/sessions`), not from the `session.list`
 * RPC: only the REST row says if a conversation is pinned, archived or unread.
 */

import { previewLine } from './format'

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
  preview?: string | null
  /** Where the conversation started: desktop, mobile, telegram, cli, cron, ... */
  source?: string | null
  started_at?: number | null
  /** Unix seconds of the last message. The list is in this order. */
  last_active?: number | null
  pinned?: boolean | null
  archived?: boolean | null
  unread?: boolean | null
}

/** `current`: the normal list. `archived`: only what the user put away. */
export type SessionView = 'current' | 'archived'

export function sessionListPath(view: SessionView): string {
  return `/api/sessions?limit=100&order=recent&archived=${view === 'archived' ? 'only' : 'exclude'}`
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
  return row.title?.trim() || sessionPreview(row) || 'Untitled conversation'
}

/** The sources in the list, most used first. Empty when a filter would have one choice. */
export function sourceChoices(rows: readonly SessionRow[]): string[] {
  const counts = new Map<string, number>()

  for (const row of rows) {
    if (row.source) {
      counts.set(row.source, (counts.get(row.source) ?? 0) + 1)
    }
  }

  return counts.size > 1 ? [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([source]) => source) : []
}

export function filterSessions(rows: readonly SessionRow[], query: string, source: string | null): SessionRow[] {
  const needle = query.trim().toLowerCase()

  return rows.filter(
    row => (!source || row.source === source) && (!needle || `${row.title ?? ''} ${row.preview ?? ''}`.toLowerCase().includes(needle))
  )
}

export interface SessionSection {
  /** Null for a list with no pinned conversation: one group needs no heading. */
  title: string | null
  data: SessionRow[]
}

/** Pinned conversations first, under a heading. The order inside a group is the order given. */
export function sessionSections(rows: readonly SessionRow[]): SessionSection[] {
  const pinned = rows.filter(row => row.pinned)
  const rest = rows.filter(row => !row.pinned)

  if (!pinned.length) {
    return rest.length ? [{ title: null, data: rest }] : []
  }

  return [{ title: 'Pinned', data: pinned }, ...(rest.length ? [{ title: 'Recent', data: rest }] : [])]
}

export type SessionActionId = 'pin' | 'rename' | 'branch' | 'export' | 'archive' | 'delete'

export interface SessionAction {
  id: SessionActionId
  label: string
  icon: 'bookmark' | 'edit-2' | 'git-branch' | 'share' | 'archive' | 'inbox' | 'trash-2'
  danger?: boolean
}

/** The actions of one conversation, in the order of the sheet. The labels say what a tap does now. */
export function sessionActions(row: SessionRow): SessionAction[] {
  return [
    { id: 'pin', label: row.pinned ? 'Unpin' : 'Pin to the top', icon: 'bookmark' },
    { id: 'rename', label: 'Rename', icon: 'edit-2' },
    { id: 'branch', label: 'Branch into a new conversation', icon: 'git-branch' },
    { id: 'export', label: 'Export', icon: 'share' },
    row.archived ? { id: 'archive', label: 'Move back to the list', icon: 'inbox' } : { id: 'archive', label: 'Archive', icon: 'archive' },
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
