import { atom } from 'nanostores'

import type { GatewayEvent } from '@/core/gateway/gateway-events'
import { type AgentAnswer, type AgentRequest, agentRequestFrom, wireResult } from '@/core/requests'

import { onGatewayEvent, onGatewayRequest } from './link'

/** Every request that waits for the user, oldest first, across all sessions. */
export const $requests = atom<AgentRequest[]>([])

// The live `respond` handles stay out of the atom: they are not state, and a
// handle from a dead socket must not survive a re-delivery of the same id.
const responders = new Map<string, (result: Record<string, unknown>) => void>()
/** The id of the frame of a request -> the id the request has in the list. */
const frames = new Map<string, string>()

function drop(match: (request: AgentRequest) => boolean): void {
  for (const request of $requests.get()) {
    if (match(request)) {
      responders.delete(request.id)
    }
  }

  $requests.set($requests.get().filter(request => !match(request)))
}

export function answerRequest(id: string, answer: AgentAnswer): void {
  responders.get(id)?.(wireResult(answer))
  drop(request => request.id === id)
}

/** The approvals of one conversation were answered from outside this screen (a button of a notification). */
export function dropApprovalsOf(sessionId: string): void {
  drop(request => request.kind === 'approval' && request.sessionId === sessionId)
}

export function clearRequests(): void {
  responders.clear()
  frames.clear()
  $requests.set([])
}

onGatewayRequest(request => {
  const model = agentRequestFrom(request.method, request.id, request.params)

  if (!model) {
    return false
  }

  responders.set(model.id, request.respond)
  // The host withdraws a request by the id of its frame. An approval is known here by its own id.
  frames.set(String(request.id), model.id)
  $requests.set([...$requests.get().filter(r => r.id !== model.id), model])

  return true
})

// The backend withdraws a request when the turn ends or another client answers it.
onGatewayEvent(event => {
  if (event.type === 'request.cancel') {
    const id = String((event as GatewayEvent<'request.cancel'>).payload?.id ?? '')
    const known = frames.get(id) ?? id

    frames.delete(id)
    drop(request => request.id === known)
  } else if (event.type === 'approval.cancelled') {
    const ids = new Set((event as GatewayEvent<'approval.cancelled'>).payload?.request_ids ?? [])

    drop(request => request.kind === 'approval' && ids.has(request.id))
  }
})
