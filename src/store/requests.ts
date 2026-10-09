import { atom } from 'nanostores'

import type { GatewayEvent } from '@/core/gateway/gateway-events'
import { type AgentAnswer, type AgentRequest, agentRequestFrom, wireResult } from '@/core/requests'

import { onGatewayEvent, onGatewayRequest } from './link'

/** Every request that waits for the user, oldest first, across all sessions. */
export const $requests = atom<AgentRequest[]>([])

// The live `respond` handles stay out of the atom: they are not state, and a
// handle from a dead socket must not survive a re-delivery of the same id.
const responders = new Map<string, (result: Record<string, unknown>) => void>()

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

export function clearRequests(): void {
  responders.clear()
  $requests.set([])
}

onGatewayRequest(request => {
  const model = agentRequestFrom(request.method, request.id, request.params)

  if (!model) {
    return false
  }

  responders.set(model.id, request.respond)
  $requests.set([...$requests.get().filter(r => r.id !== model.id), model])

  return true
})

// The backend withdraws a request when the turn ends or another client answers it.
onGatewayEvent(event => {
  if (event.type === 'request.cancel') {
    const id = (event as GatewayEvent<'request.cancel'>).payload?.id

    drop(request => request.id === id)
  } else if (event.type === 'approval.cancelled') {
    const ids = new Set((event as GatewayEvent<'approval.cancelled'>).payload?.request_ids ?? [])

    drop(request => request.kind === 'approval' && ids.has(request.id))
  }
})
