import { botInitials, botNameProblem, botRows, botSlug, filterBots } from '../bots'

const NOW = 10_000

const rows = botRows(
  [
    { name: 'writer', path: '/p/writer', description: ' Writes the docs. ', model: 'm', canonical_session: { id: 'a', resolved_id: 'a2', last_active: 500, preview: 'Draft\n done' } },
    { name: 'setup-tmp', path: '/p/s', role: 'setup' },
    { name: 'backend', path: '/p/backend', worker_session: { id: 'w', last_active: NOW - 30 } },
    { name: 'default', path: '/p', is_default: true, display_name: 'manager', has_avatar: true, skill_count: 12 },
    { name: 'idle', path: '/p/idle', worker_session: { id: 'w', last_active: NOW - 900 } }
  ],
  NOW
)

describe('botRows', () => {
  it('puts the main bot first, then the ones at work, then the newest', () => {
    expect(rows.map(bot => bot.name)).toEqual(['default', 'backend', 'idle', 'writer'])
  })

  it('leaves out a profile that only finishes a setup', () => {
    expect(rows.some(bot => bot.name === 'setup-tmp')).toBe(false)
  })

  it('reads the name a person sees, the chat and the state', () => {
    expect(rows[0]).toMatchObject({ title: 'Manager', isDefault: true, hasAvatar: true, skillCount: 12, chatId: null })
    expect(rows[1]).toMatchObject({ working: true })
    expect(rows[2]).toMatchObject({ working: false })
    expect(rows[3]).toMatchObject({ title: 'Writer', description: 'Writes the docs.', chatId: 'a2', preview: 'Draft done', lastActive: 500 })
  })

  it('finds a bot by its role', () => {
    expect(filterBots(rows, 'docs').map(bot => bot.name)).toEqual(['writer'])
  })
})

describe('a new bot', () => {
  it('stores a typed name as a slug', () => {
    expect(botSlug('  Release Notes_Writer! ')).toBe('release-notes-writer')
  })

  it('refuses an empty, taken or reserved name', () => {
    expect(botNameProblem('!!!', [])).toContain('letters or digits')
    expect(botNameProblem('Back End', ['back-end'])).toContain('exists already')
    expect(botNameProblem('Default', [])).toContain('main profile')
    expect(botNameProblem('x'.repeat(60), [])).toContain('too long')
    expect(botNameProblem('Researcher', ['writer'])).toBeNull()
  })

  it('makes initials for a bot with no picture', () => {
    expect(botInitials('Release writer')).toBe('RW')
    expect(botInitials('Backend')).toBe('BA')
  })
})
