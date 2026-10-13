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

describe('sections and group chats of the Bots list', () => {
  const { botGroups, botRows, groupRooms, knownSections } = jest.requireActual('../bots') as typeof import('../bots')
  const meta = (value: Record<string, unknown>) => ({ 'hermes-bots': value })
  const profiles = [
    { name: 'default', is_default: true, ui_meta: { ...meta({ title: 'Manager', pinned: true, sectionId: 's1', sectionName: 'Front' }), 'hermes-bots-groups': { rooms: { 'id:r1': { name: 'Launch', roomId: 'r1', omitted: 4, members: [{ name: 'default' }, { name: 'qa' }], log: [{ id: 'a', from: { kind: 'user', name: 'me' }, text: 'Go', at: 10 }, { id: 'b', from: { kind: 'member', name: 'qa' }, text: 'Done', at: 20 }, { from: { kind: 'member', name: 'qa' }, text: '  ' }] } } } } },
    { name: 'qa', ui_meta: meta({ title: 'QA', sectionId: 's2', sectionName: 'Check', groups: ['Launch'] }) },
    { name: 'writer', ui_meta: meta({ sectionId: 's1', sectionName: 'Front' }) },
    { name: 'loose' },
    { name: 'old', ui_meta: meta({ hidden: true, sectionId: 's2', sectionName: 'Check' }) }
  ] as never[]
  const bots = botRows(profiles, 0)

  it('takes the name the user gave a bot', () => {
    expect(bots.find(bot => bot.name === 'qa')?.title).toBe('QA')
    expect(bots.find(bot => bot.name === 'writer')?.title).toBe('Writer')
  })

  it('files the bots: pinned, each section, no section, put away', () => {
    expect(botGroups(bots).map(group => [group.title, group.bots.map(bot => bot.name)])).toEqual([
      ['Pinned', ['default']],
      ['Check', ['qa']],
      ['Front', ['writer']],
      ['No section', ['loose']],
      ['Put away', ['old']]
    ])
  })

  it('has no heading when nothing is filed', () => {
    expect(botGroups(botRows([{ name: 'a' }, { name: 'b' }] as never[], 0)).map(group => group.title)).toEqual([''])
  })

  it('lists the sections the user made', () => {
    expect(knownSections(bots)).toEqual([{ id: 's2', name: 'Check' }, { id: 's1', name: 'Front' }])
  })

  it('reads the group chats from the main profile', () => {
    expect(groupRooms(profiles)).toEqual([
      { id: 'r1', name: 'Launch', members: ['default', 'qa'], omitted: 4, messages: [{ id: 'a', from: 'me', mine: true, text: 'Go', at: 10 }, { id: 'b', from: 'qa', mine: false, text: 'Done', at: 20 }] }
    ])
    expect(groupRooms([{ name: 'default', is_default: true }] as never[])).toEqual([])
  })
})
