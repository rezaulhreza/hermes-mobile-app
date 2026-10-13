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
    { id: 'r1', hasChat: true, title: 'COMPLETED · Cron Job: Prune', at: 100_000 }
  ])
  expect(scheduleRuns(null)).toEqual([])
})

describe('runs, delivery and templates of a schedule', () => {
  const { blueprintDefaults, blueprintMissing, blueprintRows, deliveryLabel, runFilePath, scheduleRuns } = jest.requireActual('../cron') as typeof import('../cron')

  it('finds the file of a run that has no conversation', () => {
    expect(runFilePath({ id: 'j1', home: '/Users/me/.hermes' }, { id: 'cron_output:j1:2026-10-06_01-56-52' })).toBe('/Users/me/.hermes/cron/output/j1/2026-10-06_01-56-52.md')
    expect(runFilePath({ id: 'j1', home: 'C:\\Users\\me\\.hermes\\' }, { id: 'cron_output:j1:2026-10-06_01-56-52' })).toBe('C:\\Users\\me\\.hermes\\cron\\output\\j1\\2026-10-06_01-56-52.md')
    expect(runFilePath({ id: 'j1', home: '/Users/me/.hermes' }, { id: '20261006_015652_abc' })).toBeNull()
  })

  it('knows a run with a conversation from a run with a file', () => {
    const runs = scheduleRuns({ runs: [{ id: 'cron_output:j1:x', title: 'A' }, { id: '20261006_015652_abc', title: 'B' }] })

    expect(runs.map(run => run.hasChat)).toEqual([false, true])
  })

  it('names a place for a result with the name of the bot', () => {
    const targets = [{ id: 'telegram', name: 'Telegram' }]
    const titles = new Map([['default', 'Manager']])

    expect(deliveryLabel('local', targets, titles)).toBe('Only save it on the host')
    expect(deliveryLabel('bot-chat:default', targets, titles)).toBe('The chat of Manager')
    expect(deliveryLabel('bot-chat:qa', targets, titles)).toBe('The chat of qa')
    expect(deliveryLabel('telegram', targets, titles)).toBe('Telegram')
    expect(deliveryLabel('discord', targets, titles)).toBe('Discord')
  })

  it('reads the templates and what the user must fill', () => {
    const [blueprint] = blueprintRows({ blueprints: [{ key: 'k', title: 'Reminder', description: 'd', fields: [{ name: 'what', type: 'text', label: 'What?' }, { name: 'time', type: 'time', label: 'When?', default: '08:00' }, { name: 'note', type: 'text', label: 'Note', optional: true }] }, { title: 'no key' }] })

    expect(blueprintDefaults(blueprint)).toEqual({ what: '', time: '08:00', note: '' })
    expect(blueprintMissing(blueprint, blueprintDefaults(blueprint))?.name).toBe('what')
    expect(blueprintMissing(blueprint, { what: 'Water the plants', time: '08:00' })).toBeNull()
  })
})
