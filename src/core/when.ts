/**
 * When a schedule runs, as the choices of a person: once at a time, every
 * day, on days of the week, every few hours or minutes. The host takes a
 * text for it ("0 9 * * 1-5", "every 2h", a date and a time), and the phone
 * writes that text from the choices, so nobody has to know its forms.
 *
 * A text the choices cannot make (a cron form with a month, a list of
 * hours) is `custom`: it is kept as it is and the person can still edit it
 * as text. Nothing a schedule has is lost by opening it.
 *
 * The forms are the forms `parse_schedule` of the host reads (`cron/jobs.py`).
 */

export type When =
  /** One run, at a day and a time on the clock of the phone. */
  | { kind: 'once'; at: Date }
  | { kind: 'daily'; hour: number; minute: number }
  /** `days`: 0 is Sunday, 6 is Saturday. In the order of the week, each one once. */
  | { kind: 'weekly'; days: number[]; hour: number; minute: number }
  | { kind: 'hours'; every: number }
  | { kind: 'minutes'; every: number }
  | { kind: 'custom'; text: string }

export type WhenKind = When['kind']

export const WEEKDAYS = [1, 2, 3, 4, 5]
const pair = (value: number) => String(value).padStart(2, '0')
const whole = (field: string) => /^\d+$/.test(field)

/** The days of a cron field: "1-5", "1,3", "0", "7" (Sunday again). Null for a form with steps or names. */
function cronDays(field: string): number[] | null {
  const days = new Set<number>()

  for (const part of field.split(',')) {
    const range = /^([0-7])(?:-([0-7]))?$/.exec(part)

    if (!range) {
      return null
    }

    const from = Number(range[1])
    const to = Number(range[2] ?? range[1])

    if (to < from) {
      return null
    }

    for (let day = from; day <= to; day += 1) {
      days.add(day % 7)
    }
  }

  return [...days].sort((a, b) => a - b)
}

/** A date and a time as the host wrote it or takes it: "2026-10-07 20:00", "2026-10-07T20:00:00+01:00". The time is the time as written. */
function stamp(text: string): Date | null {
  const found = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(text.trim())

  if (!found) {
    return null
  }

  const at = new Date(Number(found[1]), Number(found[2]) - 1, Number(found[3]), Number(found[4] ?? 9), Number(found[5] ?? 0))

  return Number.isNaN(at.getTime()) || at.getMonth() !== Number(found[2]) - 1 ? null : at
}

/** The choices that a text of the host stands for. A text they cannot make is `custom`. */
export function parseWhen(text: string): When {
  const words = text.trim()
  const once = stamp(words.replace(/^once\s+(?:at|on)\s+/i, ''))

  if (once) {
    return { kind: 'once', at: once }
  }

  const every = /^(?:every )?(\d+) ?(m|min|minutes?|h|hours?|d|days?)$/i.exec(words)

  if (every && Number(every[1]) > 0) {
    const unit = every[2][0].toLowerCase()
    const minutes = Number(every[1]) * (unit === 'd' ? 1440 : unit === 'h' ? 60 : 1)

    return minutes % 60 === 0 ? { kind: 'hours', every: minutes / 60 } : { kind: 'minutes', every: minutes }
  }

  const fields = words.split(/\s+/)

  if (fields.length === 5) {
    const [minute, hour, dayOfMonth, month, weekday] = fields
    const stepMinutes = /^\*\/(\d+)$/.exec(minute)?.[1]
    const stepHours = /^\*\/(\d+)$/.exec(hour)?.[1]
    const rest = dayOfMonth === '*' && month === '*'

    if (stepMinutes && hour === '*' && rest && weekday === '*' && Number(stepMinutes) > 0) {
      return { kind: 'minutes', every: Number(stepMinutes) }
    }

    if (minute === '0' && stepHours && rest && weekday === '*' && Number(stepHours) > 0) {
      return { kind: 'hours', every: Number(stepHours) }
    }

    if (whole(minute) && whole(hour) && Number(hour) < 24 && Number(minute) < 60 && rest) {
      const days = weekday === '*' ? null : cronDays(weekday)
      const time = { hour: Number(hour), minute: Number(minute) }

      if (weekday === '*' || days?.length === 7) {
        return { kind: 'daily', ...time }
      }

      if (days?.length) {
        return { kind: 'weekly', days, ...time }
      }
    }
  }

  return { kind: 'custom', text: words }
}

/** The text the host takes for these choices. */
export function whenText(when: When): string {
  switch (when.kind) {
    case 'once':
      // No zone: the host reads a time with no zone on its own clock, which is the clock of the person.
      return `${when.at.getFullYear()}-${pair(when.at.getMonth() + 1)}-${pair(when.at.getDate())}T${pair(when.at.getHours())}:${pair(when.at.getMinutes())}`

    case 'daily':
      return `${when.minute} ${when.hour} * * *`

    case 'weekly': {
      const days = [...new Set(when.days)].sort((a, b) => a - b)

      return `${when.minute} ${when.hour} * * ${days.join(',') === WEEKDAYS.join(',') ? '1-5' : days.join(',')}`
    }

    case 'hours':
      return `every ${when.every}h`

    case 'minutes':
      return `every ${when.every}m`

    case 'custom':
      return when.text.trim()
  }
}

/** What is wrong with the choices, in words for the person. Null when the schedule can be saved. */
export function whenProblem(when: When, now: Date): string | null {
  switch (when.kind) {
    case 'once':
      return when.at.getTime() <= now.getTime() ? 'Choose a time that is still to come.' : null

    case 'weekly':
      return when.days.length ? null : 'Choose at least one day.'

    case 'custom':
      return when.text.trim() ? null : 'Write when it runs.'

    default:
      return null
  }
}

/**
 * The same schedule as another kind, with what carries over: the time of
 * day stays when the person goes from "every day" to "chosen days", and a
 * single run starts at the next whole hour, not in the past.
 */
export function asKind(when: When, kind: WhenKind, now: Date): When {
  if (when.kind === kind) {
    return when
  }

  const time = when.kind === 'daily' || when.kind === 'weekly' ? { hour: when.hour, minute: when.minute } : when.kind === 'once' ? { hour: when.at.getHours(), minute: when.at.getMinutes() } : { hour: 9, minute: 0 }

  switch (kind) {
    case 'once': {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0)

      return { kind, at }
    }

    case 'daily':
      return { kind, ...time }

    case 'weekly':
      return { kind, days: WEEKDAYS, ...time }

    case 'hours':
      return { kind, every: 2 }

    case 'minutes':
      return { kind, every: 30 }

    case 'custom':
      return { kind, text: whenText(when) }
  }
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** The days of a weekly schedule in words: "Weekdays", "Every day", "Monday", "Mon, Wed, Fri". */
export function daysWords(days: readonly number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b)

  if (!sorted.length) {
    return 'No day'
  }

  if (sorted.length === 7) {
    return 'Every day'
  }

  if (sorted.join(',') === WEEKDAYS.join(',')) {
    return 'Weekdays'
  }

  if (sorted.join(',') === '0,6') {
    return 'Weekends'
  }

  // The week starts on Monday for a person here: Sunday is said last.
  const inWeek = [...sorted.filter(day => day > 0), ...sorted.filter(day => day === 0)]

  return inWeek.length === 1 ? DAY_NAMES[inWeek[0]] : inWeek.map(day => DAY_NAMES[day].slice(0, 3)).join(', ')
}

/** The days of the week in the order a person here reads them, Monday first, with their names. */
export const WEEK: readonly { day: number; name: string }[] = [1, 2, 3, 4, 5, 6, 0].map(day => ({ day, name: DAY_NAMES[day] }))
