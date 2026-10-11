/**
 * The work of a turn that is not text: the agent's todo list and the helpers
 * (subagents) it started. Both arrive as gateway events. This file turns them
 * into what a phone shows: how far the plan is, and who works on what.
 */

import type { GatewayEvent } from './gateway/gateway-events'
import type { SubagentEventPayload, SubagentSnapshot, SubagentStatus } from './gateway/gateway-contract.generated'

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

export interface Todo {
  id: string
  content: string
  status: TodoStatus
}

export interface Helper {
  id: string
  goal: string
  status: SubagentStatus
  /** The helper of a helper has a parent. */
  parentId: string | null
  depth: number
  model: string
  toolCount: number
  /** What it does now: its last tool, or its last thought. */
  activity: string
  /** What it reported when it ended. */
  summary: string
  startedAt: number | null
  durationS: number | null
  /** It takes a message now. False for a helper that is past its last action. */
  acceptsSteer: boolean
}

export interface Work {
  todos: readonly Todo[]
  /** The todo list is a full snapshot with a revision. An older snapshot never replaces a newer one. */
  revision: number
  helpers: readonly Helper[]
}

export const NO_WORK: Work = { todos: [], revision: 0, helpers: [] }

const TODO_STATUSES: ReadonlySet<string> = new Set(['pending', 'in_progress', 'completed', 'cancelled'])
const ENDED: ReadonlySet<string> = new Set(['completed', 'failed', 'error', 'timeout', 'interrupted'])

export function helperEnded(helper: Pick<Helper, 'status'>): boolean {
  return ENDED.has(helper.status)
}

function parseTodos(raw: unknown): Todo[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.flatMap((item, index) => {
    if (!item || typeof item !== 'object') {
      return []
    }

    const todo = item as Record<string, unknown>
    const content = typeof todo.content === 'string' ? todo.content.trim() : ''

    return content
      ? [{ id: String(todo.id ?? index), content, status: TODO_STATUSES.has(String(todo.status)) ? (todo.status as TodoStatus) : 'pending' }]
      : []
  })
}

/** A todo snapshot, when it is newer than what is known. */
export function withTodos(work: Work, todos: unknown, revision: unknown): Work {
  const next = typeof revision === 'number' ? revision : work.revision

  if (!Array.isArray(todos) || next < work.revision) {
    return work
  }

  return { ...work, todos: parseTodos(todos), revision: next }
}

function helperFromEvent(known: Helper | undefined, id: string, payload: SubagentEventPayload): Helper {
  return {
    id,
    goal: payload.goal || known?.goal || 'A helper',
    status: payload.status ?? known?.status ?? 'running',
    parentId: payload.parent_id ?? known?.parentId ?? null,
    depth: payload.depth ?? known?.depth ?? 0,
    model: payload.model ?? known?.model ?? '',
    toolCount: payload.tool_count ?? known?.toolCount ?? 0,
    activity: known?.activity ?? '',
    summary: payload.summary ?? known?.summary ?? '',
    startedAt: known?.startedAt ?? null,
    durationS: payload.duration_seconds ?? known?.durationS ?? null,
    acceptsSteer: known?.acceptsSteer ?? true
  }
}

/** An older emitter sends no id. The place in the task list then names the helper. */
function helperId(payload: SubagentEventPayload): string {
  return payload.subagent_id || `task-${payload.task_index ?? 0}`
}

function putHelper(work: Work, helper: Helper): Work {
  const at = work.helpers.findIndex(known => known.id === helper.id)

  return { ...work, helpers: at < 0 ? [...work.helpers, helper] : work.helpers.map((known, index) => (index === at ? helper : known)) }
}

/** One gateway event later. Events that are not about work give the same object back. */
export function reduceWork(work: Work, event: GatewayEvent, now: number): Work {
  const payload = (event.payload ?? {}) as Record<string, unknown>

  switch (event.type) {
    case 'todo.updated':
    case 'tool.complete':
      return withTodos(work, payload.todos, payload.revision)

    case 'subagent.spawn_requested':
    case 'subagent.start':
    case 'subagent.progress':
    case 'subagent.thinking':
    case 'subagent.tool':
    case 'subagent.complete': {
      const sub = payload as unknown as SubagentEventPayload
      const id = helperId(sub)
      const known = work.helpers.find(helper => helper.id === id)
      const helper = helperFromEvent(known, id, sub)

      if (event.type === 'subagent.spawn_requested') {
        return putHelper(work, { ...helper, status: known?.status ?? 'queued' })
      }

      if (event.type === 'subagent.start') {
        return putHelper(work, { ...helper, status: 'running', startedAt: known?.startedAt ?? now })
      }

      if (event.type === 'subagent.complete') {
        // A helper that ended with no status named ended well.
        return putHelper(work, { ...helper, status: sub.status && ENDED.has(sub.status) ? sub.status : 'completed', activity: '', acceptsSteer: false })
      }

      const activity = event.type === 'subagent.tool' ? [sub.tool_name, sub.tool_preview].filter(Boolean).join(': ') : (sub.text ?? '').trim()

      return putHelper(work, { ...helper, activity: activity || helper.activity })
    }

    default:
      return work
  }
}

/** The helpers the host knows now (`subagent.list`), joined with what the events said. A helper the host no longer has keeps its last state. */
export function withSnapshots(work: Work, snapshots: readonly SubagentSnapshot[]): Work {
  return snapshots.reduce((next, snapshot) => {
    const known = next.helpers.find(helper => helper.id === snapshot.subagent_id)

    return putHelper(next, {
      id: snapshot.subagent_id,
      goal: snapshot.goal || known?.goal || 'A helper',
      status: snapshot.status ?? known?.status ?? 'running',
      parentId: snapshot.parent_id ?? known?.parentId ?? null,
      depth: snapshot.depth ?? known?.depth ?? 0,
      model: snapshot.model ?? known?.model ?? '',
      toolCount: snapshot.tool_count ?? known?.toolCount ?? 0,
      activity: known?.activity || snapshot.last_tool || '',
      summary: known?.summary ?? '',
      startedAt: snapshot.started_at ? snapshot.started_at * 1000 : (known?.startedAt ?? null),
      durationS: known?.durationS ?? null,
      acceptsSteer: snapshot.accepting_steer ?? known?.acceptsSteer ?? true
    })
  }, work)
}

/** The line above the message field: where the plan is and who works. Null when there is nothing to say. */
export function workSummary(work: Work): string | null {
  const live = work.todos.filter(todo => todo.status !== 'cancelled')
  const done = live.filter(todo => todo.status === 'completed').length
  const running = work.helpers.filter(helper => !helperEnded(helper)).length
  const parts: string[] = []

  if (live.length) {
    parts.push(`${done} of ${live.length} done`)
  }

  if (running) {
    parts.push(`${running} ${running === 1 ? 'helper' : 'helpers'} at work`)
  } else if (work.helpers.length) {
    parts.push(`${work.helpers.length} ${work.helpers.length === 1 ? 'helper' : 'helpers'} finished`)
  }

  return parts.length ? parts.join(' · ') : null
}

/** The step the agent is on: the one in progress, else the next one that waits. */
export function currentTodo(work: Work): Todo | null {
  return work.todos.find(todo => todo.status === 'in_progress') ?? work.todos.find(todo => todo.status === 'pending') ?? null
}

const STATUS_WORDS: Readonly<Record<SubagentStatus, string>> = {
  queued: 'Waiting',
  running: 'Working',
  completed: 'Done',
  failed: 'Failed',
  error: 'Failed',
  timeout: 'Ran out of time',
  interrupted: 'Stopped'
}

export function helperStatusWord(status: SubagentStatus): string {
  return STATUS_WORDS[status] ?? status
}
