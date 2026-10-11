/**
 * The todo list and the helpers of each open conversation, kept by live
 * session id. The events fill it; `loadHelpers` asks the host for the helpers
 * that run now (after the app opened a conversation in the middle of a turn).
 */

import { map } from 'nanostores'

import type { SubagentInterruptResult, SubagentListResult, SubagentSteerResult, SubagentTailResult, TodoState } from '@/core/gateway/gateway-contract.generated'
import { NO_WORK, reduceWork, withSnapshots, withTodos, type Work } from '@/core/work'

import { onGatewayEvent, rpc } from './link'

export const $work = map<Record<string, Work>>({})

function change(sessionId: string, next: (work: Work) => Work): void {
  const current = $work.get()[sessionId] ?? NO_WORK
  const after = next(current)

  if (after !== current) {
    $work.setKey(sessionId, after)
  }
}

/** The todo list that came with a resumed conversation. */
export function seedTodos(sessionId: string, state: TodoState | null | undefined): void {
  if (state) {
    change(sessionId, work => withTodos(work, state.todos, state.revision))
  }
}

export async function loadHelpers(sessionId: string): Promise<void> {
  const result = await rpc<SubagentListResult>('subagent.list', { session_id: sessionId })

  change(sessionId, work => withSnapshots(work, result.subagents ?? []))
}

/** The newest lines of a helper's own conversation. Null when the host has none (not started, or cleaned up). */
export async function helperTail(sessionId: string, helperId: string): Promise<string | null> {
  const result = await rpc<SubagentTailResult>('subagent.tail', { session_id: sessionId, subagent_id: helperId })

  return result.available === false ? null : (result.text ?? '')
}

/** Give a running helper a message. False when it no longer takes one. */
export async function steerHelper(sessionId: string, helperId: string, text: string): Promise<boolean> {
  const result = await rpc<SubagentSteerResult>('subagent.steer', { session_id: sessionId, subagent_id: helperId, text })

  return result.status === 'queued'
}

/** Stop one helper. The agent goes on with the others. */
export async function stopHelper(sessionId: string, helperId: string): Promise<boolean> {
  return (await rpc<SubagentInterruptResult>('subagent.interrupt', { session_id: sessionId, subagent_id: helperId })).found
}

/** Drop the plan and the helpers of one conversation that closed. */
export function forgetWork(sessionId: string): void {
  $work.setKey(sessionId, undefined as unknown as Work)
}

export function clearWork(): void {
  $work.set({})
}

onGatewayEvent(event => {
  if (event.session_id) {
    change(event.session_id, work => reduceWork(work, event, Date.now()))
  }
})
