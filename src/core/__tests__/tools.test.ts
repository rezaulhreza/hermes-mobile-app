import { diffLines, finalAnswerKeys, hasToolDetail, storedToolOutput, toolDetail, toolInput, toolOutput } from '../tools'

describe('toolInput', () => {
  it('shows one text argument as it is', () => {
    expect(toolInput({ command: 'ls -la' })).toBe('ls -la')
  })

  it('names each argument when there are several', () => {
    expect(toolInput({ path: 'a.ts', limit: 20, empty: '', patch: 'x\ny' })).toBe('path: a.ts\nlimit: 20\npatch:\nx\ny')
  })

  it('falls back to the text the backend gave', () => {
    expect(toolInput(null, ' ls ')).toBe('ls')
    expect(toolInput({}, null)).toBeUndefined()
  })

  it('shows no input for a call with no arguments', () => {
    expect(toolInput({}, '{}')).toBeUndefined()
    expect(toolInput(undefined, ' {} ')).toBeUndefined()
  })
})

describe('toolOutput', () => {
  it('prefers the text, then the result', () => {
    expect(toolOutput(' done ', { a: 1 })).toBe('done')
    expect(toolOutput(null, { a: 1 })).toBe('{\n  "a": 1\n}')
    expect(toolOutput('', null)).toBeUndefined()
  })

  it('shows no output for an empty result', () => {
    expect(toolOutput('{}')).toBeUndefined()
    expect(toolOutput(null, {})).toBeUndefined()
    expect(toolOutput(null, [])).toBeUndefined()
    expect(storedToolOutput('{}')).toBeUndefined()
  })

  it('cuts a very long output and says how much is left', () => {
    expect(toolOutput('x'.repeat(20_050))).toMatch(/… \(50 more characters\)$/)
  })
})

describe('storedToolOutput', () => {
  it('shows the output, and the failure only when there is one', () => {
    expect(storedToolOutput('{"output": "76 3454 a.yml\\n", "exit_code": 0, "error": null}')).toBe('76 3454 a.yml')
    expect(storedToolOutput('{"output": "", "exit_code": 2, "error": "no such file"}')).toBe('exit code 2\nno such file')
  })

  it('shows anything else as it is', () => {
    expect(storedToolOutput('plain text')).toBe('plain text')
    expect(storedToolOutput('{"matches": 3}')).toBe('{\n  "matches": 3\n}')
    expect(storedToolOutput(null)).toBeUndefined()
  })
})

describe('toolDetail', () => {
  it('keeps only what has text', () => {
    expect(toolDetail({ input: 'ls', output: ' ', diff: undefined })).toEqual({ input: 'ls' })
    expect(hasToolDetail({})).toBe(false)
    expect(hasToolDetail({ diff: '@@' })).toBe(true)
  })
})

describe('diffLines', () => {
  it('says what each line is', () => {
    expect(diffLines('--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n same\n').map(line => line.kind)).toEqual([
      'file',
      'file',
      'hunk',
      'remove',
      'add',
      'context'
    ])
  })
})

describe('finalAnswerKeys', () => {
  const items = [
    { kind: 'user', key: 'u1' },
    { kind: 'assistant', key: 'a1' },
    { kind: 'tool', key: 't1' },
    { kind: 'assistant', key: 'a2' },
    { kind: 'notice', key: 'n1' },
    { kind: 'user', key: 'u2' },
    { kind: 'assistant', key: 'a3' }
  ]

  it('marks the answer that ends each turn', () => {
    expect([...finalAnswerKeys(items, false)]).toEqual(['a2', 'a3'])
  })

  it('leaves the last row alone while the turn runs or the text streams', () => {
    expect([...finalAnswerKeys(items, true)]).toEqual(['a2'])
    expect([...finalAnswerKeys([{ kind: 'assistant', key: 'a', streaming: true }], false)]).toEqual([])
  })
})

describe('toolPicture', () => {
  const { toolPicture } = jest.requireActual('../tools') as typeof import('../tools')

  it('reads the path from the result of a live tool', () => {
    expect(toolPicture({ screenshot_path: '/Users/me/.hermes/cache/images/computer_use_1.png' })).toBe('/Users/me/.hermes/cache/images/computer_use_1.png')
  })

  it('reads the path from a stored result, also a Windows path', () => {
    expect(toolPicture(null, '{"ok": true, "screenshot_path": "C:\\\\Users\\\\me\\\\shot 1.png"}')).toBe('C:\\Users\\me\\shot 1.png')
  })

  it('reads the path from the summary', () => {
    expect(toolPicture(undefined, 'captured; shareable screenshot saved to /tmp/a.png')).toBe('/tmp/a.png')
  })

  it('finds no picture in a normal result', () => {
    expect(toolPicture({ output: 'done' }, 'done')).toBeUndefined()
  })
})
