import { scheduleLine, scheduleProblem, scheduleRows, scheduleRuns, untilWords } from '../cron'

const NOW = Date.parse('2026-10-09T12:00:00Z')

const rows = scheduleRows([
  { id: 'done', name: 'One time', state: 'completed', enabled: false, schedule_display: 'once at 2026-10-07 20:00', last_status: 'ok' },
  { id: 'paused', name: 'Prune', state: 'paused', enabled: false, schedule_display: '0 10 * * *', next_run_at: '2026-10-10T10:00:00Z' },
  { id: 'later', name: 'Watchdog', state: 'scheduled', enabled: true, schedule: { display: '0 9 * * *' }, next_run_at: '2026-10-10T09:00:00Z', last_status: 'ok', deliver: 'telegram', no_agent: true },
  { id: 'soon', prompt: 'Check the mail\nand answer', state: 'scheduled', enabled: true, schedule_display: 'every 30m', next_run_at: '2026-10-09T12:05:00Z' },
  { id: 'bad', name: 'Backup', state: 'scheduled', enabled: true, schedule_display: 'every 1h', next_run_at: '2026-10-09T13:00:00Z', last_status: 'error', last_error: 'disk full', failure_streak: 2 },
  { name: 'no id' }
])

describe('scheduleRows', () => {
  it('puts a failing schedule first, then by the next run, then paused, then finished', () => {
    expect(rows.map(row => row.id)).toEqual(['bad', 'soon', 'later', 'paused', 'done'])
  })

  it('names a schedule by its prompt when it has no name', () => {
    expect(rows[1].name).toBe('Check the mail')
  })

  it('plans no run for a paused schedule', () => {
    expect(rows[3].nextRunAt).toBeNull()
  })

  it('says each one in a line', () => {
    expect(scheduleLine(rows[0], NOW)).toBe('every 1h · Next in 1 h · the last run failed')
    expect(scheduleLine(rows[1], NOW)).toBe('every 30m · Next in 5 min')
    expect(scheduleLine(rows[2], NOW)).toBe('0 9 * * * · Next in 21 h')
    expect(scheduleLine(rows[3], NOW)).toBe('0 10 * * * · Paused')
    expect(scheduleLine(rows[4], NOW)).toBe('once at 2026-10-07 20:00 · Finished')
  })

  it('reads the rest of a job', () => {
    expect(rows[2]).toMatchObject({ deliver: 'telegram', scriptOnly: true, profile: 'default', failed: false })
    expect(rows[0].lastError).toBe('disk full')
  })
})

it('says a time to go in words', () => {
  expect(untilWords(NOW - 5, NOW)).toBe('now')
  expect(untilWords(NOW + 3 * 86_400_000, NOW)).toBe('in 3 days')
})

describe('scheduleProblem', () => {
  it('takes an interval, cron fields and a date', () => {
    for (const when of ['every 30m', 'every 2 hours', '0 9 * * 1-5', '*/15 * * * *', 'at 2026-10-12 09:00', '2026-10-12T09:00']) {
      expect(scheduleProblem('Do it', when)).toBeNull()
    }
  })

  it('asks for the missing part', () => {
    expect(scheduleProblem(' ', 'every 1h')).toBe('Write what the agent must do.')
    expect(scheduleProblem('Do it', ' ')).toBe('Choose when it runs.')
    expect(scheduleProblem('Do it', 'sometimes')).toContain('every 2h')
  })
})

it('reads the run history', () => {
  expect(scheduleRuns({ runs: [{ id: 'r1', title: 'COMPLETED · # Cron Job: **Prune**', started_at: 100 }, { title: 'no id' }] })).toEqual([
    { id: 'r1', title: 'COMPLETED · Cron Job: Prune', at: 100_000 }
  ])
  expect(scheduleRuns(null)).toEqual([])
})
