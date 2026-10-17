/**
 * The copy of a list that the phone keeps between runs.
 *
 * The first answer of a host for a list can take seconds. A screen shows the
 * copy at once and replaces it when the host answers. The copy holds rows a
 * list shows, never a secret: no key value, no login, no message text beyond
 * the one-line preview of a chat.
 */

import type { SessionRow } from './sessions'

/** Change this when the shape of a stored list changes. An older copy is then not read. */
export const CACHE_VERSION = 1

export type CacheKey = 'sessions' | 'bots' | 'avatars' | 'schedules' | 'providers' | 'botRead'

/** A workspace id is made by the app, but a file name must be safe whatever it holds. */
export function cacheFolderName(workspaceId: string): string {
  return workspaceId.replace(/[^A-Za-z0-9_-]/g, '_')
}

export function packCache(value: unknown): string {
  return JSON.stringify({ v: CACHE_VERSION, value })
}

/** The stored value, or null for a missing, broken or older copy. */
export function unpackCache<T>(text: string | null | undefined): T | null {
  if (!text) {
    return null
  }

  try {
    const parsed = JSON.parse(text) as { v?: unknown; value?: T }

    return parsed?.v === CACHE_VERSION && parsed.value !== undefined ? parsed.value : null
  } catch {
    return null
  }
}

/**
 * A row of the chat list with only what the list reads. The host sends more
 * than sixty fields a row (token counts, costs, the model settings); a
 * hundred rows of that is 160 KB in memory and on disk for nothing.
 */
export function slimSessionRow(row: SessionRow): SessionRow {
  return {
    id: row.id,
    title: row.title,
    preview: row.preview,
    source: row.source,
    started_at: row.started_at,
    last_active: row.last_active,
    pinned: row.pinned,
    archived: row.archived,
    unread: row.unread,
    profile: row.profile,
    is_default_profile: row.is_default_profile
  }
}
