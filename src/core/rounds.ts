/**
 * A round of a group chat while it runs: the host gives the message to one
 * bot at a time. A turn is one bot with the message: it waits, it works, and
 * then it is done. The `group-rooms` plugin of the host reads the turns from
 * the engine; a host with an older plugin gives none.
 */

export type TurnState = 'working' | 'stopping' | 'waiting' | 'done' | 'passed' | 'failed' | 'stopped'

export interface Turn {
  /** The task of the engine for this turn. Empty from a host that does not name it. */
  taskId: string
  /** The name of the profile. */
  member: string
  state: TurnState
  /** Unix milliseconds. 0: it did not start yet. */
  startedAt: number
  /** Unix milliseconds. 0: it did not end yet. */
  endedAt: number
  /** Why the turn failed, in words. Empty when the host gave no reason. */
  why: string
}

/** What the engine waits for from the user. */
export type RoundAction =
  /** The engine does not know how this turn ended. The user can run it again. */
  | { kind: 'retry'; taskId: string; member: string }
  /** A bot wants to do something that needs a yes. `asks` is what, in the words of the host. */
  | { kind: 'approval'; taskId: string; member: string; requestId: string; generation: number; asks: string }

export interface Round {
  turns: Turn[]
  actions: RoundAction[]
  /** Why the engine ended the round before the bots were done. Null: it ended by itself, or it runs. */
  capped: string | null
}

export const NO_ROUND: Round = { turns: [], actions: [], capped: null }

/** The states of the engine, in the words of the phone. A state the phone does not know is a turn that waits. */
const STATES: Record<string, TurnState> = {
  queued: 'waiting',
  deferred: 'waiting',
  running: 'working',
  stopping: 'stopping',
  settled: 'done',
  failed: 'failed',
  indeterminate: 'failed',
  cancelled: 'stopped'
}

/** The reasons of the host for a turn that failed, in words a person reads. */
const REASONS: Record<string, string> = {
  runtime_offline: 'the bot is not running',
  queued_expired: 'it waited too long for its turn',
  delivery_timeout: 'it took too long',
  agent_blocked: 'the bot is busy in another chat',
  provider_auth_or_access: 'its model provider refused the key',
  provider_quota_limit: 'its model provider has no credit left',
  provider_rate_limit: 'its model provider is at its rate limit',
  provider_server_error: 'its model provider had an error',
  context_overflow: 'the thread is too long for its model',
  missing_config: 'a setting of the bot is missing',
  model_unavailable: 'its model is not available',
  target_scope_unresolved: 'the host could not open its profile'
}

/** The limits of the engine for one round, in words. */
const CAPS: Record<string, string> = {
  max_rounds: 'The bots stopped after 3 rounds. Send a message to go on.',
  max_messages: 'The bots stopped after 10 answers. Send a message to go on.'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** The round in the answer of the host for a room. No turn for a host that gives none. */
export function roundOf(answer: unknown): Round {
  const { round, actions, round_end } = (answer ?? {}) as { round?: unknown; actions?: unknown; round_end?: { status?: unknown; reason?: unknown } | null }

  const turns = (Array.isArray(round) ? round : []).flatMap((entry): Turn[] => {
    const { task_id, member, status, started_at, ended_at, passed, reason, error } = (entry ?? {}) as Record<string, unknown>
    const state = STATES[String(status)] ?? 'waiting'

    return typeof member === 'string' && member
      ? [
          {
            taskId: text(task_id),
            member,
            state: state === 'done' && passed === true ? 'passed' : state,
            startedAt: typeof started_at === 'number' ? started_at : 0,
            endedAt: typeof ended_at === 'number' ? ended_at : 0,
            // A reason the phone has no words for: the first line of the error of the host.
            why: state === 'failed' ? (REASONS[text(reason)] ?? text(error).split('\n')[0].trim().slice(0, 120)) : ''
          }
        ]
      : []
  })

  return {
    turns,
    actions: (Array.isArray(actions) ? actions : []).flatMap((entry): RoundAction[] => {
      const { kind, task_id, member, request_id, execution_generation, asks } = (entry ?? {}) as Record<string, unknown>

      if (!text(task_id) || !text(member)) {
        return []
      }

      return kind === 'retry'
        ? [{ kind, taskId: text(task_id), member: text(member) }]
        : kind === 'approval' && text(request_id)
          ? [{ kind, taskId: text(task_id), member: text(member), requestId: text(request_id), generation: typeof execution_generation === 'number' ? execution_generation : 0, asks: text(asks).trim() }]
          : []
    }),
    capped: round_end?.status === 'bounded' ? (CAPS[text(round_end.reason)] ?? 'The bots stopped at the limit of a round. Send a message to go on.') : null
  }
}

const live = (turn: Turn) => turn.state === 'working' || turn.state === 'stopping'

/** "0:07", "12:40": how long a turn runs, or ran. Empty for a turn that did not start. */
export function turnTime(turn: Turn, nowMs: number): string {
  if (!turn.startedAt) {
    return ''
  }

  const seconds = Math.max(0, Math.round(((turn.endedAt || nowMs) - turn.startedAt) / 1000))

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const WORDS: Record<TurnState, string> = {
  working: 'Working',
  stopping: 'Stopping',
  waiting: 'Waiting',
  done: 'Answered',
  passed: 'Had nothing to add',
  failed: 'Did not answer',
  stopped: 'Stopped'
}

/** One turn in words: "Working, 0:42", "Answered in 0:11", "Waiting". */
export function turnWords(turn: Turn, nowMs: number): string {
  const time = turnTime(turn, nowMs)

  return !time || turn.state === 'waiting' || turn.state === 'passed' ? WORDS[turn.state] : turn.state === 'done' ? `Answered in ${time}` : `${WORDS[turn.state]}, ${time}`
}

/**
 * The round in one line: who works now, and how many wait. A bot that waits
 * for a yes of the user comes first: the round stands still until the answer.
 * Between two bots no turn runs for a moment: the line names the bot that is
 * next. Null for a round with no turn to name.
 */
export function roundLine(round: Round, title: (member: string) => string): string | null {
  const asks = round.actions.find(action => action.kind === 'approval')

  if (asks) {
    return `${title(asks.member)} waits for your answer.`
  }

  const now = round.turns.filter(live)
  const waiting = round.turns.filter(turn => turn.state === 'waiting')
  const more = (count: number) => (count ? ` ${count} more ${count > 1 ? 'wait' : 'waits'}.` : '')

  if (now.length) {
    const names = now.map(turn => title(turn.member))
    const stopping = now.every(turn => turn.state === 'stopping')

    return `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} ${stopping ? 'stopping' : 'working'}.${more(waiting.length)}`
  }

  return waiting.length ? `${title(waiting[0].member)} is next.${more(waiting.length - 1)}` : null
}

/** What stays to say after a round: the bots that did not answer, and a round the engine cut. Null: nothing. */
export function afterRound(round: Round, title: (member: string) => string): string | null {
  const failed = [...new Set(round.turns.filter(turn => turn.state === 'failed').map(turn => title(turn.member)))]
  const said = failed.length ? `${failed.join(' and ')} did not answer.` : ''

  return [said, round.capped ?? ''].filter(Boolean).join(' ') || null
}
