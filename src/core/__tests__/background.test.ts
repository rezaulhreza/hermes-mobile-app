import { backgroundHeading, backgroundJobs, backgroundLine, mergeBackground, touchesBackground } from '../background'

const job = (id: string, state: 'running' | 'done' | 'failed' = 'running') => ({ id, command: id, state, uptime: 0, exitCode: null, tail: '' })

describe('commands in the background of a chat', () => {
  it('reads the list of the host', () => {
    expect(
      backgroundJobs({
        processes: [
          { session_id: 'p1', command: 'npm  run dev', status: 'running', uptime_seconds: 75, output_tail: 'a\nb\nc\nd' },
          { session_id: 'p2', command: 'make', status: 'exited', exit_code: 2 },
          { session_id: 'p3', status: 'exited', exit_code: 0 },
          { command: 'no id' }
        ]
      })
    ).toEqual([
      { id: 'p1', command: 'npm run dev', state: 'running', uptime: 75, exitCode: null, tail: 'b\nc\nd' },
      { id: 'p2', command: 'make', state: 'failed', uptime: 0, exitCode: 2, tail: '' },
      { id: 'p3', command: 'A command', state: 'done', uptime: 0, exitCode: 0, tail: '' }
    ])
    expect(backgroundJobs(null)).toEqual([])
  })

  it('keeps the place of a row, adds new rows last, and leaves out a row the user took away', () => {
    const merged = mergeBackground([job('a'), job('b')], [job('c'), job('b', 'done'), job('a'), job('x')], new Set(['x']))

    expect(merged.map(row => [row.id, row.state])).toEqual([['a', 'running'], ['b', 'done'], ['c', 'running']])
    expect(mergeBackground([job('a')], [], new Set())).toEqual([])
  })

  it('does not show a command that ended before the chat opened', () => {
    // The first read of a chat: the host still lists what ended long ago.
    expect(mergeBackground([], [job('old', 'failed'), job('gone', 'done'), job('live')], new Set()).map(row => row.id)).toEqual(['live'])
    // A command this screen saw run shows its end.
    expect(mergeBackground([job('live')], [job('old', 'failed'), job('live', 'failed')], new Set()).map(row => [row.id, row.state])).toEqual([['live', 'failed']])
  })

  it('says what runs and what ended', () => {
    expect(backgroundHeading([job('a'), job('b', 'done')])).toBe('1 command runs in the background')
    expect(backgroundHeading([job('a'), job('b')])).toBe('2 commands run in the background')
    expect(backgroundHeading([job('a', 'failed')])).toBe('A background command failed')
    expect(backgroundHeading([job('a', 'done')])).toBe('The background command ended')
    expect(backgroundLine({ ...job('a'), uptime: 40 })).toBe('Runs for 40 s')
    expect(backgroundLine({ ...job('a'), uptime: 4000 })).toBe('Runs for 1 h 6 min')
    expect(backgroundLine({ ...job('a', 'failed'), exitCode: 2 })).toBe('Failed with code 2')
    expect(backgroundLine(job('a', 'done'))).toBe('Ended')
  })

  it('knows the tools that start or end a command', () => {
    expect(touchesBackground('terminal')).toBe(true)
    expect(touchesBackground('process')).toBe(true)
    expect(touchesBackground('read_file')).toBe(false)
  })
})
