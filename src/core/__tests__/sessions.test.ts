import {
  channel,
  exportFileName,
  rowProfile,
  rowsInView,
  filterSessions,
  sessionActions,
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
