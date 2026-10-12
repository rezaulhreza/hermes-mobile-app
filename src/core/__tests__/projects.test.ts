import { folderLine, projectChoices, projectRows } from '../projects'

const tree = {
  projects: [
    { id: '__no_project__', label: 'Home', isNoProject: true, sessionCount: 9, lastActive: 900 },
    { id: '/Users/me/code/app', label: 'app', path: '/Users/me/code/app', isAuto: true, sessionCount: 2, lastActive: 100 },
    { id: 'p1', label: 'Site', path: '/Users/me/site', sessionCount: 3, lastActive: 500 },
    { id: 'p2', label: 'Empty', path: '/Users/me/empty', sessionCount: 0 }
  ]
}

describe('projectChoices', () => {
  it('lists the projects with a conversation, the most recent first and Home last', () => {
    expect(projectChoices(tree).map(choice => [choice.label, choice.count, choice.home])).toEqual([
      ['Site', 3, false],
      ['app', 2, false],
      ['Home', 9, true]
    ])
  })

  it('is empty with no tree', () => {
    expect(projectChoices(null)).toEqual([])
  })
})

describe('projectRows', () => {
  it('gives the rows of the chat list, the newest first, each once', () => {
    const rows = projectRows({
      id: 'p1',
      label: 'Site',
      previewSessions: [
        { id: 'a', title: 'Old', last_active: 10, profile: 'default' } as never,
        { id: 'b', title: 'New', last_active: 20, profile: 'writer', model: 'm', input_tokens: 5 } as never,
        { id: 'a', title: 'Old again', last_active: 30 } as never
      ]
    })

    expect(rows.map(row => [row.id, row.title, row.profile, row.is_default_profile])).toEqual([
      ['b', 'New', 'writer', false],
      ['a', 'Old', 'default', true]
    ])
    expect(Object.keys(rows[0])).not.toContain('input_tokens')
  })

  it('is empty for a project that is gone', () => {
    expect(projectRows(null)).toEqual([])
  })
})

describe('folderLine', () => {
  it('shows the last two folders of a path of any host', () => {
    expect(folderLine('/Users/me/code/app')).toBe('code/app')
    expect(folderLine('C:\\Users\\me\\site')).toBe('me/site')
    expect(folderLine(null)).toBe('')
  })
})
