import { newShellId, resizeFrame, shellLabel, shellSocketPath, shellsFrom, withControl } from '../shell'

describe('the shell of the terminal', () => {
  it('names a new shell with letters and figures only', () => {
    expect(newShellId(() => 0.5)).toMatch(/^s[a-z0-9]+$/)
  })

  it('builds the path of the socket, with the folder only when there is one', () => {
    expect(shellSocketPath('s1', '/Users/me/my app', { cols: 80, rows: 24 })).toBe('/api/plugins/phone-shell/pty?id=s1&cwd=%2FUsers%2Fme%2Fmy%20app&cols=80&rows=24')
    expect(shellSocketPath('s1', null, { cols: 40, rows: 10 })).toBe('/api/plugins/phone-shell/pty?id=s1&cols=40&rows=10')
  })

  it('writes the resize frame of the host, never smaller than 2 by 2', () => {
    expect(resizeFrame(81.6, 24)).toBe('\x1b[RESIZE:82;24]')
    expect(resizeFrame(0, 0)).toBe('\x1b[RESIZE:2;2]')
  })

  it('turns a letter into its control code with Ctrl held', () => {
    expect(withControl('c')).toBe('\x03')
    expect(withControl('D')).toBe('\x04')
    expect(withControl('[')).toBe('\x1b')
    expect(withControl('1')).toBe('1')
    expect(withControl('ls')).toBe('ls')
  })

  it('reads the list of shells and leaves out a row it cannot use', () => {
    expect(shellsFrom({ shells: [{ id: 's1', cwd: '/h/app', started: 5 }, { id: 'bad id' }, { cwd: '/x' }, { id: 's2' }] })).toEqual([
      { id: 's1', cwd: '/h/app', started: 5 },
      { id: 's2', cwd: null, started: null }
    ])
    expect(shellsFrom(null)).toEqual([])
  })

  it('names a tab by the last folder of the shell', () => {
    expect(shellLabel({ cwd: '/Users/me/site/' })).toBe('site')
    expect(shellLabel({ cwd: null })).toBe('shell')
  })
})
