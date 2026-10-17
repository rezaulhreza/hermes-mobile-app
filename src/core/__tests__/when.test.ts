import { asKind, daysWords, parseWhen, whenProblem, whenText } from '../when'

const now = new Date(2026, 9, 11, 18, 40)

describe('when a schedule runs, as the choices of a person', () => {
  it('reads the texts the host gives back', () => {
    expect(parseWhen('every 30m')).toEqual({ kind: 'minutes', every: 30 })
    expect(parseWhen('every 360m')).toEqual({ kind: 'hours', every: 6 })
    expect(parseWhen('every 2h')).toEqual({ kind: 'hours', every: 2 })
    expect(parseWhen('every 1d')).toEqual({ kind: 'hours', every: 24 })
    expect(parseWhen('0 10 * * *')).toEqual({ kind: 'daily', hour: 10, minute: 0 })
    expect(parseWhen('30 7 * * 1-5')).toEqual({ kind: 'weekly', days: [1, 2, 3, 4, 5], hour: 7, minute: 30 })
    expect(parseWhen('0 9 * * 1,3,7')).toEqual({ kind: 'weekly', days: [0, 1, 3], hour: 9, minute: 0 })
    expect(parseWhen('0 9 * * 0-6')).toEqual({ kind: 'daily', hour: 9, minute: 0 })
    expect(parseWhen('*/15 * * * *')).toEqual({ kind: 'minutes', every: 15 })
    expect(parseWhen('0 */4 * * *')).toEqual({ kind: 'hours', every: 4 })
    expect(parseWhen('once at 2026-10-12 09:30')).toEqual({ kind: 'once', at: new Date(2026, 9, 12, 9, 30) })
    expect(parseWhen('2026-10-12T09:30:00+01:00')).toEqual({ kind: 'once', at: new Date(2026, 9, 12, 9, 30) })
  })

  it('keeps a text the choices cannot make', () => {
    for (const text of ['0 9 1 * *', '0 9 * 6 *', '5,35 9-17 * * *', '0 9 * * mon', 'every monday 9am', '0 9 * * 5-1', '2026-13-40 09:00']) {
      expect(parseWhen(text)).toEqual({ kind: 'custom', text })
    }
  })

  it('writes the text the host takes, and reads its own text back', () => {
    expect(whenText({ kind: 'once', at: new Date(2026, 9, 12, 9, 5) })).toBe('2026-10-12T09:05')
    expect(whenText({ kind: 'daily', hour: 20, minute: 0 })).toBe('0 20 * * *')
    expect(whenText({ kind: 'weekly', days: [5, 1, 3, 2, 4], hour: 9, minute: 15 })).toBe('15 9 * * 1-5')
    expect(whenText({ kind: 'weekly', days: [6, 0], hour: 9, minute: 0 })).toBe('0 9 * * 0,6')
    expect(whenText({ kind: 'hours', every: 6 })).toBe('every 6h')
    expect(whenText({ kind: 'minutes', every: 45 })).toBe('every 45m')
    expect(whenText({ kind: 'custom', text: ' 0 9 1 * * ' })).toBe('0 9 1 * *')

    for (const text of ['2026-10-12T09:05', '0 20 * * *', '15 9 * * 1-5', '0 9 * * 0,6', 'every 6h', 'every 45m']) {
      expect(whenText(parseWhen(text))).toBe(text)
    }
  })

  it('says what is wrong in words', () => {
    expect(whenProblem({ kind: 'once', at: new Date(2026, 9, 11, 18, 0) }, now)).toBe('Choose a time that is still to come.')
    expect(whenProblem({ kind: 'once', at: new Date(2026, 9, 11, 19, 0) }, now)).toBeNull()
    expect(whenProblem({ kind: 'weekly', days: [], hour: 9, minute: 0 }, now)).toBe('Choose at least one day.')
    expect(whenProblem({ kind: 'custom', text: ' ' }, now)).toBe('Write when it runs.')
    expect(whenProblem({ kind: 'daily', hour: 9, minute: 0 }, now)).toBeNull()
  })

  it('carries the time of day over to another kind', () => {
    expect(asKind({ kind: 'daily', hour: 20, minute: 30 }, 'weekly', now)).toEqual({ kind: 'weekly', days: [1, 2, 3, 4, 5], hour: 20, minute: 30 })
    expect(asKind({ kind: 'hours', every: 2 }, 'daily', now)).toEqual({ kind: 'daily', hour: 9, minute: 0 })
    // A single run starts at the next whole hour: never in the past.
    expect(asKind({ kind: 'daily', hour: 8, minute: 0 }, 'once', now)).toEqual({ kind: 'once', at: new Date(2026, 9, 11, 19, 0) })
    expect(asKind({ kind: 'weekly', days: [1], hour: 9, minute: 0 }, 'custom', now)).toEqual({ kind: 'custom', text: '0 9 * * 1' })
  })

  it('names the days', () => {
    expect(daysWords([1, 2, 3, 4, 5])).toBe('Weekdays')
    expect(daysWords([0, 6])).toBe('Weekends')
    expect(daysWords([0, 1, 2, 3, 4, 5, 6])).toBe('Every day')
    expect(daysWords([1])).toBe('Monday')
    expect(daysWords([0, 1, 3])).toBe('Mon, Wed, Sun')
    expect(daysWords([])).toBe('No day')
  })
})
