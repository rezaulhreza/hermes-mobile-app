import { atom } from 'nanostores'

import type { SessionListResult, SessionListRow } from '@/core/gateway/gateway-contract.generated'

import { onGatewayEvent, rpc } from './link'

export const $sessions = atom<SessionListRow[]>([])
export const $sessionsLoading = atom(false)
/** The text in the search field of the list. `/resume <words>` in a chat sets it. */
export const $sessionQuery = atom('')
export const $sessionsError = atom<string | null>(null)

export async function refreshSessions(): Promise<void> {
  $sessionsLoading.set(true)

  try {
    const result = await rpc<SessionListResult>('session.list', { limit: 100 })

    $sessions.set(result.sessions ?? [])
    $sessionsError.set(null)
  } catch (error) {
    $sessionsError.set(error instanceof Error ? error.message : String(error))
  } finally {
    $sessionsLoading.set(false)
  }
}

export function clearSessions(): void {
  $sessions.set([])
  $sessionsError.set(null)
}

// The backend says when the list changed, so the list never polls.
onGatewayEvent(event => {
  if (event.type === 'sessions.changed' || event.type === 'session.title') {
    void refreshSessions()
  }
})
