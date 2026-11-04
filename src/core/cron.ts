/**
 * Schedules: work the agent does at a time, with nobody there (cron jobs of
 * the Hermes host). On the phone a schedule is one row: what, when next, and
 * how the last run went. This file has the rules with no network in them.
 */

import { clockWords, readableDates } from './format'

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
  /** The Hermes folder of the bot on the host. The text of a run is a file under it. */
  home: string
  /** A run is in flight now: Stop can reach it. */
  running: boolean
  /** The newest run was stopped, and why ("" when no reason was given). Null when it was not stopped. */
  cancelled: string | null
  /** Runs missed while Hermes was off: true runs one when back, false skips them, null follows the default of the host. */
  catchUp: boolean | null
}

/** The missed-run choice of a schedule. `default` stores nothing: the job follows the setting of the host. */
export type CatchUpChoice = 'default' | 'run' | 'skip'

export const CATCH_UP_CHOICES: readonly { id: CatchUpChoice; label: string }[] = [
  { id: 'default', label: 'Use the default' },
  { id: 'run', label: 'Run once when back' },
  { id: 'skip', label: 'Skip them' }
]

export const catchUpChoice = (value: boolean | null): CatchUpChoice => (value === true ? 'run' : value === false ? 'skip' : 'default')

export const catchUpValue = (choice: CatchUpChoice): boolean | null => (choice === 'run' ? true : choice === 'skip' ? false : null)

/** What a Stop did, in words. The host answers `cancelled: false` when the run ended first. */
export const stopWords = (result: unknown): string => ((result as { cancelled?: unknown } | null)?.cancelled === true ? 'The run stopped.' : 'Nothing was running. The run ended first.')

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
  hermes_home?: unknown
  catch_up?: unknown
  latest_execution?: { status?: unknown; error?: unknown } | null
  live_execution?: unknown
}

// A claimed or running attempt is the run that Stop can reach.
const IN_FLIGHT = new Set(['claimed', 'running'])

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
        scriptOnly: job.no_agent === true,
        home: text(job.hermes_home),
        running: IN_FLIGHT.has(text(job.latest_execution?.status)) || Boolean(job.live_execution),
        cancelled: text(job.latest_execution?.status) === 'cancelled' ? text(job.latest_execution?.error).trim() : null,
        catchUp: typeof job.catch_up === 'boolean' ? job.catch_up : null
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const many = (count: number, one: string) => (count === 1 ? `Every ${one}` : `Every ${count} ${one}s`)

/**
 * When a schedule runs, in the words of a person. The host gives the text it
 * takes: "every 360m", "0 10 * * *", "once at 2026-10-07 20:00". A form this
 * function does not know stays as the host wrote it, with its dates made
 * readable: a wrong guess about a schedule is worse than its raw text.
 */
export function whenWords(when: string, now = new Date()): string {
  const text = when.trim()
  const once = /^once (?:at|on) (.+)$/i.exec(text)

  if (once) {
    return `Once, ${readableDates(once[1], now)}`
  }

  // A date and a time with nothing before it is one run too: the form the phone writes.
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(text)) {
    return `Once, ${readableDates(text, now)}`
  }

  const every = /^every (\d+) ?(m|min|minutes?|h|hours?|d|days?)$/i.exec(text)

  if (every) {
    const unit = every[2][0].toLowerCase()
    const minutes = Number(every[1]) * (unit === 'd' ? 1440 : unit === 'h' ? 60 : 1)

    return minutes % 1440 === 0 ? many(minutes / 1440, 'day') : minutes % 60 === 0 ? many(minutes / 60, 'hour') : many(minutes, 'minute')
  }

  const fields = text.split(/\s+/)

  if (fields.length !== 5) {
    return readableDates(text, now)
  }

  const [minute, hour, dayOfMonth, month, weekday] = fields
  const step = (field: string) => /^\*\/(\d+)$/.exec(field)?.[1]
  const whole = (field: string) => /^\d+$/.test(field)

  if (step(minute) && [hour, dayOfMonth, month, weekday].every(field => field === '*')) {
    return many(Number(step(minute)), 'minute')
  }

  if (whole(minute) && step(hour) && [dayOfMonth, month, weekday].every(field => field === '*')) {
    return many(Number(step(hour)), 'hour')
  }

  if (!whole(minute) || !whole(hour) || Number(hour) > 23 || Number(minute) > 59 || month !== '*') {
    return text
  }

  const at = `at ${clockWords(new Date(2000, 0, 1, Number(hour), Number(minute)))}`

  if (dayOfMonth === '*' && weekday === '*') {
    return `Every day ${at}`
  }

  if (dayOfMonth === '*' && weekday === '1-5') {
    return `Weekdays ${at}`
  }

  if (dayOfMonth === '*' && /^[0-7](,[0-7])*$/.test(weekday)) {
    const days = weekday.split(',').map(day => WEEKDAYS[Number(day)])

    return days.length === 1 ? `Every ${days[0]} ${at}` : `${days.map(day => day.slice(0, 3)).join(', ')} ${at}`
  }

  return whole(dayOfMonth) && weekday === '*' ? `Day ${Number(dayOfMonth)} of every month ${at}` : text
}

/** The line under the name of a schedule. */
export function scheduleLine(schedule: Schedule, now: number): string {
  const state = schedule.running
    ? 'Running now'
    : schedule.state === 'paused'
      ? 'Paused'
      : schedule.state === 'completed'
        ? 'Finished'
        : schedule.nextRunAt
          ? `Next ${untilWords(schedule.nextRunAt, now)}`
          : 'Waiting'
  const last = schedule.running ? '' : schedule.cancelled !== null ? 'the last run was stopped' : schedule.failed ? 'the last run failed' : ''

  return [whenWords(schedule.when, new Date(now)), state, last].filter(Boolean).join(' · ')
}

const RUN_FILE_PREFIX = 'cron_output:'

/**
 * The file on the host with the whole text of a run that has no conversation
 * (a script, or a run older than its session). The id of such a run is
 * `cron_output:<job>:<stamp>` and its file is `<stamp>.md` in the job's output
 * folder. Null for a run with a conversation.
 */
export function runFilePath(schedule: Pick<Schedule, 'id' | 'home'>, run: Pick<ScheduleRun, 'id'>): string | null {
  if (!run.id.startsWith(RUN_FILE_PREFIX) || !schedule.home) {
    return null
  }

  const stamp = run.id.slice(RUN_FILE_PREFIX.length).split(':').pop() ?? ''
  const slash = schedule.home.includes('\\') && !schedule.home.includes('/') ? '\\' : '/'

  return stamp ? [schedule.home.replace(/[\\/]+$/, ''), 'cron', 'output', schedule.id, `${stamp}.md`].join(slash) : null
}

/** A place a result can go, as `GET /api/cron/delivery-targets` lists it. */
export interface DeliveryTarget {
  id: string
  name: string
}

/**
 * The words for a place a result goes. The host names the chat of a bot by
 * the key of its profile ("Bot Chat (default)"); a person knows the bot by
 * its own name.
 */
export function deliveryLabel(id: string, targets: readonly DeliveryTarget[], botTitles: ReadonlyMap<string, string>): string {
  if (!id || id === 'local') {
    return 'Only save it on the host'
  }

  if (id === 'origin') {
    return 'Where the schedule was made'
  }

  if (id.startsWith('bot-chat:')) {
    const profile = id.slice('bot-chat:'.length)

    return `The chat of ${botTitles.get(profile) ?? profile}`
  }

  return targets.find(target => target.id === id)?.name ?? id.charAt(0).toUpperCase() + id.slice(1)
}

/** One field of a template of the host: what to ask the user. */
export interface BlueprintField {
  name: string
  type: string
  label: string
  default?: unknown
  options?: unknown[]
  optional?: boolean
  help?: string
}

export interface Blueprint {
  key: string
  title: string
  description: string
  fields: BlueprintField[]
}

export function blueprintRows(result: unknown): Blueprint[] {
  const list = (result as { blueprints?: unknown } | null)?.blueprints

  return Array.isArray(list)
    ? list.flatMap((item: Partial<Blueprint>) =>
        typeof item?.key === 'string' && typeof item.title === 'string'
          ? [{ key: item.key, title: item.title, description: text(item.description), fields: Array.isArray(item.fields) ? item.fields.filter(field => typeof field?.name === 'string') : [] }]
          : []
      )
    : []
}

/** The values a template starts with: the default of each field, as text. */
export function blueprintDefaults(blueprint: Blueprint): Record<string, string> {
  return Object.fromEntries(blueprint.fields.map(field => [field.name, field.default === undefined || field.default === null ? '' : String(field.default)]))
}

/** The first field the user must still fill, or null. */
export function blueprintMissing(blueprint: Blueprint, values: Readonly<Record<string, string>>): BlueprintField | null {
  return blueprint.fields.find(field => !field.optional && !(values[field.name] ?? '').trim()) ?? null
}

export interface ScheduleRun {
  id: string
  title: string
  /** The run has a conversation of its own, which a chat screen can open. False: its text is a file on the host. */
  hasChat: boolean
  /** Unix milliseconds. */
  at: number
}

export function scheduleRuns(result: unknown): ScheduleRun[] {
  const runs = (result as { runs?: unknown } | null)?.runs

  return Array.isArray(runs)
    ? runs.flatMap((run: { id?: unknown; title?: unknown; preview?: unknown; started_at?: unknown }) =>
        typeof run?.id === 'string'
          ? [{ id: run.id, hasChat: !run.id.startsWith(RUN_FILE_PREFIX), title: readableDates((text(run.title) || text(run.preview)).replace(/[#*]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)), at: typeof run.started_at === 'number' ? run.started_at * 1000 : 0 }]
          : []
      )
    : []
}
