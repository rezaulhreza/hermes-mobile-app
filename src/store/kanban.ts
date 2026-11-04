/** The Kanban boards of the active workspace. Filled while the Board screen is open, emptied when it closes. */

import { atom } from 'nanostores'
import { $preferences, setPreference } from './preferences'
import { $activeWorkspace } from './workspaces'

import { type Board, boardColumns, boardRows, type CardDetail, cardDetail, type Column, togglePinned } from '@/core/kanban'

import { currentApi } from './link'

const ROUTE = '/api/plugins/kanban'

export const $boards = atom<Board[] | null>(null)
/** The board on screen. Null: the board the host works on. */
export const $boardSlug = atom<string | null>(null)
export const $columns = atom<Column[] | null>(null)

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

const on = (slug: string | null) => (slug ? `?board=${encodeURIComponent(slug)}` : '')

export async function loadBoards(): Promise<void> {
  $boards.set(boardRows(await api().request({ path: `${ROUTE}/boards` })))
}

/** Read the columns of the board on screen. The answer for a board the user left is not shown. */
export async function loadBoard(): Promise<void> {
  const slug = $boardSlug.get()
  const columns = boardColumns(await api().request({ path: `${ROUTE}/board${on(slug)}`, timeoutMs: 60_000 }))

  if (slug === $boardSlug.get()) {
    $columns.set(columns)
  }
}

export function showBoard(slug: string): void {
  if (slug !== $boardSlug.get()) {
    $boardSlug.set(slug)
    $columns.set(null)
    void loadBoard().catch(() => $columns.set([]))
  }
}

export async function loadCard(id: string): Promise<CardDetail | null> {
  return cardDetail(await api().request({ path: `${ROUTE}/tasks/${encodeURIComponent(id)}${on($boardSlug.get())}` }))
}

/** Change a card: its column (with the line the host wants for it), who has it, its title or its text. */
export async function updateCard(id: string, change: { status?: string; assignee?: string; title?: string; body?: string; summary?: string; block_reason?: string }): Promise<void> {
  await api().request({ path: `${ROUTE}/tasks/${encodeURIComponent(id)}${on($boardSlug.get())}`, method: 'PATCH', body: change, timeoutMs: 60_000 })
  await loadBoard()
}

export async function commentCard(id: string, body: string): Promise<void> {
  await api().request({ path: `${ROUTE}/tasks/${encodeURIComponent(id)}/comments${on($boardSlug.get())}`, method: 'POST', body: { body: body.trim(), author: 'user' } })
}

/** Make a card. With `triage` it waits to be sorted and no bot takes it yet. */
export async function createCard(title: string, body: string, assignee: string, triage: boolean): Promise<void> {
  await api().request({
    path: `${ROUTE}/tasks${on($boardSlug.get())}`,
    method: 'POST',
    body: { title: title.trim(), ...(body.trim() ? { body: body.trim() } : {}), ...(assignee ? { assignee } : {}), triage },
    timeoutMs: 60_000
  })
  await loadBoard()
}

export async function deleteCard(id: string): Promise<void> {
  await api().request({ path: `${ROUTE}/tasks/${encodeURIComponent(id)}${on($boardSlug.get())}`, method: 'DELETE' })
  await loadBoard()
}

/** Drop what the screen showed. A board of fifty cards is not kept while nobody looks at it. */
export function clearKanban(): void {
  $boards.set(null)
  $boardSlug.set(null)
  $columns.set(null)
}

/** The boards pinned on this phone for the active workspace. */
export function pinnedBoards(): string[] {
  return $preferences.get().pinnedBoards[$activeWorkspace.get()?.id ?? ''] ?? []
}

/** Pin a board of the active workspace, or unpin it. Only this phone keeps the pins, as the desktop app keeps its own. */
export function togglePinnedBoard(slug: string): void {
  const workspace = $activeWorkspace.get()?.id ?? ''
  const all = $preferences.get().pinnedBoards

  setPreference('pinnedBoards', { ...all, [workspace]: togglePinned(all[workspace] ?? [], slug) })
}
