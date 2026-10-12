/**
 * The todo list and the helpers of each open conversation, kept by live
 * session id. The events fill it; `loadHelpers` asks the host for the helpers
 * that run now (after the app opened a conversation in the middle of a turn).
 */

import { atom, map } from 'nanostores'

import type {
  DelegationPauseResult,
  DelegationStatusResult,
  SpawnTreeEntry,
  SpawnTreeListResult,
  SpawnTreeLoadResult,
  SubagentInterruptResult,
  SubagentListResult,
  SubagentSteerResult,
  SubagentTailResult,
  TodoState
} from '@/core/gateway/gateway-contract.generated'
import { type Helper, helperEnded, helperFromSaved, NO_WORK, reduceWork, runLabel, savedHelper, withFailedStarts, withSnapshots, withTodos, type Work } from '@/core/work'

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

  change(sessionId, work => withFailedStarts(withSnapshots(work, result.subagents ?? []), result.delegations))
}

/** Whether the host lets the agent start helpers now, and its limits. Null until asked. */
export const $delegation = atom<{ paused: boolean; maxDepth: number; maxAtOnce: number } | null>(null)

export async function loadDelegation(): Promise<void> {
  const status = await rpc<DelegationStatusResult>('delegation.status')

  $delegation.set({ paused: status.paused, maxDepth: status.max_spawn_depth, maxAtOnce: status.max_concurrent_children })
}

/** Stop the agent from starting new helpers, or let it again. Helpers that run go on. */
export async function pauseDelegation(paused: boolean): Promise<void> {
  const result = await rpc<DelegationPauseResult>('delegation.pause', { paused })
  const known = $delegation.get()

  $delegation.set({ paused: result.paused, maxDepth: known?.maxDepth ?? 0, maxAtOnce: known?.maxAtOnce ?? 0 })
}

// The helpers of each conversation that are in a saved run already.
const saved = new Map<string, Set<string>>()

/**
 * Keep the helpers of the turn that ended on the host, as a run of the stored
 * conversation. The events of a helper are gone when the chat closes; a saved
 * run is what a later open of the chat can still show.
 */
export async function saveRun(sessionId: string, storedId: string): Promise<void> {
  const done = saved.get(sessionId) ?? new Set<string>()
  const helpers = ($work.get()[sessionId]?.helpers ?? []).filter(helper => !done.has(helper.id))

  // A helper that still runs belongs to a turn that goes on in the background. The next save takes it.
  if (!helpers.length || helpers.some(helper => !helperEnded(helper))) {
    return
  }

  helpers.forEach(helper => done.add(helper.id))
  saved.set(sessionId, done)

  const started = helpers.map(helper => helper.startedAt).filter((at): at is number => at !== null)

  await rpc('spawn_tree.save', {
    session_id: storedId,
    subagents: helpers.map(savedHelper),
    label: runLabel(helpers),
    started_at: started.length ? Math.min(...started) / 1000 : null,
    finished_at: Date.now() / 1000
  })
}

/** The saved runs of a stored conversation, the newest first. */
export async function loadRuns(storedId: string): Promise<SpawnTreeEntry[]> {
  return (await rpc<SpawnTreeListResult>('spawn_tree.list', { session_id: storedId, limit: 20 })).entries ?? []
}

/** The helpers of one saved run. */
export async function loadRun(path: string): Promise<Helper[]> {
  return ((await rpc<SpawnTreeLoadResult>('spawn_tree.load', { path })).subagents ?? []).map(helperFromSaved)
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
  saved.delete(sessionId)
  $work.setKey(sessionId, undefined as unknown as Work)
}

export function clearWork(): void {
  saved.clear()
  $delegation.set(null)
  $work.set({})
}

onGatewayEvent(event => {
  if (event.session_id) {
    change(event.session_id, work => reduceWork(work, event, Date.now()))
  }
})
