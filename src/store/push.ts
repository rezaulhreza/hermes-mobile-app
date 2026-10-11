/**
 * Push notifications of this phone. The token goes to the backend of the
 * active workspace when its link is open; a tap on a notification opens the
 * conversation it names.
 *
 * The native module is optional: a build made before it was added, and a
 * platform with no APNs, get no notifications and no error.
 */

import Constants from 'expo-constants'
import type * as NotificationsModule from 'expo-notifications'
import { router } from 'expo-router'
import { atom } from 'nanostores'
import { Platform } from 'react-native'

import type { HermesApi } from '@/core/api'
import { isDeviceToken, isStoredSessionId, type PushPayload, pushEnvironment, pushRoute, readPushPayload, registrationBody, registrationKey, showsBanner } from '@/core/push'

import { $conversations, $shownSession } from './chat'
import { $linkState, currentApi, rpc } from './link'
import { $activeWorkspace } from './workspaces'

export interface PushState {
  /** `unavailable`: this build or this device cannot get notifications. */
  permission: 'unknown' | 'granted' | 'denied' | 'undetermined' | 'unavailable'
  /** The backend of the active workspace has the token of this phone. */
  registered: boolean
  /** Why the last try failed, in words for the Settings screen. */
  error: string | null
}

export const $push = atom<PushState>({ permission: 'unknown', registered: false, error: null })

let notifications: typeof NotificationsModule | null | undefined
let token: string | null = null
let registeredKey: string | null = null
let installed = false
/** The notification the user tapped, until the link can open its conversation. */
let waiting: PushPayload | null = null

function patch(change: Partial<PushState>): void {
  $push.set({ ...$push.get(), ...change })
}

function module(): typeof NotificationsModule | null {
  if (notifications === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      notifications = Platform.OS === 'ios' ? (require('expo-notifications') as typeof NotificationsModule) : null
    } catch {
      notifications = null
    }
  }

  return notifications
}

/** Listen for taps and decide what shows while the app is open. Call once, at the start of the app. */
export function installPush(): void {
  const api = module()

  if (!api || installed) {
    return
  }

  installed = true
  api.setNotificationHandler({
    handleNotification: async notification => {
      const show = showsBanner(payloadOf(notification), $shownSession.get())

      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false }
    }
  })
  api.addNotificationResponseReceivedListener(response => openPayload(payloadOf(response.notification)))

  // The tap that started the app came before this listener.
  const first = api.getLastNotificationResponse()

  if (first) {
    openPayload(payloadOf(first.notification))
  }
}

/** A notification from APNs has its keys in the payload of the trigger; `data` is then empty. */
function payloadOf(notification: NotificationsModule.Notification): PushPayload {
  const trigger = notification.request.trigger as { payload?: unknown } | null

  return readPushPayload(notification.request.content.data, trigger?.payload)
}

/** The tap on a notification, from its keys. For a check with `scripts/drive.mjs`. */
export function openFromPush(data: unknown): void {
  openPayload(readPushPayload(data))
}

/** Open the conversation a notification names. It waits for the link when the app just started. */
function openPayload(payload: PushPayload): void {
  if (!payload.sessionId) {
    return
  }

  waiting = payload
  void openWaiting()
}

async function openWaiting(): Promise<void> {
  const payload = waiting

  if (!payload || $linkState.get() !== 'open') {
    return
  }

  waiting = null

  // The notification has the live id. A conversation opens by its stored id.
  const open = Object.values($conversations.get()).find(conversation => conversation.sessionId === payload.sessionId)
  let storedId: string | null = open?.storedId ?? null

  if (!storedId) {
    try {
      // `session_key` is the stored id; `stored_session_id` is empty for a session that was not resumed.
      const result = await rpc<{ stored_session_id?: string | null; session_key?: string | null }>('session.activate', {
        session_id: payload.sessionId,
        omit_messages: true,
        ...(payload.profile ? { profile: payload.profile } : {})
      })

      storedId = result.stored_session_id || result.session_key || null
    } catch {
      // The live session is gone (the backend started again, or the request was answered elsewhere).
    }
  }

  storedId ??= isStoredSessionId(payload.sessionId) ? payload.sessionId : null
  router.push(pushRoute(storedId, payload.profile) as never)
}

/**
 * Ask for the permission (once, by the system) and give the token to the
 * backend. Runs when the link opens, so the question never comes before the
 * app works. A refusal is quiet.
 */
export async function registerPush(): Promise<void> {
  const api = module()
  const workspace = $activeWorkspace.get()
  const backend = currentApi()

  void openWaiting()

  if (!api) {
    return patch({ permission: 'unavailable' })
  }

  if (!workspace || !backend) {
    return
  }

  try {
    let permission = await api.getPermissionsAsync()

    if (!permission.granted && permission.canAskAgain && permission.status === 'undetermined') {
      permission = await api.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } })
    }

    patch({ permission: permission.granted ? 'granted' : permission.status === 'undetermined' ? 'undetermined' : 'denied' })

    if (!permission.granted) {
      return
    }

    token ??= (await api.getDevicePushTokenAsync()).data as string

    if (!isDeviceToken(token)) {
      token = null

      return patch({ registered: false, error: 'This device gave no token that a host can use. A Simulator gives none.' })
    }

    const key = registrationKey(workspace.id, token)

    if (key === registeredKey) {
      return
    }

    await backend.request({ path: '/api/push/register', method: 'POST', body: registrationBody(token, pushEnvironment(__DEV__), deviceLabel()), timeoutMs: 10_000 })
    registeredKey = key
    patch({ registered: true, error: null })
  } catch (error) {
    // The next open of the link tries again.
    patch({ registered: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Tell a backend to forget this phone, before the sign-out. Never throws: the sign-out goes on. */
export async function unregisterPush(backend: HermesApi, workspaceId: string): Promise<void> {
  if (!token) {
    return
  }

  try {
    await backend.request({ path: '/api/push/register', method: 'POST', body: { ...registrationBody(token, pushEnvironment(__DEV__), deviceLabel()), unregister: true }, timeoutMs: 8000 })
  } catch {
    // The backend drops a token that Apple refuses.
  }

  if (registeredKey === registrationKey(workspaceId, token)) {
    registeredKey = null
    patch({ registered: false })
  }
}

/** Another workspace is active: its backend does not have the token yet. */
export function clearPush(): void {
  waiting = null
  patch({ registered: false, error: null })
}

function deviceLabel(): string {
  return Constants.deviceName || (Platform.OS === 'ios' && Platform.isPad ? 'iPad' : 'iPhone')
}
