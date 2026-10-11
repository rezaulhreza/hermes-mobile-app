import {
  baseName,
  cdTarget,
  changeGroups,
  commandOutput,
  commitLabel,
  commitProblem,
  editProblem,
  parentPath,
  pathUnderRoot,
  previewTarget,
  recentCommands,
  resolveCdCommand,
  shellCommand,
  TERMINAL_KEEP,
  withEntry,
  withRecentRoot
} from '../workspace'

describe('paths', () => {
  it('finds the name and the folder above, on every kind of host', () => {
    expect(baseName('/Users/me/app/')).toBe('app')
    expect(baseName('C:\\Users\\me\\app')).toBe('app')
    expect(parentPath('/Users/me/app')).toBe('/Users/me')
    expect(parentPath('/Users')).toBe('/')
    expect(parentPath('/')).toBeNull()
    expect(parentPath('C:\\Users\\me')).toBe('C:\\Users')
    expect(parentPath('C:\\Users')).toBe('C:\\')
    expect(parentPath('C:\\')).toBeNull()
  })

  it('shows a folder under its root', () => {
    expect(pathUnderRoot('/Users/me/app', '/Users/me/app/src/core')).toBe('src / core')
    expect(pathUnderRoot('/Users/me/app', '/Users/me/app')).toBe('')
  })
})

describe('changes', () => {
  const files = [
    { path: 'a.ts', added: 1, removed: 0, status: 'M', staged: true },
    { path: 'b.ts', added: 3, removed: 2, status: '?', staged: false }
  ]

  it('says what the commit button will commit', () => {
    expect(changeGroups(files).staged.map(file => file.path)).toEqual(['a.ts'])
    expect(commitLabel(files)).toBe('Commit 1 staged file')
    // With nothing staged the host stages every change first.
    expect(commitLabel([files[1]!])).toBe('Commit all changes')
  })

  it('refuses a commit with no message or no change', () => {
    expect(commitProblem(' ', files)).toBe('Write what the change is.')
    expect(commitProblem('Fix it', [])).toBe('There is nothing to commit.')
    expect(commitProblem('Fix it', files)).toBeNull()
  })

  it('does not edit a file that a save would damage', () => {
    expect(editProblem({ binary: true, truncated: false })).toContain('not text')
    expect(editProblem({ binary: false, truncated: true })).toContain('too large')
    expect(editProblem({ binary: false, truncated: false })).toBeNull()
  })
})

describe('terminal', () => {
  it('runs a command in the folder, for the shell of the host', () => {
    expect(shellCommand("/Users/me/it's here", 'ls')).toBe("cd '/Users/me/it'\\''s here' && ls")
    expect(shellCommand('C:\\Users\\me', 'dir')).toBe('cd /d "C:\\Users\\me" && dir')
  })

  it('keeps the folder of a cd itself', () => {
    expect(cdTarget('cd src')).toBe('src')
    expect(cdTarget(' cd "My Docs" ')).toBe('My Docs')
    expect(cdTarget('cd')).toBe('~')
    expect(cdTarget('cd src && ls')).toBeNull()
    expect(cdTarget('cdk deploy')).toBeNull()
    expect(resolveCdCommand('/a', 'src')).toBe("cd '/a' && cd 'src' && pwd")
    expect(resolveCdCommand('/a', '~')).toBe("cd '/a' && cd ~ && pwd")
  })

  it('shows the output, the error text, or that there was none', () => {
    expect(commandOutput({ stdout: 'a\n', stderr: 'warn\n', code: 0 })).toBe('a\nwarn')
    expect(commandOutput({ stdout: '', stderr: '', code: 0 })).toBe('(no output)')
    expect(commandOutput({ stdout: '', stderr: '', code: 2 })).toBe('(ended with code 2)')
  })

  it('offers the last different commands, the newest first', () => {
    const entry = (key: number, command: string) => ({ key, cwd: '/', command, output: '', failed: false })

    expect(recentCommands([entry(1, 'ls'), entry(2, 'git status'), entry(3, 'ls'), entry(4, ' ')])).toEqual(['ls', 'git status'])
  })

  it('keeps the last commands only', () => {
    let entries = [] as ReturnType<typeof withEntry>

    for (let key = 0; key < TERMINAL_KEEP + 5; key += 1) {
      entries = withEntry(entries, { key, cwd: '/', command: 'ls', output: '', failed: false })
    }

    expect(entries).toHaveLength(TERMINAL_KEEP)
    expect(entries[0]!.key).toBe(5)
  })
})

describe('start points', () => {
  it('reads a port, a host and a full address for the preview', () => {
    expect(previewTarget('3000')).toBe('http://localhost:3000')
    expect(previewTarget('localhost:5173/app')).toBe('http://localhost:5173/app')
    expect(previewTarget('https://example.com')).toBe('https://example.com')
    expect(previewTarget(' ')).toBeNull()
  })

  it('remembers the newest folders, each once', () => {
    expect(withRecentRoot(['/a', '/b'], '/b')).toEqual(['/b', '/a'])
    expect(withRecentRoot(['/a', '/b', '/c'], '/d', 3)).toEqual(['/d', '/a', '/b'])
  })
})
