/**
 * The live link to the active workspace: one REST client and one gateway
 * socket. Exactly one link exists at a time. Switching workspace closes the
 * old link before the new one dials, so no event from one account can land in
 * the other account's screens.
 */

import { atom } from 'nanostores'

import { HermesApi, isAuthRejection } from '@/core/api'
import type { GatewayEvent } from '@/core/gateway/gateway-events'
import { JsonRpcGatewayClient } from '@/core/gateway/json-rpc-gateway'
import type { ServerRequest } from '@/core/gateway/json-rpc-channel'
import { reconnectBackoffDelayMs } from '@/core/gateway/reconnect-backoff'
import { type Workspace, wsOriginFor } from '@/core/workspaces'

export type LinkState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'auth-failed' | 'failed'

export const $linkState = atom<LinkState>('idle')
export const $linkError = atom<string | null>(null)

type EventHandler = (event: GatewayEvent) => void
type RequestHandler = (request: ServerRequest) => boolean | void

const eventHandlers = new Set<EventHandler>()
const requestHandlers = new Set<RequestHandler>()

interface Link {
  workspace: Workspace
  api: HermesApi
  client: JsonRpcGatewayClient
  attempt: number
  timer: ReturnType<typeof setTimeout> | null
  closed: boolean
}

let link: Link | null = null

/** React Native's WebSocket takes request headers as a third argument; the DOM type does not know it. */
type HeaderSocket = new (url: string, protocols: undefined, options: { headers: Record<string, string> }) => WebSocket

export function currentApi(): HermesApi | null {
  return link?.api ?? null
}

/** Call a gateway method on the active link. Rejects when no link is open. */
export function rpc<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
  if (!link) {
    return Promise.reject(new Error('Not connected to a Hermes workspace.'))
  }

  return link.client.request<T>(method, params, timeoutMs)
}

/**
 * A socket beside `/api/ws` on the same host (voice PCM is not JSON-RPC and
 * cannot share the gateway socket). It signs in the same way: its own ticket
 * and the proxy headers.
 */
export async function openSiblingSocket(path: string): Promise<WebSocket> {
  const target = link

  if (!target) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  const ticket = await target.api.wsTicket()

  return new (WebSocket as unknown as HeaderSocket)(`${wsOriginFor(target.workspace.baseUrl)}${path}?ticket=${encodeURIComponent(ticket)}`, undefined, {
    headers: target.workspace.headers
  })
}

export function onGatewayEvent(handler: EventHandler): () => void {
  eventHandlers.add(handler)

  return () => eventHandlers.delete(handler)
}

export function onGatewayRequest(handler: RequestHandler): () => void {
  requestHandlers.add(handler)

  return () => requestHandlers.delete(handler)
}

export function closeLink(): void {
  if (!link) {
    return
  }

  link.closed = true

  if (link.timer) {
    clearTimeout(link.timer)
  }

  link.client.close()
  link = null
  $linkState.set('idle')
  $linkError.set(null)
}

export async function openLink(workspace: Workspace): Promise<void> {
  closeLink()

  const headers = workspace.headers
  const client = new JsonRpcGatewayClient({
    socketFactory: url => new (WebSocket as unknown as HeaderSocket)(url, undefined, { headers })
  })

  const next: Link = { workspace, api: new HermesApi(workspace), client, attempt: 0, timer: null, closed: false }

  link = next
  client.onAny(event => eventHandlers.forEach(handler => handler(event)))
  client.onRequest(request => {
    for (const handler of requestHandlers) {
      if (handler(request) !== false) {
        return true
      }
    }

    return false
  })
  client.onState(state => {
    if (next.closed) {
      return
    }

    if (state === 'open') {
      next.attempt = 0
      $linkError.set(null)
      $linkState.set('open')
    } else if (state === 'closed' || state === 'error') {
      scheduleRedial(next)
    }
  })

  $linkState.set('connecting')
  await dial(next)
}

async function dial(target: Link): Promise<void> {
  if (target.closed) {
    return
  }

  try {
    // The ticket is single-use and lives 30 s, so every dial mints its own.
    const ticket = await target.api.wsTicket()

    if (target.closed) {
      return
    }

    await target.client.connect(`${wsOriginFor(target.workspace.baseUrl)}/api/ws?ticket=${encodeURIComponent(ticket)}`)
  } catch (error) {
    if (target.closed) {
      return
    }

    $linkError.set(error instanceof Error ? error.message : String(error))

    // Wrong credentials do not get better with time. Stop and ask the user.
    if (isAuthRejection(error)) {
      $linkState.set('auth-failed')

      return
    }

    scheduleRedial(target)
  }
}

function scheduleRedial(target: Link): void {
  if (target.closed || target.timer) {
    return
  }

  $linkState.set(target.attempt === 0 && $linkState.get() === 'connecting' ? 'failed' : 'reconnecting')

  const delay = reconnectBackoffDelayMs(target.attempt, { baseDelayMs: 500 })

  target.attempt += 1
  target.timer = setTimeout(() => {
    target.timer = null
    void dial(target)
  }, delay)
}

/** Dial now instead of waiting for the backoff timer. Used when the app returns to the foreground. */
export function redialNow(): void {
  if (!link || $linkState.get() === 'open' || $linkState.get() === 'connecting') {
    return
  }

  if (link.timer) {
    clearTimeout(link.timer)
    link.timer = null
  }

  link.attempt = 0
  void dial(link)
}
