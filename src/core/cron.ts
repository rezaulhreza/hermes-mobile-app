/**
 * Schedules: work the agent does at a time, with nobody there (cron jobs of
 * the Hermes host). On the phone a schedule is one row: what, when next, and
 * how the last run went. This file has the rules with no network in them.
 */

export interface Schedule {
  id: string
  name: string
  prompt: string
  /** The schedule as the host says it: "every 5m", "0 9 * * *", "once at ...". */
  when: string
  state: 'scheduled' | 'paused' | 'completed' | 'other'
  /** Unix milliseconds. Null when no run is planned. */
  nextRunAt: number | null
  lastRunAt: number | null
  /** The last run failed. */
  failed: boolean
  lastError: string
  /** Where the result goes: "local", "telegram", ... */
  deliver: string
  /** The bot (profile) that owns it. */
  profile: string
  /** A script runs, with no agent. */
  scriptOnly: boolean
}

interface WireJob {
  id?: unknown
  name?: unknown
  prompt?: unknown
  schedule_display?: unknown
  schedule?: { display?: unknown } | string | null
  state?: unknown
  enabled?: unknown
  next_run_at?: unknown
  last_run_at?: unknown
  last_status?: unknown
  last_error?: unknown
  failure_streak?: unknown
  deliver?: unknown
  profile?: unknown
  no_agent?: unknown
}

function time(value: unknown): number | null {
  const at = typeof value === 'string' && value ? Date.parse(value) : NaN

  return Number.isFinite(at) ? at : null
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

export function scheduleRows(jobs: unknown): Schedule[] {
  if (!Array.isArray(jobs)) {
    return []
  }

  return (jobs as WireJob[])
    .filter(job => job && typeof job.id === 'string')
    .map(job => {
      const state = text(job.state)
      const paused = state === 'paused' || job.enabled === false
      const prompt = text(job.prompt).trim()

      return {
        id: job.id as string,
        name: text(job.name).trim() || prompt.split('\n')[0].slice(0, 60) || 'A schedule',
        prompt,
        when: text(job.schedule_display) || (typeof job.schedule === 'string' ? job.schedule : text(job.schedule?.display)),
        state: state === 'completed' ? 'completed' : paused ? 'paused' : state === 'scheduled' ? 'scheduled' : 'other',
        nextRunAt: state === 'completed' || paused ? null : time(job.next_run_at),
        lastRunAt: time(job.last_run_at),
        failed: (typeof job.failure_streak === 'number' && job.failure_streak > 0) || (text(job.last_status) !== '' && text(job.last_status) !== 'ok'),
        lastError: text(job.last_error),
        deliver: text(job.deliver) || 'local',
        profile: text(job.profile) || 'default',
        scriptOnly: job.no_agent === true
      } satisfies Schedule
    })
    .sort((a, b) => rank(a) - rank(b) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name))
}

/** A failing schedule first, then the ones that will run, then paused, then finished. */
function rank(schedule: Schedule): number {
  return schedule.failed && schedule.state !== 'completed' ? 0 : schedule.state === 'scheduled' || schedule.state === 'other' ? 1 : schedule.state === 'paused' ? 2 : 3
}

/** "in 5 min", "in 3 h", "in 2 days", or "now" for a run that is due. */
export function untilWords(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60_000)

  if (minutes <= 0) {
    return 'now'
  }

  if (minutes < 60) {
    return `in ${minutes} min`
  }

  const hours = Math.round(minutes / 60)

  return hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`
}

/** The line under the name of a schedule. */
export function scheduleLine(schedule: Schedule, now: number): string {
  const state =
    schedule.state === 'paused' ? 'Paused' : schedule.state === 'completed' ? 'Finished' : schedule.nextRunAt ? `Next ${untilWords(schedule.nextRunAt, now)}` : 'Waiting'

  return [schedule.when, state, schedule.failed ? 'the last run failed' : ''].filter(Boolean).join(' · ')
}

/** Schedules a person asks for most, as the text the host takes. */
export const SCHEDULE_CHOICES: readonly { label: string; value: string }[] = [
  { label: 'Every 30 minutes', value: 'every 30m' },
  { label: 'Every hour', value: 'every 1h' },
  { label: 'Every day at 9:00', value: '0 9 * * *' },
  { label: 'Weekdays at 9:00', value: '0 9 * * 1-5' },
  { label: 'Every Monday at 9:00', value: '0 9 * * 1' }
]

const INTERVAL = /^every\s+\d+\s*(m|min|minutes?|h|hours?|d|days?)$/i
const CRON_FIELD = /^[\d*/,\-A-Za-z]+$/

/**
 * Why a new schedule cannot be saved, or null. The host checks the schedule
 * text itself; this catches an empty form and a text that is clearly not a
 * schedule, before a round trip.
 */
export function scheduleProblem(prompt: string, when: string): string | null {
  if (!prompt.trim()) {
    return 'Write what the agent must do.'
  }

  const schedule = when.trim()

  if (!schedule) {
    return 'Choose when it runs.'
  }

  const fields = schedule.split(/\s+/)
  const cron = fields.length === 5 && fields.every(field => CRON_FIELD.test(field))

  return INTERVAL.test(schedule) || cron || /^(once\s+)?(at|in)\s+\S+/i.test(schedule) || /^\d{4}-\d{2}-\d{2}/.test(schedule)
    ? null
    : 'Write the time as “every 2h”, as five cron fields (“0 9 * * *”), or as a date and a time.'
}

export interface ScheduleRun {
  id: string
  title: string
  /** Unix milliseconds. */
  at: number
}

export function scheduleRuns(result: unknown): ScheduleRun[] {
  const runs = (result as { runs?: unknown } | null)?.runs

  return Array.isArray(runs)
    ? runs.flatMap((run: { id?: unknown; title?: unknown; preview?: unknown; started_at?: unknown }) =>
        typeof run?.id === 'string'
          ? [{ id: run.id, title: (text(run.title) || text(run.preview)).replace(/[#*]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200), at: typeof run.started_at === 'number' ? run.started_at * 1000 : 0 }]
          : []
      )
    : []
}
