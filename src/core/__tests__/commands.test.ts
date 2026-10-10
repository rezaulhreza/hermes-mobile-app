import { commandSections, filterCommandSections, phoneAction, phoneBlock, phoneCompletions } from '../commands'
import type { CommandsCatalogResult } from '../gateway/gateway-contract.generated'

const catalog: CommandsCatalogResult = {
  canon: { '/ctx': '/context', '/bye': '/quit', '/term': '/shellonly' },
  commands: {
    '/context': { desktop: null },
    '/shellonly': { desktop: 'terminal' },
    '/term': { desktop: 'terminal' },
    '/model': { desktop: 'hidden' }
  },
  categories: [
    { name: 'Session', pairs: [['/new', 'Start a new chat'], ['/quit', 'Leave'], ['/context', 'Show the context']] },
    { name: 'Display', pairs: [['/redraw', 'Draw again'], ['/skin', 'Change the theme']] }
  ],
  pairs: [['/new', 'Start a new chat'], ['/work', 'Do the work'], ['/context', 'Show the context']],
  skills: { '/work': { usage: 3 } }
}

describe('phoneBlock', () => {
  it('refuses terminal and desktop commands before the catalog answers', () => {
    expect(phoneBlock('/quit')).toMatch(/terminal/)
    expect(phoneBlock('/REDRAW')).toMatch(/terminal/)
    expect(phoneBlock('/paste')).toMatch(/terminal/)
    expect(phoneBlock('/compose')).toMatch(/desktop/)
  })

  it('reads the reason for an unknown command from the catalog, also through an alias', () => {
    expect(phoneBlock('/shellonly')).toBeNull()
    expect(phoneBlock('/shellonly', catalog)).toMatch(/terminal/)
    expect(phoneBlock('/bye', catalog)).toMatch(/terminal/)
  })

  it('lets through commands that run on a phone', () => {
    expect(phoneBlock('/context', catalog)).toBeNull()
    expect(phoneBlock('/work fix it', catalog)).toBeNull()
    // The registry hides /model from lists; the phone opens its own sheet.
    expect(phoneBlock('/model', catalog)).toBeNull()
    // The registry calls /clear terminal-only; the phone runs it as a new chat.
    expect(phoneBlock('/clear', catalog)).toBeNull()
  })
})

describe('phoneAction', () => {
  it('names the commands the app runs itself, by any alias', () => {
    expect(phoneAction('/new')).toBe('new')
    expect(phoneAction('/clear')).toBe('new')
    expect(phoneAction('/fork a name')).toBe('branch')
    expect(phoneAction('/q later')).toBe('queue')
    expect(phoneAction('/context')).toBeNull()
  })
})

describe('phoneCompletions', () => {
  it('drops blocked commands and keeps arguments and paths', () => {
    const items = [{ text: '/quit' }, { text: '/queue' }, { text: 'high' }, { text: '@src/' }]

    expect(phoneCompletions(items, catalog).map(item => item.text)).toEqual(['/queue', 'high', '@src/'])
  })
})

describe('commandSections', () => {
  it('lists the categories and the skills without blocked commands or empty sections', () => {
    expect(commandSections(catalog)).toEqual([
      {
        name: 'Session',
        data: [
          { command: '/new', description: 'Start a new chat' },
          { command: '/context', description: 'Show the context' }
        ]
      },
      { name: 'Skills', data: [{ command: '/work', description: 'Do the work' }] }
    ])
    expect(commandSections(null)).toEqual([])
  })

  it('filters by name or description', () => {
    const sections = commandSections(catalog)

    expect(filterCommandSections(sections, '/wor').map(section => section.name)).toEqual(['Skills'])
    expect(filterCommandSections(sections, 'context')[0].data).toHaveLength(1)
    expect(filterCommandSections(sections, '')).toEqual(sections)
  })
})
