import { File, Paths } from 'expo-file-system'
import { atom } from 'nanostores'

import type { SessionBranchStoredResult } from '@/core/gateway/gateway-contract.generated'
import { exportFileName, rowsInView, sessionListPath, type SessionRow, type SessionView, withSessionChange } from '@/core/sessions'

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

export async function refreshSessions(): Promise<void> {
  const view = $sessionView.get()

  $sessionsLoading.set(true)

  try {
    const result = await api().request<{ sessions?: SessionRow[] }>({ path: sessionListPath(view) })

    // The user can change the view while the request runs. An answer for the other view is not shown.
    if (view === $sessionView.get()) {
      $sessions.set(rowsInView(result.sessions ?? [], view))
      $sessionsError.set(null)
    }
  } catch (error) {
    $sessionsError.set(error instanceof Error ? error.message : String(error))
  } finally {
    $sessionsLoading.set(false)
  }
}

export function showSessionView(view: SessionView): void {
  if (view !== $sessionView.get()) {
    $sessionView.set(view)
    $sessions.set([])
    void refreshSessions()
  }
}

export function clearSessions(): void {
  $sessions.set([])
  $sessionsError.set(null)
  $sessionView.set('current')
  $sessionSource.set(null)
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
  const result = await rpc<SessionBranchStoredResult>('session.branch_stored', { parent_session_id: id, source: 'mobile' })

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
