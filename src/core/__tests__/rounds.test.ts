import { roundLine, roundTurns, turnTime, turnWords } from '../rounds'

const turn = (member: string, status: string, started_at = 0, ended_at = 0) => ({ member, status, started_at, ended_at })
const title = (member: string) => member.toUpperCase()

describe('the turns of a round', () => {
  it('reads the turns of the host in the words of the phone', () => {
    expect(roundTurns({ round: [turn('a', 'settled', 1000, 12_000), turn('b', 'running', 13_000), turn('c', 'queued'), turn('d', 'new-state'), { status: 'running' }, null] })).toEqual([
      { member: 'a', state: 'done', startedAt: 1000, endedAt: 12_000 },
      { member: 'b', state: 'working', startedAt: 13_000, endedAt: 0 },
      { member: 'c', state: 'waiting', startedAt: 0, endedAt: 0 },
      { member: 'd', state: 'waiting', startedAt: 0, endedAt: 0 }
    ])
  })

  it('reads no turn from a host that gives none', () => {
    expect(roundTurns({ name: 'Launch' })).toEqual([])
    expect(roundTurns(null)).toEqual([])
  })

  it('says how long a turn runs or ran', () => {
    const [done, working, waiting] = roundTurns({ round: [turn('a', 'settled', 1000, 12_000), turn('b', 'running', 13_000), turn('c', 'queued')] })

    expect(turnTime(done, 99_000)).toBe('0:11')
    expect(turnTime(working, 13_000 + 125_000)).toBe('2:05')
    expect(turnTime(waiting, 99_000)).toBe('')
    expect(turnWords(done, 99_000)).toBe('Answered in 0:11')
    expect(turnWords(working, 20_000)).toBe('Working, 0:07')
    expect(turnWords(waiting, 20_000)).toBe('Waiting')
    expect(turnWords(roundTurns({ round: [turn('a', 'failed', 1000, 4000)] })[0], 0)).toBe('Did not answer, 0:03')
    expect(turnWords(roundTurns({ round: [turn('a', 'cancelled')] })[0], 0)).toBe('Stopped')
  })

  it('names who works now and how many wait', () => {
    const line = (...round: ReturnType<typeof turn>[]) => roundLine(roundTurns({ round }), title)

    expect(line(turn('a', 'settled', 1, 2), turn('b', 'running', 3))).toBe('B is working.')
    expect(line(turn('b', 'running', 3), turn('c', 'queued'), turn('d', 'queued'))).toBe('B is working. 2 more wait.')
    expect(line(turn('b', 'running', 3), turn('c', 'running', 3), turn('d', 'queued'))).toBe('B and C are working. 1 more waits.')
    expect(line(turn('b', 'stopping', 3))).toBe('B is stopping.')
    expect(line(turn('a', 'settled', 1, 2), turn('c', 'queued'), turn('d', 'queued'))).toBe('C is next. 1 more waits.')
    expect(line(turn('a', 'settled', 1, 2))).toBeNull()
    expect(line()).toBeNull()
  })
})
