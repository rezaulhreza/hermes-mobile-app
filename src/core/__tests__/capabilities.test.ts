import { capabilityCount, mcpRows, pluginRows, readableName, shownCapabilities, skillRows, sortedCapabilities, toolsetRows } from '../capabilities'

describe('capabilities of a bot', () => {
  it('says a key of the host in words', () => {
    expect(readableName('apple-notes')).toBe('Apple notes')
    expect(readableName('platforms/a2a')).toBe('A2a')
    expect(readableName('web_search')).toBe('Web search')
  })

  it('reads the skills', () => {
    expect(skillRows([{ name: 'apple-notes', description: 'Manage  notes.', category: 'apple', enabled: true }, { description: 'no name' }])).toEqual([
      { id: 'apple-notes', title: 'Apple notes', detail: 'Manage notes.', group: 'Apple', on: true, locked: '', guarded: false }
    ])
  })

  it('reads a skill the agent may not rewrite', () => {
    expect(skillRows([{ name: 'house-style', enabled: true, locked: true }])[0].guarded).toBe(true)
  })

  it('locks a group of tools the host cannot run', () => {
    const [web, vision] = toolsetRows([{ name: 'web', label: 'Web Search', description: 'search', enabled: true, available: true }, { name: 'vision', enabled: false, available: false }])

    expect(web).toMatchObject({ title: 'Web Search', on: true, locked: '' })
    expect(vision).toMatchObject({ title: 'Vision', on: false })
    expect(vision.locked).not.toBe('')
    expect(toolsetRows([{ name: 'code', description: 'execute_code', tools: ['execute_code'] }])[0].detail).toBe('One tool')
    expect(toolsetRows([{ name: 'web', description: 'web_search, web_extract', tools: ['a', 'b'] }])[0].detail).toBe('2 tools')
    expect(toolsetRows([{ name: 'files', description: 'read, write, patch, search', tools: ['a'] }])[0].detail).toBe('read, write, patch, search')
  })

  it('reads the MCP servers', () => {
    expect(mcpRows({ servers: [{ name: 'chrome', transport: 'http', enabled: true }, { name: 'files', transport: 'stdio', enabled: false, plugin: 'file-tools' }] })).toMatchObject([
      { id: 'chrome', title: 'Chrome', on: true, locked: '' },
      { id: 'files', on: false, locked: 'It comes with the plugin File tools.' }
    ])
  })

  it('reads the plugins and keeps the sign-in on', () => {
    const [auth, extra] = pluginRows({ plugins: [{ name: 'basic', key: 'dashboard_auth/basic', description: 'Sign-in\nmore', source: 'bundled', status: 'enabled' }, { name: 'extra', key: 'extra', source: 'git', status: 'disabled' }] })

    expect(auth).toMatchObject({ id: 'dashboard_auth/basic', detail: 'Sign-in', group: 'Comes with Hermes', on: true })
    expect(auth.locked).not.toBe('')
    expect(extra).toMatchObject({ group: 'Added to this host', on: false, locked: '' })
  })

  it('shows what is on first and finds by a word', () => {
    const items = skillRows([{ name: 'zeta', enabled: true }, { name: 'alpha', enabled: false }, { name: 'beta', enabled: true, description: 'makes charts' }])

    expect(sortedCapabilities(items).map(item => item.id)).toEqual(['beta', 'zeta', 'alpha'])
    expect(shownCapabilities(items, '').map(item => item.id)).toEqual(['zeta', 'alpha', 'beta'])
    expect(shownCapabilities(items, 'chart').map(item => item.id)).toEqual(['beta'])
    expect(capabilityCount(items)).toBe('2 of 3 on')
    expect(capabilityCount(undefined)).toBe('')
  })
})
