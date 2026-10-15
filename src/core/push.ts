/**
 * Push notifications: what the backend needs from this phone, and what a
 * notification says. The backend sends through APNs when the agent waits for
 * the user (a question, an approval) or a bot addresses them.
 *
 *   POST /api/plugins/phone-push/register {token, environment, platform, profile, label}
 *   the same route with {token, unregister: true} forgets the phone.
 *
 * The payload has `session_id`, `profile` and `kind` beside `aps`.
 */

/** The routes of the host's `phone-push` plugin (`host/phone-push`). A host without it sends no notification. */
export const PUSH_ROUTE = '/api/plugins/phone-push'

export type PushEnvironment = 'production' | 'sandbox'

/** APNs gives 32 bytes as hex. The backend refuses every other shape. */
export function isDeviceToken(token: unknown): token is string {
  return typeof token === 'string' && /^[0-9a-f]{64}$/i.test(token)
}

/**
 * The APNs host that made the token. A development build gets a sandbox
 * token; a TestFlight or App Store build gets a production one. The backend
 * tries the other host once when Apple refuses the token, so a build that is
 * signed in an unusual way still gets its notifications.
 */
export function pushEnvironment(developmentBuild: boolean): PushEnvironment {
  return developmentBuild ? 'sandbox' : 'production'
}

export interface PushRegistration {
  token: string
  environment: PushEnvironment
  platform: 'ios'
  /** Empty: notifications for every bot of the host. The phone shows them all. */
  profile: string
  label: string
}

export function registrationBody(token: string, environment: PushEnvironment, label: string): PushRegistration {
  return { token: token.toLowerCase(), environment, platform: 'ios', profile: '', label: label.trim().slice(0, 80) }
}

export interface PushPayload {
  /** The LIVE session id of the conversation that waits. Empty when the notification names none. */
  sessionId: string
  profile: string
  kind: string
}

/**
 * Read the keys of a notification. They are in the first of these places
 * that names a conversation: a library gives the keys beside `aps` in one
 * place for a notification from APNs and in another for one made on the phone.
 */
export function readPushPayload(...places: unknown[]): PushPayload {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
  const records = places.filter((place): place is Record<string, unknown> => Boolean(place) && typeof place === 'object')
  const record = records.find(place => text(place.session_id)) ?? records[0] ?? {}

  return { sessionId: text(record.session_id), profile: text(record.profile), kind: text(record.kind) }
}

/** A stored conversation id is a date, a time and a few hex characters. A live id is hex only. */
export function isStoredSessionId(id: string): boolean {
  return /^\d{8}_\d{6}_[0-9a-f]+$/i.test(id)
}

/** Where the inbox of waiting requests is. */
export const INBOX_ROUTE = '/activity'

/**
 * The exact place a tap on a notification opens: the conversation that
 * waits, in the profile of its bot (its request card is above the message
 * field there). With no conversation to open (the live session is gone and
 * its stored id is not known), the inbox of waiting requests.
 */
export function pushRoute(storedId: string | null, profile: string): string {
  if (!storedId) {
    return INBOX_ROUTE
  }

  const own = profile && profile !== 'default' ? `?profile=${encodeURIComponent(profile)}` : ''

  return `/chat/${encodeURIComponent(storedId)}${own}`
}

/**
 * A notification that arrives while the app is open shows as a banner, but
 * not for the conversation on screen: its request card is already there.
 */
export function showsBanner(payload: PushPayload, shownSessionId: string | null): boolean {
  return !payload.sessionId || payload.sessionId !== shownSessionId
}

/** One registration per workspace and token. A new token, or another workspace, registers again. */
export function registrationKey(workspaceId: string, token: string): string {
  return `${workspaceId}:${token.toLowerCase()}`
}

/** The category the backend puts on the push of an approval. The buttons hang on it. */
export const APPROVAL_CATEGORY = 'hermes.approval'

export type PushChoice = 'once' | 'session' | 'always' | 'deny'

/** The answers Hermes itself offers for an approval, as the buttons of the notification. */
export const APPROVAL_ACTIONS: readonly { id: PushChoice; title: string; destructive: boolean }[] = [
  { id: 'once', title: 'Allow once', destructive: false },
  { id: 'session', title: 'Allow in this chat', destructive: false },
  { id: 'always', title: 'Always allow', destructive: false },
  { id: 'deny', title: 'Deny', destructive: true }
]

/**
 * What a press on a notification means. A button of an approval is an answer
 * for the conversation the notification names; everything else (a tap on the
 * banner, a button the app does not know, a notification with no
 * conversation) opens the app.
 */
export function pushAnswer(actionId: unknown, payload: PushPayload): { sessionId: string; choice: PushChoice } | null {
  const action = APPROVAL_ACTIONS.find(known => known.id === actionId)

  return action && payload.kind === 'approval' && payload.sessionId ? { sessionId: payload.sessionId, choice: action.id } : null
}

/** The line the phone shows when an answer from a notification did not arrive. */
export function answerFailure(status: number | null): string {
  return status === 409 ? 'This approval was answered already, or Hermes no longer waits for it.' : 'Hermes did not get your answer. Open the chat to answer there.'
}
