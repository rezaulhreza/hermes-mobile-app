import { botInitials, botNameProblem, botRows, botSlug, filterBots, roomMembersProblem, roomRow, withRoom, groupRooms } from '../bots'

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
  const { botGroups, botRows, filingOf, groupRooms, knownSections } = jest.requireActual('../bots') as typeof import('../bots')
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

  const titles = (groups: ReturnType<typeof botGroups>) => groups.map(group => [group.title, group.rows.map(row => (row.kind === 'bot' ? row.bot.name : `room ${row.room.name}`))])
  const rooms = groupRooms(profiles)

  it('files the bots: pinned, each section, unassigned, put away', () => {
    expect(titles(botGroups(bots))).toEqual([
      ['Pinned', ['default']],
      ['Check', ['qa']],
      ['Front', ['writer']],
      ['Unassigned', ['loose']],
      ['Put away', ['old']]
    ])
  })

  it('has no heading when nothing is filed', () => {
    expect(botGroups(botRows([{ name: 'a' }, { name: 'b' }] as never[], 0)).map(group => group.title)).toEqual([''])
  })

  it('gives the group chats and the bots a heading each when no section exists', () => {
    expect(titles(botGroups(botRows([{ name: 'a' }] as never[], 0), rooms))).toEqual([
      ['Group chats', ['room Launch']],
      ['Bots', ['a']]
    ])
  })

  it('leaves a group chat in no section under Unassigned, before the bots', () => {
    expect(titles(botGroups(bots, rooms)).find(([title]) => title === 'Unassigned')).toEqual(['Unassigned', ['room Launch', 'loose']])
  })

  it('files a group chat under its section, and shows a section with nothing in it', () => {
    const filing = { sections: [{ id: 's9', name: 'Later' }], rooms: { r1: 's1' } }

    expect(titles(botGroups(bots, rooms, filing))).toEqual([
      ['Pinned', ['default']],
      ['Check', ['qa']],
      ['Front', ['room Launch', 'writer']],
      ['Later', []],
      ['Unassigned', ['loose']],
      ['Put away', ['old']]
    ])
  })

  it('puts a group chat of a section that is gone under Unassigned', () => {
    expect(titles(botGroups(bots, rooms, { sections: [], rooms: { r1: 'gone' } })).find(([title]) => title === 'Unassigned')?.[1]).toContain('room Launch')
  })

  it('lists the sections the user made, with the name the bots carry', () => {
    expect(knownSections(bots)).toEqual([{ id: 's2', name: 'Check' }, { id: 's1', name: 'Front' }])
    expect(knownSections(bots, [{ id: 's1', name: 'Old name' }, { id: 's9', name: 'Later' }])).toEqual([{ id: 's2', name: 'Check' }, { id: 's1', name: 'Front' }, { id: 's9', name: 'Later' }])
  })

  it('reads what the phone filed from the main profile, and drops what is broken', () => {
    const stored = { sections: [{ id: 's9', name: ' Later ' }, { id: 's9', name: 'Twice' }, { id: '', name: 'No id' }, 'text'], rooms: { r1: 's9', r2: 4, r3: '' } }

    expect(filingOf([{ name: 'default', is_default: true, ui_meta: { 'hermes-native-filing': stored } }] as never[])).toEqual({ sections: [{ id: 's9', name: 'Later' }], rooms: { r1: 's9' } })
    expect(filingOf(profiles)).toEqual({ sections: [], rooms: {} })
  })

  it('reads the group chats from the main profile', () => {
    expect(groupRooms(profiles)).toEqual([
      { id: 'r1', name: 'Launch', members: ['default', 'qa'], handles: {}, omitted: 4, messages: [{ id: 'a', from: 'me', mine: true, text: 'Go', at: 10 }, { id: 'b', from: 'qa', mine: false, text: 'Done', at: 20 }] }
    ])
    expect(groupRooms([{ name: 'default', is_default: true }] as never[])).toEqual([])
  })
})

describe('a room read again', () => {
  const room = (id: string, name: string) => ({ id, name, members: [], handles: {}, messages: [], omitted: 0 })

  it('reads the answer of the host for one room', () => {
    expect(roomRow('id:r1', { room_id: 'r1', name: ' Launch ', members: [{ name: 'qa', handle: 'qa-bot' }], log: [{ id: 'a', from: { kind: 'user', name: 'You' }, text: 'Go', at: 5 }] })).toEqual({
      id: 'r1',
      name: 'Launch',
      members: ['qa'],
      handles: { qa: 'qa-bot' },
      messages: [{ id: 'a', from: 'You', mine: true, text: 'Go', at: 5 }],
      omitted: 0
    })
    expect(roomRow('id:r2', { name: ' ' })).toBeNull()
  })

  it('marks a message the host cut, and takes the mark of the host out of its words', () => {
    const { messages } = roomRow('id:r1', { name: 'Launch', log: [{ id: 'a', text: 'A long answer… [truncated]', at: 1 }, { id: 'b', text: 'Short', at: 2 }] })!

    expect(messages.map(message => [message.text, message.cut])).toEqual([['A long answer…', true], ['Short', undefined]])
  })

  it('keeps the thread of a message', () => {
    const { messages } = roomRow('id:r1', { name: 'Launch', log: [{ id: 'a', text: 'Go', at: 1, thread: 't1' }, { id: 'b', text: 'Old', at: 2, thread: '' }] })!

    expect(messages.map(message => message.thread)).toEqual(['t1', undefined])
  })

  it('takes the place of its older copy, or goes first', () => {
    expect(withRoom([room('a', 'A'), room('b', 'B')], room('b', 'B2')).map(item => item.name)).toEqual(['A', 'B2'])
    expect(withRoom([room('a', 'A')], room('c', 'C')).map(item => item.name)).toEqual(['C', 'A'])
  })

  it('says why a count of members cannot be a room', () => {
    expect(roomMembersProblem(1)).toMatch(/at least 2/)
    expect(roomMembersProblem(7)).toMatch(/at most 6/)
    expect(roomMembersProblem(3)).toBeNull()
  })
})

describe('a group that only the bots name', () => {
  const bot = (name: string, groups: string[], extra: Record<string, unknown> = {}) => ({ name, ui_meta: { 'hermes-bots': { groups }, ...extra } })

  it('shows beside the rooms of the record, with the bots that name it', () => {
    const rooms = groupRooms([
      { ...bot('default', ['Launch', 'Plans'], { 'hermes-bots-groups': { rooms: { 'id:r1': { name: 'Launch', roomId: 'r1', members: [{ name: 'default' }], log: [] } } } }), is_default: true },
      bot('qa', ['Plans']),
      bot('ops', [])
    ] as never)

    expect(rooms.map(room => [room.id, room.name, room.members, Boolean(room.unmade)])).toEqual([
      ['r1', 'Launch', ['default'], false],
      ['name:Plans', 'Plans', ['default', 'qa'], true]
    ])
  })

  it('stays away when the group was closed', () => {
    const rooms = groupRooms([{ ...bot('default', ['Old'], { 'hermes-bots-groups': { rooms: {}, deleted: { 'name:Old': 4 } } }), is_default: true }] as never)

    expect(rooms).toEqual([])
  })
})
