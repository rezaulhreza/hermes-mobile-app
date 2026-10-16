import { File, Paths } from 'expo-file-system'
import { atom } from 'nanostores'

import type { ProjectsTreeResult, SessionActiveListResult, SessionBranchStoredResult } from '@/core/gateway/gateway-contract.generated'
import { PROJECT_ROWS, type ProjectChoice, projectChoices, projectRows } from '@/core/projects'
import { slimSessionRow } from '@/core/cache'
import { type HistoryPage, pageMessages, type StoredMessage } from '@/core/history-page'
import {
  deleteGroups,
  exportFileName,
  type LiveState,
  liveStates,
  rowProfile,
  rowsInView,
  sameLiveStates,
  SEARCH_MIN_CHARS,
  type SearchHit,
  SESSION_PAGE,
  SESSION_SOURCE,
  sessionListPath,
  sessionMarkdown,
  sessionSearchPath,
  type SessionRow,
  type SessionView,
  SOURCES_TO_PROBE,
  withSessionChange,
  withSessionPage,
  withSources
} from '@/core/sessions'

import { readCached, writeCached } from './cache'
import { currentApi, onGatewayEvent, rpc } from './link'
import { $activeWorkspace } from './workspaces'

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
/** Show only the conversations of this project (a folder of the host). Null shows all. */
export const $sessionProject = atom<ProjectChoice | null>(null)
/** The projects of the host that have a conversation. Null until the list of projects was opened. */
export const $projects = atom<ProjectChoice[] | null>(null)

function projectTree(): Promise<ProjectsTreeResult> {
  return rpc<ProjectsTreeResult>('projects.tree', { preview_limit: PROJECT_ROWS, session_limit: 0 }, 30_000)
}

/** Read the projects. The list of projects asks when it opens. */
export async function loadProjects(): Promise<void> {
  $projects.set(projectChoices(await projectTree()))
}

/** Show the conversations of one project, or all with null. */
export function showSessionProject(project: ProjectChoice | null): void {
  if (project?.id !== $sessionProject.get()?.id) {
    $sessionProject.set(project)
    $sessions.set([])
    void refreshSessions()
  }
}

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

/**
 * Ask once a connection which of the rare sources have a conversation. Each answer is a count, with no rows,
 * but the host opens the store of every profile for each one. So the list of channels asks when it opens,
 * not the start of the app.
 */
export async function loadSessionSources(): Promise<void> {
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

/** The conversations in which Hermes works now, or which wait for the user, by stored id. */
export const $liveSessions = atom<Record<string, LiveState>>({})

const LIVE_POLL_MS = 5000
let liveTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Ask the host which conversations work now: one small answer for all of them.
 * The host says when a list changed, but not when a turn ended. So this asks
 * again after a moment for as long as a conversation works, and then stops.
 */
export async function refreshLiveSessions(): Promise<void> {
  if (liveTimer) {
    clearTimeout(liveTimer)
    liveTimer = null
  }

  let states: Record<string, LiveState> = {}

  try {
    states = liveStates((await rpc<SessionActiveListResult>('session.active_list')).sessions ?? [])
  } catch {
    // No answer: no row shows a state it cannot prove. The next refresh of the list asks again.
  }

  if (!sameLiveStates(states, $liveSessions.get())) {
    $liveSessions.set(states)
  }

  if (Object.keys(states).length && !liveTimer) {
    liveTimer = setTimeout(() => void refreshLiveSessions(), LIVE_POLL_MS)
  }
}

export async function refreshSessions(): Promise<void> {
  void refreshLiveSessions()

  const view = $sessionView.get()
  const source = $sessionSource.get()
  const profile = $sessionProfile.get()
  const workspaceId = $activeWorkspace.get()?.id
  const project = $sessionProject.get()

  $sessionsLoading.set(true)

  try {
    // The rows of a project come with the tree of projects, in one answer.
    if (project) {
      const tree = await projectTree()

      if (project.id === $sessionProject.get()?.id) {
        $projects.set(projectChoices(tree))
        $sessions.set(rowsInView(projectRows(tree.projects.find(node => node.id === project.id)), view))
        $sessionsMore.set(false)
        $sessionsError.set(null)
      }

      return
    }

    const result = await api().request<SessionList>({ path: sessionListPath(view, { source, profile }) })
    const page = (result.sessions ?? []).map(slimSessionRow)

    // The list a start of the app shows: every profile, every channel, not the archive.
    if (view === 'current' && !source && !profile) {
      writeCached('sessions', rowsInView(page, view), workspaceId)
    }

    // The user can change the view, the source or the profile while the request runs. An answer for another one is not shown.
    if (view === $sessionView.get() && source === $sessionSource.get() && profile === $sessionProfile.get() && !$sessionProject.get()) {
      $sessions.set(rowsInView(page, view))
      $sessionsMore.set(page.length >= SESSION_PAGE && (result.total ?? Infinity) > page.length)
      $sessionSources.set(withSources($sessionSources.get(), page.map(row => row.source)))
      $sessionsError.set(null)
    }
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
    const page = (result.sessions ?? []).map(slimSessionRow)

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

/** Show the list of the last run until the host answers. */
export function restoreSessions(): void {
  const rows = readCached<SessionRow[]>('sessions')

  if (rows?.length && !$sessions.get().length) {
    $sessions.set(rows)
    $sessionSources.set(withSources($sessionSources.get(), rows.map(row => row.source)))
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
  $sessionProject.set(null)
  $projects.set(null)
  $sessionHits.set([])
  $selectedSessions.set(null)
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

const EXPORT_PAGE = 500
// A conversation of 20 000 stored rows. More than that is not a text to read on a phone.
const EXPORT_PAGES = 40

/** Save the conversation as a Markdown file on the phone. Returns its address, for the share sheet. */
export async function exportSessionText(row: SessionRow): Promise<string> {
  const rows: StoredMessage[] = []

  for (let page = 0; page < EXPORT_PAGES; page += 1) {
    const result = await api().request<HistoryPage>({
      path: `/api/sessions/${encodeURIComponent(row.id)}/messages?order=oldest&limit=${EXPORT_PAGE}&offset=${page * EXPORT_PAGE}&inline_images=false`,
      profile: rowProfile(row),
      timeoutMs: 60_000
    })
    const messages = result.messages ?? []

    rows.push(...messages)

    if (messages.length < EXPORT_PAGE) {
      break
    }
  }

  const target = new File(Paths.cache, exportFileName(row).replace(/\.json$/, '.md'))

  if (target.exists) {
    target.delete()
  }

  target.write(sessionMarkdown(row, pageMessages(rows)))

  return target.uri
}

/** The rows the user marked for one delete. Null: the list is not in its select mode. */
export const $selectedSessions = atom<string[] | null>(null)

export function toggleSelected(id: string): void {
  const selected = $selectedSessions.get() ?? []

  $selectedSessions.set(selected.includes(id) ? selected.filter(other => other !== id) : [...selected, id])
}

/** Delete the marked conversations. Returns how many the host kept because a turn still writes to them. */
export async function deleteSelected(): Promise<number> {
  const ids = new Set($selectedSessions.get() ?? [])
  const rows = $sessions.get().filter(row => ids.has(row.id))
  const kept: string[] = []

  for (const [profile, group] of deleteGroups(rows)) {
    const result = await api().request<{ skipped_active?: string[] }>({
      path: '/api/sessions/bulk-delete',
      method: 'POST',
      body: { ids: group, profile },
      timeoutMs: 60_000
    })

    kept.push(...(result.skipped_active ?? []))
  }

  $sessions.set($sessions.get().filter(row => !ids.has(row.id) || kept.includes(row.id)))
  $selectedSessions.set(null)

  return kept.length
}

// The backend says when the list changed, so the list never polls. Only the marks of working chats ask again.
onGatewayEvent(event => {
  if (event.type === 'sessions.changed' || event.type === 'session.title') {
    void refreshSessions()
  }
})
