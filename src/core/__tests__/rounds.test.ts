import { activityWords, afterRound, assignedLine, contextProblem, leadOf, NO_ROUND, roundLine, roundOf, teamOf, turnTime, turnWords, turnWork } from '../rounds'

const turn = (member: string, status: string, started_at = 0, ended_at = 0, extra: Record<string, unknown> = {}) => ({ task_id: `t-${member}`, member, status, started_at, ended_at, ...extra })
const title = (member: string) => member.toUpperCase()
const round = (...turns: ReturnType<typeof turn>[]) => roundOf({ round: turns })

describe('the turns of a round', () => {
  it('reads the turns of the host in the words of the phone', () => {
    expect(roundOf({ round: [turn('a', 'settled', 1000, 12_000, { session: 's-a' }), turn('b', 'running', 13_000), turn('c', 'queued'), turn('d', 'new-state'), { status: 'running' }, null] }).turns).toEqual([
      { taskId: 't-a', member: 'a', state: 'done', startedAt: 1000, endedAt: 12_000, why: '', session: 's-a' },
      { taskId: 't-b', member: 'b', state: 'working', startedAt: 13_000, endedAt: 0, why: '', session: '' },
      { taskId: 't-c', member: 'c', state: 'waiting', startedAt: 0, endedAt: 0, why: '', session: '' },
      { taskId: 't-d', member: 'd', state: 'waiting', startedAt: 0, endedAt: 0, why: '', session: '' }
    ])
  })

  it('reads no round from a host that gives none', () => {
    expect(roundOf({ name: 'Launch' })).toEqual(NO_ROUND)
    expect(roundOf(null)).toEqual(NO_ROUND)
  })

  it('knows a bot that had nothing to add from a bot that answered', () => {
    expect(round(turn('a', 'settled', 1, 2, { passed: true }), turn('b', 'settled', 1, 2, { passed: false })).turns.map(row => row.state)).toEqual(['passed', 'done'])
  })

  it('says why a turn failed: in its own words, or with the first line of the host', () => {
    const [known, other, none, fine] = round(
      turn('a', 'failed', 1, 2, { reason: 'provider_rate_limit', error: 'HTTP 429' }),
      turn('b', 'failed', 1, 2, { reason: 'unknown', error: 'Boom at line 3\nTraceback' }),
      turn('c', 'indeterminate'),
      turn('d', 'settled', 1, 2, { reason: 'provider_rate_limit' })
    ).turns

    expect([known.why, other.why, none.why, fine.why]).toEqual(['its model provider is at its rate limit', 'Boom at line 3', '', ''])
  })

  it('says how long a turn runs or ran', () => {
    const [done, working, waiting] = round(turn('a', 'settled', 1000, 12_000), turn('b', 'running', 13_000), turn('c', 'queued')).turns

    expect(turnTime(done, 99_000)).toBe('0:11')
    expect(turnTime(working, 13_000 + 125_000)).toBe('2:05')
    expect(turnTime(waiting, 99_000)).toBe('')
    expect(turnWords(done, 99_000)).toBe('Answered in 0:11')
    expect(turnWords(working, 20_000)).toBe('Working, 0:07')
    expect(turnWords(waiting, 20_000)).toBe('Waiting')
    expect(turnWords(round(turn('a', 'failed', 1000, 4000)).turns[0], 0)).toBe('Did not answer, 0:03')
    expect(turnWords(round(turn('a', 'cancelled')).turns[0], 0)).toBe('Stopped')
    expect(turnWords(round(turn('a', 'settled', 1000, 4000, { passed: true })).turns[0], 0)).toBe('Had nothing to add')
  })

  it('names who works now and how many wait', () => {
    const line = (...turns: ReturnType<typeof turn>[]) => roundLine(round(...turns), title)

    expect(line(turn('a', 'settled', 1, 2), turn('b', 'running', 3))).toBe('B is working.')
    expect(line(turn('b', 'running', 3), turn('c', 'queued'), turn('d', 'queued'))).toBe('B is working. 2 more wait.')
    expect(line(turn('b', 'running', 3), turn('c', 'running', 3), turn('d', 'queued'))).toBe('B and C are working. 1 more waits.')
    expect(line(turn('b', 'stopping', 3))).toBe('B is stopping.')
    expect(line(turn('a', 'settled', 1, 2), turn('c', 'queued'), turn('d', 'queued'))).toBe('C is next. 1 more waits.')
    expect(line(turn('a', 'settled', 1, 2))).toBeNull()
    expect(line()).toBeNull()
  })
})

describe('what a round waits for', () => {
  const answer = {
    round: [turn('a', 'indeterminate'), turn('b', 'running', 3)],
    actions: [
      { kind: 'retry', task_id: 't-a', member: 'a' },
      { kind: 'approval', task_id: 't-b', member: 'b', request_id: 'q1', execution_generation: 2, asks: ' rm -rf build ' },
      { kind: 'approval', task_id: 't-b', member: 'b' },
      { kind: 'other', task_id: 't-b', member: 'b' },
      null
    ]
  }

  it('reads a turn to run again and a question of a bot', () => {
    expect(roundOf(answer).actions).toEqual([
      { kind: 'retry', taskId: 't-a', member: 'a', generation: 0 },
      { kind: 'approval', taskId: 't-b', member: 'b', requestId: 'q1', generation: 2, asks: 'rm -rf build' }
    ])
  })

  it('names the bot that waits for the user before the bot that works', () => {
    expect(roundLine(roundOf(answer), title)).toBe('B waits for your answer.')
  })
})

describe('what stays after a round', () => {
  it('names the bots that did not answer, once each', () => {
    expect(afterRound(round(turn('a', 'failed'), turn('a', 'failed'), turn('b', 'indeterminate'), turn('c', 'settled')), title)).toBe('A and B did not answer.')
  })

  it('says that the engine cut the round, and at which limit', () => {
    expect(afterRound(roundOf({ round: [turn('a', 'settled')], round_end: { status: 'bounded', reason: 'max_rounds' } }), title)).toBe('The bots stopped after 3 rounds. Send a message to go on.')
    expect(afterRound(roundOf({ round: [turn('a', 'failed')], round_end: { status: 'bounded', reason: 'max_messages' } }), title)).toBe('A did not answer. The bots stopped after 10 answers. Send a message to go on.')
    expect(roundOf({ round: [], round_end: { status: 'bounded', reason: 'new' } }).capped).toMatch(/limit of a round/)
  })

  it('has nothing to say after a round that ended by itself', () => {
    expect(afterRound(roundOf({ round: [turn('a', 'settled')], round_end: { status: 'settled', reason: 'silent_round' } }), title)).toBeNull()
    expect(afterRound(NO_ROUND, title)).toBeNull()
  })
})

it('takes the work of a turn from the session of a bot: the rows after the last message it was given', () => {
  const rows = [{ kind: 'user' }, { kind: 'tool' }, { kind: 'assistant' }, { kind: 'user' }, { kind: 'thinking' }, { kind: 'tool' }]

  expect(turnWork(rows)).toEqual([{ kind: 'thinking' }, { kind: 'tool' }])
  expect(turnWork([{ kind: 'tool' }])).toEqual([{ kind: 'tool' }])
  expect(turnWork([])).toEqual([])
})

describe('a room that works as a team', () => {
  it('reads who the room gave a message to', () => {
    const routed = roundOf({ round: [], assigned: { by: 'router', members: ['builder', 'scout'], lead: '', everyone: false, fallback: false } })
    const handed = roundOf({ round: [], assigned: { by: 'lead', members: ['builder'], lead: 'critic', everyone: false, fallback: false } })

    expect(assignedLine(routed.assigned, title)).toBe('Assigned to BUILDER and SCOUT.')
    expect(assignedLine(handed.assigned, title)).toBe('CRITIC gave this to BUILDER.')
    expect(assignedLine(roundOf({ assigned: { by: 'router', members: [], everyone: true } }).assigned, title)).toBe('Given to every bot.')
    expect(assignedLine(roundOf({ assigned: { by: 'router', fallback: true } }).assigned, title)).toContain('could not choose')
    expect(assignedLine(null, title)).toBeNull()
  })

  it('knows a discussion that stopped at its limit and can go on', () => {
    const paused = roundOf({ round: [], round_end: { status: 'bounded', reason: 'max_rounds', discussion: 'user:abc' } })

    expect(paused.paused).toBe('user:abc')
    expect(afterRound(paused, title)).toBe('The bots stopped at the limit of the discussion.')
    expect(roundOf({ round_end: { status: 'settled', discussion: 'user:abc' } }).paused).toBeNull()
  })

  it('reads a turn to let go, with its generation', () => {
    const { actions } = roundOf({ actions: [{ kind: 'discard', task_id: 't1', member: 'scout', execution_generation: 3 }, { kind: 'retry', task_id: 't2', member: 'builder' }] })

    expect(actions).toEqual([
      { kind: 'discard', taskId: 't1', member: 'scout', generation: 3 },
      { kind: 'retry', taskId: 't2', member: 'builder', generation: 0 }
    ])
  })

  it('reads the team: context, routings and what each bot does', () => {
    const team = teamOf({
      team: {
        context: { purpose: 'Ship v2', notes: 'Brief', routing: 'lead', lead: 'critic' },
        routings: ['everyone', 'lead', 'auto', 'odd'],
        activity: [{ member: 'scout', status: 'running', tool: 'web_search', started_at: 1000, progress_at: 5000, round: 2 }, { status: 'running' }],
        max_rounds: 3,
        max_continues: 5
      }
    })

    expect(team?.context).toEqual({ purpose: 'Ship v2', notes: 'Brief', routing: 'lead', lead: 'critic' })
    expect(team?.routings).toEqual(['everyone', 'lead', 'auto'])
    expect(team?.activity).toHaveLength(1)
    expect(leadOf(team)).toBe('critic')
    expect(leadOf(teamOf({ team: { context: { routing: 'everyone', lead: 'critic' } } }))).toBe('')
    expect(teamOf({})).toBeNull()
  })

  it('says what a bot does now, like the desktop app', () => {
    const row = { member: 'scout', status: 'running', tool: 'terminal', startedAt: 10_000, progressAt: 16_000, round: 1 }

    expect(activityWords(row, title, 17_000)).toBe('SCOUT · terminal · 7s')
    expect(activityWords({ ...row, tool: 'web_search' }, title, 85_000)).toBe('SCOUT · web search · 1m 15s')
    expect(activityWords(row, title, 16_000 + 180_000)).toContain('no progress for 3 min')
    expect(activityWords({ ...row, status: 'queued' }, title, 0)).toBe('SCOUT · waiting')
  })

  it('needs a lead bot from the room for lead routing', () => {
    expect(contextProblem({ purpose: '', notes: '', routing: 'lead', lead: '' }, ['a', 'b'])).toBe('Choose the lead bot.')
    expect(contextProblem({ purpose: '', notes: '', routing: 'lead', lead: 'a' }, ['a', 'b'])).toBeNull()
    expect(contextProblem({ purpose: 'x'.repeat(501), notes: '', routing: 'everyone', lead: '' }, [])).toContain('500')
  })
})
