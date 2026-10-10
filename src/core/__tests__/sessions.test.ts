import {
  exportFileName,
  rowsInView,
  filterSessions,
  sessionActions,
  sessionListPath,
  sessionPreview,
  sessionSections,
  sessionTitle,
  sourceChoices,
  withSessionChange
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

describe('filters', () => {
  it('lists the sources, most used first, only when there is a choice', () => {
    expect(sourceChoices(rows)).toEqual(['desktop', 'mobile'])
    expect(sourceChoices([rows[0], rows[2]])).toEqual([])
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
