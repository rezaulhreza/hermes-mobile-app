import { backgroundJobs, curatorOf, dayName, foreignChats, hostFacts, jobOutput, logLines, shareLinks, shortCount, uptimeWords, usageOf } from '../ops'

describe('the host in facts', () => {
  it('writes a large count short', () => {
    expect(shortCount(29_926_817)).toBe('29.9M')
    expect(shortCount(5_400)).toBe('5.4K')
    expect(shortCount(1_121_927_662)).toBe('1.1B')
    expect(shortCount(184)).toBe('184')
    expect(shortCount(3_000_000)).toBe('3M')
  })

  it('says the state of the host', () => {
    const facts = hostFacts(
      { version: '1.2.3', gateway_running: true, gateway_state: 'running', active_sessions: 0, active_agents: 2, components: { platforms: { configured: 2, connected: 1 } } },
      { os: 'Darwin', arch: 'arm64', memory: { total: 16e9, percent: 71.6 }, disk: { total: 500e9, free: 3.2e9 } },
      { update_available: false }
    )

    expect(facts).toEqual([
      { label: 'Hermes', value: 'Version 1.2.3' },
      { label: 'Update', value: 'Hermes is up to date' },
      { label: 'Messaging', value: 'Running', bad: false },
      { label: 'Channels', value: '1 of 2 connected', bad: true },
      { label: 'At work now', value: '2 bots' },
      { label: 'Memory of the host', value: '72% in use', bad: false },
      { label: 'Disk of the host', value: '3.2 GB free', bad: true },
      { label: 'System', value: 'macOS, arm64' }
    ])
    expect(hostFacts(null, null, null)).toEqual([])
  })

  it('sums the usage, the newest day first', () => {
    const usage = usageOf({
      totals: { total_input: 2_000_000, total_output: 500, total_cache_read: 0, total_api_calls: 12, total_sessions: 3, total_estimated_cost: 1.5 },
      daily: [{ day: '2026-01-01', input_tokens: 10, output_tokens: 5, api_calls: 1 }, { day: '2026-01-02', input_tokens: 100, output_tokens: 50, api_calls: 2 }],
      by_model: [{ model: 'small', input_tokens: 1, output_tokens: 1, api_calls: 1, sessions: 1 }, { model: 'large', input_tokens: 90, output_tokens: 9, api_calls: 2, sessions: 2 }]
    })

    expect(usage.days.map(day => day.day)).toEqual(['2026-01-02', '2026-01-01'])
    expect(usage.peak).toBe(150)
    expect(dayName('2026-10-09')).toBe('9 Oct')
    expect(dayName('week 3')).toBe('week 3')
    expect(usage.models.map(model => model.model)).toEqual(['large', 'small'])
    expect(usage.facts[0]).toEqual({ label: 'Read by the models', value: '2M tokens' })
    expect(usage.facts[5]).toEqual({ label: 'Cost', value: '$1.50' })
    expect(usageOf({}).facts[5].value).toMatch(/No price/)
  })

  it('reads the background work', () => {
    expect(backgroundJobs({ processes: [{ session_id: 's1', command: 'npm run dev', status: 'running', uptime: 75 }, {}] })).toEqual([{ sessionId: 's1', command: 'npm run dev', status: 'running', uptime: 75 }])
    expect(uptimeWords(40)).toBe('40 s')
    expect(uptimeWords(75)).toBe('1 min')
    expect(uptimeWords(4000)).toBe('1 h 6 min')
  })

  it('cuts a log line into its parts, the newest first', () => {
    expect(logLines({ lines: ['2026-10-09 20:34:00,697 WARNING server: refused\n', '  more of it\n', ''] })).toEqual([
      { id: 'l1', time: '', level: '', text: '  more of it' },
      { id: 'l0', time: '20:34:00', level: 'WARNING', text: 'server: refused' }
    ])
  })

  it('reads the output of a care job and the links of a report', () => {
    expect(jobOutput({ running: false, exit_code: 0, lines: ['ok \n'] })).toEqual({ running: false, exitCode: 0, lines: ['ok'] })
    expect(jobOutput({ running: true })).toEqual({ running: true, exitCode: null, lines: [] })
    expect(shareLinks({ urls: { report: 'https://p.example/a', logs: '' } })).toEqual(['https://p.example/a'])
    expect(shareLinks({ urls: ['https://p.example/b'] })).toEqual(['https://p.example/b'])
  })

  it('says when the curator ran', () => {
    const now = Date.parse('2026-10-09T12:00:00Z')

    expect(curatorOf({ enabled: true, paused: false, interval_hours: 168, last_run_at: '2026-10-03T06:00:00+00:00' }, now)).toEqual({ enabled: true, paused: false, line: 'It ran 6 days ago, runs every 7 days' })
    expect(curatorOf({}, now).line).toBe('It did not run yet')
  })

  it('reads the chats of other tools', () => {
    expect(foreignChats({ sessions: [{ id: 'x', source: 'claude', label: 'Claude Code', title: ' Fix  the bug ', turn_count: 4, mtime: 9 }, { source: 'codex' }] })).toEqual([{ id: 'x', tool: 'Claude Code', title: 'Fix the bug', turns: 4, at: 9 }])
  })
})
