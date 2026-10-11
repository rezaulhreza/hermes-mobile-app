import { File, Paths } from 'expo-file-system'
import { atom } from 'nanostores'

import type { SessionBranchStoredResult } from '@/core/gateway/gateway-contract.generated'
import {
  exportFileName,
  rowProfile,
  rowsInView,
  SEARCH_MIN_CHARS,
  type SearchHit,
  SESSION_PAGE,
  SESSION_SOURCE,
  sessionListPath,
  sessionSearchPath,
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
/** Show only the conversations of this profile (a bot). Null shows every profile. */
export const $sessionProfile = atom<string | null>(null)

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

/** The conversations that have the words of the search field in a message. */
export const $sessionHits = atom<SearchHit[]>([])

const SEARCH_WAIT_MS = 350
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** Ask the host for message matches, a moment after the last key. An answer for older words is not shown. */
function searchMessages(): void {
  const query = $sessionQuery.get().trim()

  if (searchTimer) {
    clearTimeout(searchTimer)
    searchTimer = null
  }

  if (query.length < SEARCH_MIN_CHARS || $sessionView.get() === 'archived') {
    $sessionHits.set([])

    return
  }

  searchTimer = setTimeout(() => {
    searchTimer = null

    const profile = $sessionProfile.get()
    const source = $sessionSource.get()

    currentApi()
      ?.request<{ results?: SearchHit[] }>({ path: sessionSearchPath(query, { profile, source }) })
      .then(result => {
        if (query === $sessionQuery.get().trim() && profile === $sessionProfile.get() && source === $sessionSource.get()) {
          $sessionHits.set(result.results ?? [])
        }
      })
      .catch(() => $sessionHits.set([]))
  }, SEARCH_WAIT_MS)
}

$sessionQuery.listen(searchMessages)
$sessionProfile.listen(searchMessages)
$sessionSource.listen(searchMessages)
$sessionView.listen(searchMessages)

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
        .request<SessionList>({ path: `/api/profiles/sessions?limit=0&profile=all&source=${source}` })
        .then(result => (result.total ? source : null))
        .catch(() => null)
    )
  )

  $sessionSources.set(withSources($sessionSources.get(), counts))
}

export async function refreshSessions(): Promise<void> {
  const view = $sessionView.get()
  const source = $sessionSource.get()
  const profile = $sessionProfile.get()

  $sessionsLoading.set(true)

  try {
    const result = await api().request<SessionList>({ path: sessionListPath(view, { source, profile }) })
    const page = result.sessions ?? []

    // The user can change the view, the source or the profile while the request runs. An answer for another one is not shown.
    if (view === $sessionView.get() && source === $sessionSource.get() && profile === $sessionProfile.get()) {
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
  const profile = $sessionProfile.get()
  const offset = $sessions.get().length

  loadingMore = true

  try {
    const result = await api().request<SessionList>({ path: sessionListPath(view, { source, offset, profile }) })
    const page = result.sessions ?? []

    // The offset counts the rows on screen. A refresh or another filter in the meantime makes this page wrong.
    if (view === $sessionView.get() && source === $sessionSource.get() && profile === $sessionProfile.get() && offset === $sessions.get().length) {
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

/** Show the conversations of one profile (a bot), or of every profile with null. */
export function showSessionProfile(profile: string | null): void {
  if (profile !== $sessionProfile.get()) {
    $sessionProfile.set(profile)
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
  $sessionProfile.set(null)
  $sessionHits.set([])
  probed = false
}

/**
 * Change the title or a flag of a conversation. The list shows the change at
 * once and goes back to the backend's state if the backend refuses.
 */
export async function updateSession(row: SessionRow, change: Pick<SessionRow, 'title' | 'pinned' | 'archived'>): Promise<void> {
  const before = $sessions.get()

  $sessions.set(withSessionChange(before, row.id, change))

  try {
    // This route reads the profile from the body, not from the address.
    await api().request({ path: `/api/sessions/${encodeURIComponent(row.id)}`, method: 'PATCH', body: { ...change, profile: rowProfile(row) } })
  } catch (error) {
    $sessions.set(before)
    throw error
  }
}

/** Delete a conversation and its messages. The backend refuses while a turn writes to it. */
export async function deleteSession(row: SessionRow): Promise<void> {
  await api().request({ path: `/api/sessions/${encodeURIComponent(row.id)}`, method: 'DELETE', profile: rowProfile(row) })
  $sessions.set($sessions.get().filter(other => other.id !== row.id))
}

/** Copy a stored conversation into a new one. Returns the stored id of the copy. */
export async function branchSession(row: SessionRow): Promise<string> {
  const profile = rowProfile(row)
  const result = await rpc<SessionBranchStoredResult>('session.branch_stored', {
    parent_session_id: row.id,
    source: SESSION_SOURCE,
    ...(profile ? { profile } : {})
  })

  return result.stored_session_id || result.session_id
}

/** Save the conversation as a JSON file on the phone. Returns its address, for the share sheet. */
export async function exportSession(row: SessionRow): Promise<string> {
  const target = new File(Paths.cache, exportFileName(row))

  if (target.exists) {
    target.delete()
  }

  const { workspace } = api()
  const profile = rowProfile(row)
  const query = profile ? `?profile=${encodeURIComponent(profile)}` : ''

  await File.downloadFileAsync(`${workspace.baseUrl}/api/sessions/${encodeURIComponent(row.id)}/export${query}`, target, { headers: workspace.headers })

  return target.uri
}

// The backend says when the list changed, so the list never polls.
onGatewayEvent(event => {
  if (event.type === 'sessions.changed' || event.type === 'session.title') {
    void refreshSessions()
  }
})
