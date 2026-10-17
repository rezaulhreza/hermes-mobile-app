/**
 * A round of a group chat while it runs: the host gives the message to one
 * bot at a time. A turn is one bot with the message: it waits, it works, and
 * then it is done. The `group-rooms` plugin of the host reads the turns from
 * the engine; a host with an older plugin gives none.
 */

export type TurnState = 'working' | 'stopping' | 'waiting' | 'done' | 'failed' | 'stopped'

export interface Turn {
  /** The name of the profile. */
  member: string
  state: TurnState
  /** Unix milliseconds. 0: it did not start yet. */
  startedAt: number
  /** Unix milliseconds. 0: it did not end yet. */
  endedAt: number
}

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

/** The turns in the answer of the host for a room. Empty for a host that gives none. */
export function roundTurns(answer: unknown): Turn[] {
  const round = (answer as { round?: unknown } | null)?.round

  return (Array.isArray(round) ? round : []).flatMap((entry): Turn[] => {
    const { member, status, started_at, ended_at } = (entry ?? {}) as { member?: unknown; status?: unknown; started_at?: unknown; ended_at?: unknown }

    return typeof member === 'string' && member
      ? [{ member, state: STATES[String(status)] ?? 'waiting', startedAt: typeof started_at === 'number' ? started_at : 0, endedAt: typeof ended_at === 'number' ? ended_at : 0 }]
      : []
  })
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

const WORDS: Record<TurnState, string> = { working: 'Working', stopping: 'Stopping', waiting: 'Waiting', done: 'Answered', failed: 'Did not answer', stopped: 'Stopped' }

/** One turn in words: "Working, 0:42", "Answered in 0:11", "Waiting". */
export function turnWords(turn: Turn, nowMs: number): string {
  const time = turnTime(turn, nowMs)

  return !time || turn.state === 'waiting' ? WORDS[turn.state] : turn.state === 'done' ? `Answered in ${time}` : `${WORDS[turn.state]}, ${time}`
}

/**
 * The round in one line: who works now, and how many wait. Between two bots
 * no turn runs for a moment: the line names the bot that is next. Null for a
 * round with no turn to name.
 */
export function roundLine(turns: readonly Turn[], title: (member: string) => string): string | null {
  const now = turns.filter(live)
  const waiting = turns.filter(turn => turn.state === 'waiting')
  const more = (count: number) => (count ? ` ${count} more ${count > 1 ? 'wait' : 'waits'}.` : '')

  if (now.length) {
    const names = now.map(turn => title(turn.member))
    const stopping = now.every(turn => turn.state === 'stopping')

    return `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} ${stopping ? 'stopping' : 'working'}.${more(waiting.length)}`
  }

  return waiting.length ? `${title(waiting[0].member)} is next.${more(waiting.length - 1)}` : null
}
