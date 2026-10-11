import { File, Paths } from 'expo-file-system'
import { atom } from 'nanostores'

import type { SessionBranchStoredResult } from '@/core/gateway/gateway-contract.generated'
import {
  exportFileName,
  rowsInView,
  SESSION_PAGE,
  SESSION_SOURCE,
  sessionListPath,
  type SessionRow,
  type SessionView,
  SOURCES_TO_PROBE,
  withSessionChange,
  withSessionPage,
  withSources
} from '@/core/sessions'

import { currentApi, onGatewayEvent, rpc } from './link'

export const $sessions = atom<SessionRow[]>([])
export const $sessionsLoading = atom(false)
/** The text in the search field of the list. `/resume <words>` in a chat sets it. */
export const $sessionQuery = atom('')
export const $sessionsError = atom<string | null>(null)
export const $sessionView = atom<SessionView>('current')
/** Show only the conversations from this source. Null shows all. */
export const $sessionSource = atom<string | null>(null)

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

interface SessionList {
  sessions?: SessionRow[]
  total?: number
}

/** The backend has rows after the ones on screen. */
export const $sessionsMore = atom(false)
/** Every source the filter offers. It outlives a filter: the rows of one source name only that source. */
export const $sessionSources = atom<string[]>([])

let probed = false

/** Ask once a connection which of the rare sources have a conversation. Each answer is a count, with no rows. */
async function probeSources(): Promise<void> {
  if (probed) {
    return
  }

  probed = true

  const counts = await Promise.all(
    SOURCES_TO_PROBE.map(source =>
      api()
        .request<SessionList>({ path: `/api/sessions?limit=0&source=${source}` })
        .then(result => (result.total ? source : null))
        .catch(() => null)
    )
  )

  $sessionSources.set(withSources($sessionSources.get(), counts))
}

export async function refreshSessions(): Promise<void> {
  const view = $sessionView.get()
  const source = $sessionSource.get()

  $sessionsLoading.set(true)

  try {
    const result = await api().request<SessionList>({ path: sessionListPath(view, { source }) })
    const page = result.sessions ?? []

    // The user can change the view or the source while the request runs. An answer for the other one is not shown.
    if (view === $sessionView.get() && source === $sessionSource.get()) {
      $sessions.set(rowsInView(page, view))
      $sessionsMore.set(page.length >= SESSION_PAGE && (result.total ?? Infinity) > page.length)
      $sessionSources.set(withSources($sessionSources.get(), page.map(row => row.source)))
      $sessionsError.set(null)
    }

    void probeSources().catch(() => undefined)
  } catch (error) {
    $sessionsError.set(error instanceof Error ? error.message : String(error))
  } finally {
    $sessionsLoading.set(false)
  }
}

let loadingMore = false

/** The next page, when the list reaches its end. */
export async function loadMoreSessions(): Promise<void> {
  if (loadingMore || !$sessionsMore.get() || $sessionsLoading.get()) {
    return
  }

  const view = $sessionView.get()
  const source = $sessionSource.get()
  const offset = $sessions.get().length

  loadingMore = true

  try {
    const result = await api().request<SessionList>({ path: sessionListPath(view, { source, offset }) })
    const page = result.sessions ?? []

    // The offset counts the rows on screen. A refresh or another filter in the meantime makes this page wrong.
    if (view === $sessionView.get() && source === $sessionSource.get() && offset === $sessions.get().length) {
      $sessions.set(withSessionPage($sessions.get(), rowsInView(page, view)))
      $sessionsMore.set(page.length >= SESSION_PAGE && (result.total ?? Infinity) > offset + page.length)
      $sessionSources.set(withSources($sessionSources.get(), page.map(row => row.source)))
    }
  } catch {
    // The list keeps what it has. The next reach of the end asks again.
  } finally {
    loadingMore = false
  }
}

export function showSessionView(view: SessionView): void {
  if (view !== $sessionView.get()) {
    $sessionView.set(view)
    $sessions.set([])
    void refreshSessions()
  }
}

/** Show one source, or all with null. The backend filters, so the rows are asked for again. */
export function showSessionSource(source: string | null): void {
  if (source !== $sessionSource.get()) {
    $sessionSource.set(source)
    $sessions.set([])
    void refreshSessions()
  }
}

export function clearSessions(): void {
  $sessions.set([])
  $sessionsError.set(null)
  $sessionsMore.set(false)
  $sessionSources.set([])
  $sessionView.set('current')
  $sessionSource.set(null)
  probed = false
}

/**
 * Change the title or a flag of a conversation. The list shows the change at
 * once and goes back to the backend's state if the backend refuses.
 */
export async function updateSession(id: string, change: Pick<SessionRow, 'title' | 'pinned' | 'archived'>): Promise<void> {
  const before = $sessions.get()

  $sessions.set(withSessionChange(before, id, change))

  try {
    await api().request({ path: `/api/sessions/${encodeURIComponent(id)}`, method: 'PATCH', body: change })
  } catch (error) {
    $sessions.set(before)
    throw error
  }
}

/** Delete a conversation and its messages. The backend refuses while a turn writes to it. */
export async function deleteSession(id: string): Promise<void> {
  await api().request({ path: `/api/sessions/${encodeURIComponent(id)}`, method: 'DELETE' })
  $sessions.set($sessions.get().filter(row => row.id !== id))
}

/** Copy a stored conversation into a new one. Returns the stored id of the copy. */
export async function branchSession(id: string): Promise<string> {
  const result = await rpc<SessionBranchStoredResult>('session.branch_stored', { parent_session_id: id, source: SESSION_SOURCE })

  return result.stored_session_id || result.session_id
}

/** Save the conversation as a JSON file on the phone. Returns its address, for the share sheet. */
export async function exportSession(row: SessionRow): Promise<string> {
  const target = new File(Paths.cache, exportFileName(row))

  if (target.exists) {
    target.delete()
  }

  const { workspace } = api()

  await File.downloadFileAsync(`${workspace.baseUrl}/api/sessions/${encodeURIComponent(row.id)}/export`, target, { headers: workspace.headers })

  return target.uri
}

// The backend says when the list changed, so the list never polls.
onGatewayEvent(event => {
  if (event.type === 'sessions.changed' || event.type === 'session.title') {
    void refreshSessions()
  }
})
