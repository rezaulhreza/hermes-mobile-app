import { catchUpChoice, catchUpValue, scheduleLine, scheduleRows, scheduleRuns, stopWords, untilWords, whenWords } from '../cron'

const NOW = Date.parse('2026-10-09T12:00:00Z')

const rows = scheduleRows([
  { id: 'done', name: 'One time', state: 'completed', enabled: false, schedule_display: 'once at 2026-10-07 20:00', last_status: 'ok' },
  { id: 'paused', name: 'Prune', state: 'paused', enabled: false, schedule_display: '0 10 * * *', next_run_at: '2026-10-10T10:00:00Z' },
  { id: 'later', name: 'Watchdog', state: 'scheduled', enabled: true, schedule: { display: '0 9 * * *' }, next_run_at: '2026-10-10T09:00:00Z', last_status: 'ok', deliver: 'telegram', no_agent: true },
  { id: 'soon', prompt: 'Check the mail\nand answer', state: 'scheduled', enabled: true, schedule_display: 'every 30m', next_run_at: '2026-10-09T12:05:00Z' },
  { id: 'bad', name: 'Backup', state: 'scheduled', enabled: true, schedule_display: 'every 1h', next_run_at: '2026-10-09T13:00:00Z', last_status: 'error', last_error: 'disk full', failure_streak: 2 },
  { name: 'no id' }
])

describe('a run in flight and the missed runs', () => {
  const [live, stopped, plain] = scheduleRows([
    { id: 'live', name: 'A', state: 'scheduled', schedule_display: 'every 1h', latest_execution: { status: 'running' }, catch_up: true },
    { id: 'stopped', name: 'B', state: 'scheduled', schedule_display: 'every 1h', latest_execution: { status: 'cancelled', error: 'cancelled on request (Stop)' }, catch_up: false },
    { id: 'plain', name: 'C', state: 'scheduled', schedule_display: 'every 1h', live_execution: { id: 'x' } }
  ]).sort((a, b) => a.name.localeCompare(b.name))

  it('knows a run that Stop can reach, and a run that was stopped', () => {
    expect(live).toMatchObject({ running: true, cancelled: null, catchUp: true })
    expect(stopped).toMatchObject({ running: false, cancelled: 'cancelled on request (Stop)', catchUp: false })
    expect(plain).toMatchObject({ running: true, catchUp: null })
    expect(scheduleLine(live, NOW)).toBe('Every hour · Running now')
    expect(scheduleLine(stopped, NOW)).toContain('the last run was stopped')
  })

  it('turns the missed-run choice into the value of the host and back', () => {
    expect([true, false, null].map(value => catchUpChoice(value))).toEqual(['run', 'skip', 'default'])
    expect(catchUpValue('run')).toBe(true)
    expect(catchUpValue('skip')).toBe(false)
    expect(catchUpValue('default')).toBeNull()
  })

  it('says what a Stop did', () => {
    expect(stopWords({ cancelled: true })).toBe('The run stopped.')
    expect(stopWords({ cancelled: false })).toContain('Nothing was running')
  })
})

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
    expect(scheduleLine(rows[0], NOW)).toBe('Every hour · Next in 1 h · the last run failed')
    expect(scheduleLine(rows[1], NOW)).toBe('Every 30 minutes · Next in 5 min')
    expect(scheduleLine(rows[2], NOW)).toBe('Every day at 9:00 am · Next in 21 h')
    expect(scheduleLine(rows[3], NOW)).toBe('Every day at 10:00 am · Paused')
    expect(scheduleLine(rows[4], NOW)).toBe('Once, 7 Oct at 8:00 pm · Finished')
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

describe('when a schedule runs, in the words of a person', () => {
  const now = new Date(2026, 9, 11, 12, 0)

  it('reads the forms the host gives', () => {
    expect(whenWords('every 5m', now)).toBe('Every 5 minutes')
    expect(whenWords('every 360m', now)).toBe('Every 6 hours')
    expect(whenWords('every 2h', now)).toBe('Every 2 hours')
    expect(whenWords('every 1440m', now)).toBe('Every day')
    expect(whenWords('once at 2026-10-07 20:00', now)).toBe('Once, 7 Oct at 8:00 pm')
    expect(whenWords('once at 2027-01-02 09:05', now)).toBe('Once, 2 Jan 2027 at 9:05 am')
    expect(whenWords('2026-10-12T19:00', now)).toBe('Once, 12 Oct at 7:00 pm')
  })

  it('reads the cron fields a person uses', () => {
    expect(whenWords('0 10 * * *', now)).toBe('Every day at 10:00 am')
    expect(whenWords('30 0 * * *', now)).toBe('Every day at 12:30 am')
    expect(whenWords('0 9 * * 1-5', now)).toBe('Weekdays at 9:00 am')
    expect(whenWords('0 18 * * 1', now)).toBe('Every Monday at 6:00 pm')
    expect(whenWords('0 18 * * 1,3', now)).toBe('Mon, Wed at 6:00 pm')
    expect(whenWords('0 9 1 * *', now)).toBe('Day 1 of every month at 9:00 am')
    expect(whenWords('*/15 * * * *', now)).toBe('Every 15 minutes')
    expect(whenWords('0 */4 * * *', now)).toBe('Every 4 hours')
  })

  it('keeps a form it does not know', () => {
    expect(whenWords('0 9 1 6 *', now)).toBe('0 9 1 6 *')
    expect(whenWords('5,35 9-17 * * *', now)).toBe('5,35 9-17 * * *')
    expect(whenWords('at sunrise', now)).toBe('at sunrise')
  })
})
