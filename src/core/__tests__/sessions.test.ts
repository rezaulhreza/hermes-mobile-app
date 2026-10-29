import {
  channel,
  exportFileName,
  rowProfile,
  rowsInView,
  filterSessions,
  keepLastMessages,
  liveStates,
  sameLiveStates,
  sessionActions,
  sessionSearchPath,
  snippetParts,
  withLastMessages,
  withMessageHits,
  sessionLine,
  sessionListPath,
  sessionPreview,
  sessionSections,
  sessionTitle,
  withSessionChange,
  withSessionPage,
  withSources
} from '../sessions'

const rows = [
  { id: 'a', title: 'Fix the build', preview: 'the build fails', source: 'desktop' },
  { id: 'b', title: '', preview: 'Reply ok. @file:/up/notes.md @file:/Users/x/.herm...', source: 'mobile', pinned: true },
  { id: 'c', title: 'Laptop', preview: 'find a laptop', source: 'desktop' }
]

describe('session rows', () => {
  it('shows the title, or the preview without attachment references', () => {
    expect(sessionTitle(rows[0])).toBe('Fix the build')
    expect(sessionPreview(rows[1])).toBe('Reply ok.')
    expect(sessionTitle(rows[1])).toBe('Reply ok.')
    expect(sessionTitle({ id: 'x' })).toBe('Untitled conversation')
  })

  it('asks the backend for the view', () => {
    expect(sessionListPath('current')).toContain('archived=exclude')
    expect(sessionListPath('archived')).toContain('archived=only')
  })
})

describe('sessionLine', () => {
  it('shows the last message, with "You: " for the user', () => {
    expect(sessionLine({ ...rows[0], last: { role: 'assistant', text: 'The **build** passes now.' } })).toBe('The build passes now.')
    expect(sessionLine({ ...rows[0], last: { role: 'user', text: 'Ship it @file:/up/a.png' } })).toBe('You: Ship it')
  })

  it('shows the last message under an untitled row, but not when it is the title', () => {
    expect(sessionLine({ ...rows[1], last: { role: 'assistant', text: 'Done.' } })).toBe('Done.')
    expect(sessionLine({ ...rows[1], last: { role: 'assistant', text: 'Reply ok.' } })).toBe('')
  })

  it('shows the first message under a title until the host gives the last one', () => {
    expect(sessionLine(rows[0])).toBe('the build fails')
    expect(sessionLine(rows[1])).toBe('')
  })
})

describe('last messages', () => {
  const last = { role: 'assistant' as const, text: 'new' }

  it('puts each last message on its row and leaves the other rows', () => {
    const next = withLastMessages(rows, { a: last })

    expect(next[0].last).toEqual(last)
    expect(next[1]).toBe(rows[1])
  })

  it('keeps the last message on screen for a row of a new page', () => {
    const shown = [{ id: 'a', last }, { id: 'b' }]
    const page = [{ id: 'a' }, { id: 'b' }, { id: 'c', last: { role: 'user' as const, text: 'own' } }]
    const next = keepLastMessages(page, shown)

    expect(next[0].last).toEqual(last)
    expect(next[1]).toBe(page[1])
    expect(next[2]).toBe(page[2])
  })
})

describe('rowsInView', () => {
  it('keeps a row that is not archived out of the archive', () => {
    const mixed = [{ id: 'a', archived: true }, { id: 'b', pinned: true, archived: false }, { id: 'c' }]

    expect(rowsInView(mixed, 'archived').map(row => row.id)).toEqual(['a'])
    expect(rowsInView(mixed, 'current').map(row => row.id)).toEqual(['b', 'c'])
  })
})

describe('channel', () => {
  it('names a source for a person and gives it an icon', () => {
    expect(channel('api_server')).toEqual({ label: 'API', icon: 'code' })
    expect(channel('telegram').label).toBe('Telegram')
  })

  it('keeps the name of a source it does not know, readable', () => {
    expect(channel('home_assistant')).toEqual({ label: 'Home assistant', icon: 'message-circle' })
  })
})

describe('filters', () => {
  it('keeps the sources it knows and adds a new one once', () => {
    const known = ['desktop', 'mobile']

    expect(withSources(known, ['mobile', null, 'telegram', 'telegram'])).toEqual(['desktop', 'mobile', 'telegram'])
    // Nothing new: the same list, so a screen that reads it does not draw again.
    expect(withSources(known, ['desktop', undefined])).toBe(known)
  })

  it('lists every profile, or one bot', () => {
    expect(sessionListPath('current')).toContain('/api/profiles/sessions?')
    expect(sessionListPath('current')).toContain('&profile=all')
    expect(sessionListPath('current', { profile: 'backend' })).toContain('&profile=backend')
  })

  it('names the profile of a conversation of a bot, and none for the host profile', () => {
    expect(rowProfile({ profile: 'backend', is_default_profile: false })).toBe('backend')
    expect(rowProfile({ profile: 'default', is_default_profile: true })).toBeUndefined()
    expect(rowProfile({})).toBeUndefined()
  })

  it('asks the backend for one source and for the next page', () => {
    expect(sessionListPath('current', { source: 'api_server' })).toContain('&source=api_server')
    expect(sessionListPath('current', { offset: 100 })).toContain('&offset=100')
    expect(sessionListPath('current')).not.toMatch(/offset|source/)
  })

  it('adds a page under the rows and shows a row that moved only once', () => {
    expect(withSessionPage(rows, [rows[2], { id: 'd' }]).map(row => row.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('filters by words and by source', () => {
    expect(filterSessions(rows, 'LAPTOP', null).map(row => row.id)).toEqual(['c'])
    expect(filterSessions(rows, '', 'mobile').map(row => row.id)).toEqual(['b'])
    expect(filterSessions(rows, 'build', 'mobile')).toEqual([])
  })

  it('puts pinned conversations first under a heading', () => {
    expect(sessionSections(rows).map(section => [section.title, section.data.map(row => row.id)])).toEqual([
      ['Pinned', ['b']],
      ['Recent', ['a', 'c']]
    ])
    expect(sessionSections([rows[0]])).toEqual([{ title: null, data: [rows[0]] }])
    expect(sessionSections([])).toEqual([])
  })
})

describe('actions', () => {
  it('names what a tap does now', () => {
    expect(sessionActions(rows[0]).map(action => action.label)).toContain('Pin to the top')
    expect(sessionActions(rows[1]).map(action => action.label)).toContain('Unpin')
    expect(sessionActions({ id: 'x', archived: true }).find(action => action.id === 'archive')?.label).toBe('Move back to the list')
  })

  it('changes a row at once, and drops a row that leaves the view', () => {
    expect(withSessionChange(rows, 'a', { pinned: true })[0]).toMatchObject({ id: 'a', pinned: true })
    expect(withSessionChange(rows, 'a', { archived: true }).map(row => row.id)).toEqual(['b', 'c'])
    expect(withSessionChange(rows, 'a', { title: 'New' })[0].title).toBe('New')
  })

  it('makes a safe file name', () => {
    expect(exportFileName({ id: 'x', title: 'Fix: the build/now?' })).toBe('Fix-the-build-now.json')
    expect(exportFileName({ id: 'x', title: '///' })).toBe('conversation.json')
  })
})

describe('message search', () => {
  it('asks the host for the words, in one profile', () => {
    expect(sessionSearchPath(' water fall ')).toContain('q=water%20fall')
    expect(sessionSearchPath('x', { profile: 'backend', source: 'telegram' })).toMatch(/&profile=backend&source=telegram$/)
  })

  it('cuts a snippet into plain parts and matches', () => {
    expect(snippetParts('A **tall** >>>waterfall<<<\ndrops')).toEqual([
      { text: 'A tall ', hit: false },
      { text: 'waterfall', hit: true },
      { text: ' drops', hit: false }
    ])
  })

  it('adds message matches under the title matches, each conversation once', () => {
    const sections = [{ title: null, data: [{ id: 'a' }] }]
    const hits = [{ id: 'a', snippet: 'x' }, { id: 'b', snippet: 'y' }, { id: 'b', snippet: 'z' }]

    expect(withMessageHits(sections, hits).map(section => [section.title, section.data.map(row => row.id)])).toEqual([
      [null, ['a']],
      ['In messages', ['b']]
    ])
    expect(withMessageHits(sections, [])).toEqual(sections)
  })
})

describe('a conversation as Markdown', () => {
  const { sessionMarkdown, deleteGroups } = jest.requireActual('../sessions') as typeof import('../sessions')

  it('writes the title, each message under its writer, and a tool call as one line', () => {
    const text = sessionMarkdown({ id: 's1', title: 'Fix the build' }, [
      { role: 'user', text: 'why does it fail?' },
      { role: 'tool', name: 'terminal', context: 'npm test' },
      { role: 'assistant', text: 'A test is red.' },
      { role: 'assistant', text: '  ' }
    ])

    expect(text).toBe('# Fix the build\n\n## You\n\nwhy does it fail?\n\n> Tool: terminal — npm test\n\n## Hermes\n\nA test is red.\n')
  })

  it('groups the rows to delete by the profile that owns them', () => {
    const groups = deleteGroups([
      { id: 'a', profile: 'default', is_default_profile: true },
      { id: 'b', profile: 'writer', is_default_profile: false },
      { id: 'c', profile: 'writer', is_default_profile: false },
      { id: 'd' }
    ])

    expect([...groups]).toEqual([
      ['default', ['a', 'd']],
      ['writer', ['b', 'c']]
    ])
  })
})

describe('live states', () => {
  const items = [
    { session_key: 'a', status: 'working' as const },
    { session_key: 'b', status: 'idle' as const },
    { session_key: 'c', status: 'waiting' as const },
    { session_key: 'd', status: 'streaming' as const },
    { session_key: '', status: 'working' as const }
  ]

  it('names the conversations that work or wait, by stored id', () => {
    expect(liveStates(items)).toEqual({ a: 'working', c: 'waiting', d: 'working' })
    expect(liveStates([])).toEqual({})
  })

  it('tells an unchanged answer from a changed one', () => {
    expect(sameLiveStates({ a: 'working' }, { a: 'working' })).toBe(true)
    expect(sameLiveStates({ a: 'working' }, { a: 'waiting' })).toBe(false)
    expect(sameLiveStates({ a: 'working' }, {})).toBe(false)
    expect(sameLiveStates({}, { a: 'working' })).toBe(false)
  })
})
