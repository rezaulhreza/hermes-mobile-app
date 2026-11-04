import { JsonRpcGatewayError } from '../gateway/json-rpc-channel'
import { aliasProblem, connectedCount, connectLink, connectorCards, connectorFaultWords, connectorStateWords, connectOutcome, NO_POLICY, policyRevision, readPolicy, shownConnectors } from '../connectors'

const catalog = [
  { slug: 'linear', name: 'Linear', description: 'Issues and projects', category: 'Work', logo_url: 'https://h.example/linear.png' },
  { slug: 'notion', name: 'Notion', description: 'Pages', category: 'Docs' },
  { slug: 'gmail', name: 'Gmail', description: 'Mail', category: 'Mail' }
]

const account = (id: string, connector: string, extra: object = {}) => ({ connection_id: id, connector, status: 'active' as const, label: `${id}@h.example`, active: true, created_at: '', updated_at: '', ...extra })

const row = (connector: string, extra: object = {}) => ({ connector, enabled: true, connected: true, connection_status: 'active' as const, status_reason: null, gateway_disabled_tools: [], ...extra })

describe('connected apps', () => {
  it('joins the catalog, the state and the accounts into one card per app', () => {
    const cards = connectorCards({
      catalog,
      list: [row('linear', { gateway_disabled_tools: ['delete_issue'] }), row('slack-x')],
      accounts: [account('a1', 'linear', { alias: 'work' }), account('a2', 'linear')],
      policy: NO_POLICY
    })

    const linear = cards.find(card => card.slug === 'linear')

    expect(linear).toMatchObject({ name: 'Linear', state: 'connected', toolsOff: 1, logoUrl: 'https://h.example/linear.png' })
    expect(linear?.accounts.map(known => known.title)).toEqual(['work', 'a2@h.example'])
    expect(cards.find(card => card.slug === 'notion')).toMatchObject({ state: 'available', accounts: [], logoUrl: null })
    expect(cards.find(card => card.slug === 'slack-x')).toMatchObject({ name: 'Slack X', state: 'connected' })
  })

  it('reads a state that needs the person', () => {
    const cards = connectorCards({
      catalog,
      list: [row('linear', { connection_status: 'expired', status_reason: 'Token revoked' }), row('notion', { connection_status: 'pending' }), row('gmail', { connection_status: 'failed' })],
      accounts: [],
      policy: NO_POLICY
    })

    expect(cards.map(card => [card.slug, card.state])).toEqual([
      ['linear', 'expired'],
      ['notion', 'connecting'],
      ['gmail', 'broken']
    ])
    expect(cards[0].reason).toBe('Token revoked')
  })

  it('reads the policy: off for the person, locked by the organisation', () => {
    const policy = readPolicy({
      layers: [
        { kind: 'org', revision: 'o1', body: { mode: 'deny', disabled_connectors: ['gmail'], tools: {} } },
        { kind: 'member', revision: 'm7', body: { mode: 'deny', disabled_connectors: ['notion'], tools: {} } }
      ],
      effective: { version: 1, revision: 'x', issued_at_ms: 0, mode: 'unrestricted' }
    })
    const cards = connectorCards({ catalog, list: [row('notion'), row('gmail')], accounts: [], policy })

    expect(policyRevision(policy)).toBe('m7')
    expect(policyRevision(NO_POLICY)).toBe('')
    expect(cards.find(card => card.slug === 'notion')?.state).toBe('off')
    expect(cards.find(card => card.slug === 'gmail')?.state).toBe('locked')
    expect(cards.find(card => card.slug === 'linear')?.state).toBe('available')
  })

  it('puts the apps that need the person first, and finds by name or category', () => {
    const cards = connectorCards({ catalog, list: [row('notion', { connection_status: 'expired' }), row('gmail')], accounts: [], policy: NO_POLICY })

    expect(shownConnectors(cards, '').map(card => card.slug)).toEqual(['notion', 'gmail', 'linear'])
    expect(shownConnectors(cards, 'work').map(card => card.slug)).toEqual(['linear'])
    expect(connectedCount(cards)).toBe(1)
    expect(connectedCount(null)).toBe(0)
  })

  it('says a state in words', () => {
    expect(connectorStateWords({ state: 'connected', accounts: [], toolsOff: 0 })).toBe('Connected')
    expect(connectorStateWords({ state: 'connected', accounts: [{}, {}] as never, toolsOff: 2 })).toBe('2 accounts · 2 tools off')
    expect(connectorStateWords({ state: 'locked', accounts: [], toolsOff: 0 })).toBe('Turned off by your organisation')
  })

  it('follows a sign-in', () => {
    const target = { name: 'linear', kind: 'connector' as const, action: 'connect' as const }

    expect(connectLink({ targets: [{ ...target, state: 'pending' }] })).toBeNull()
    expect(connectLink({ targets: [{ ...target, state: 'initiated', connect_url: 'https://h.example/auth' }] })).toBe('https://h.example/auth')
    expect(connectOutcome({ targets: [{ ...target, state: 'initiated' }], settled: false })).toBe('waiting')
    expect(connectOutcome({ targets: [{ ...target, state: 'connected' }], settled: true })).toBe('connected')
    expect(connectOutcome({ targets: [{ ...target, state: 'failed' }], settled: true, settled_by: 'all_resolved' })).toBe('failed')
    expect(connectOutcome({ targets: [{ ...target, state: 'initiated' }], settled: true, settled_by: 'deadline' })).toBe('expired')
  })

  it('checks the name of a second account', () => {
    const accounts = [{ id: 'a', title: 'work', alias: 'work', label: '', active: true, state: 'active' as const, reason: '' }]

    expect(aliasProblem('  ', accounts)).toContain('Give the account a name')
    expect(aliasProblem('Work', accounts)).toContain('has this name already')
    expect(aliasProblem('home', accounts)).toBeNull()
  })

  it('says a refusal of the host in words', () => {
    expect(connectorFaultWords(new JsonRpcGatewayError('x', { code: -32000, data: { reason: 'NEEDS_NOUS_AUTH' } }))).toContain('Sign in to Nous')
    expect(connectorFaultWords(new JsonRpcGatewayError('x', { data: { reason: 'TOOLS_UNAVAILABLE' } }))).toBeNull()
    expect(connectorFaultWords(new Error('plain'))).toBeNull()
  })
})
