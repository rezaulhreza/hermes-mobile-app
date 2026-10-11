import {
  activeWorkspace,
  EMPTY_WORKSPACES,
  linkProblem,
  normaliseBaseUrl,
  parseWorkspaceList,
  removeWorkspace,
  upsertWorkspace,
  workspaceFromDraft,
  wsOriginFor
} from '../workspaces'

const draft = { kind: 'cloudflare' as const, baseUrl: 'hermes.example.com/', username: ' reza ', password: 'pw' }

describe('normaliseBaseUrl', () => {
  it('adds https to a bare host and drops the trailing slash', () => {
    expect(normaliseBaseUrl(' hermes.example.com/ ')).toBe('https://hermes.example.com')
  })

  it('keeps an explicit http address with a port, for a LAN backend', () => {
    expect(normaliseBaseUrl('http://192.168.1.20:9130')).toBe('http://192.168.1.20:9130')
  })

  it('refuses text that is not an http address', () => {
    expect(normaliseBaseUrl('')).toBeNull()
    expect(normaliseBaseUrl('ftp://host')).toBeNull()
  })
})

describe('workspaceFromDraft', () => {
  it('builds a workspace labelled by its host', () => {
    const result = workspaceFromDraft(draft, 'a')

    expect(result).toEqual({
      ok: true,
      workspace: { id: 'a', kind: 'cloudflare', label: 'hermes.example.com', baseUrl: 'https://hermes.example.com', username: 'reza', password: 'pw', headers: {} }
    })
  })

  it('turns an Access service token into the two proxy headers', () => {
    const result = workspaceFromDraft({ ...draft, accessClientId: 'id', accessClientSecret: 'secret' }, 'a')

    expect(result.ok && result.workspace.headers).toEqual({ 'CF-Access-Client-Id': 'id', 'CF-Access-Client-Secret': 'secret' })
  })

  it('refuses half of a service token and names the missing field', () => {
    expect(workspaceFromDraft({ ...draft, accessClientId: 'id' }, 'a')).toMatchObject({ ok: false, field: 'accessClientSecret' })
  })

  it('gives a private-network address http, because Hermes has no certificate there', () => {
    const lan = workspaceFromDraft({ ...draft, kind: 'lan', baseUrl: '192.168.1.20:9130' }, 'a')
    const tail = workspaceFromDraft({ ...draft, kind: 'tailscale', baseUrl: 'my-mac.tailnet.ts.net:9130' }, 'a')

    expect(lan.ok && lan.workspace.baseUrl).toBe('http://192.168.1.20:9130')
    expect(tail.ok && tail.workspace.baseUrl).toBe('http://my-mac.tailnet.ts.net:9130')
  })

  it('keeps a scheme the user typed, whatever the connection kind', () => {
    const result = workspaceFromDraft({ ...draft, kind: 'tailscale', baseUrl: 'https://my-mac.tailnet.ts.net' }, 'a')

    expect(result.ok && result.workspace.baseUrl).toBe('https://my-mac.tailnet.ts.net')
  })

  it('does not carry proxy headers to a connection kind that has no proxy', () => {
    const result = workspaceFromDraft({ ...draft, kind: 'lan', baseUrl: '10.0.0.2:9130', accessClientId: 'id', accessClientSecret: 's' }, 'a')

    expect(result.ok && result.workspace.headers).toEqual({})
  })

  it('names the first missing field', () => {
    expect(workspaceFromDraft({ ...draft, baseUrl: '' }, 'a')).toMatchObject({ ok: false, field: 'baseUrl' })
    expect(workspaceFromDraft({ ...draft, password: '' }, 'a')).toMatchObject({ ok: false, field: 'password' })
  })
})

describe('workspace list', () => {
  const make = (id: string) => {
    const result = workspaceFromDraft(draft, id)

    if (!result.ok) {
      throw new Error('fixture')
    }

    return result.workspace
  }

  it('makes an added workspace the active one', () => {
    const list = upsertWorkspace(upsertWorkspace(EMPTY_WORKSPACES, make('a')), make('b'))

    expect(activeWorkspace(list)?.id).toBe('b')
    expect(list.workspaces).toHaveLength(2)
  })

  it('falls back to a remaining workspace when the active one is removed', () => {
    const list = removeWorkspace(upsertWorkspace(upsertWorkspace(EMPTY_WORKSPACES, make('a')), make('b')), 'b')

    expect(activeWorkspace(list)?.id).toBe('a')
    expect(activeWorkspace(removeWorkspace(list, 'a'))).toBeNull()
  })

  it('survives a round trip through storage', () => {
    const list = upsertWorkspace(EMPTY_WORKSPACES, make('a'))

    expect(parseWorkspaceList(JSON.stringify(list))).toEqual(list)
  })

  it('drops malformed stored entries instead of dialling them', () => {
    const raw = JSON.stringify({
      activeId: 'gone',
      workspaces: [{ id: 'a', baseUrl: 'javascript:alert(1)' }, { id: 'b', kind: 'nonsense', baseUrl: 'https://ok.example', headers: { X: 1, Y: 'y' } }, 7]
    })

    const list = parseWorkspaceList(raw)

    expect(list.workspaces.map(w => w.id)).toEqual(['b'])
    expect(list.workspaces[0].headers).toEqual({ Y: 'y' })
    expect(list.workspaces[0].kind).toBe('other')
    expect(list.activeId).toBe('b')
    expect(parseWorkspaceList('not json')).toEqual(EMPTY_WORKSPACES)
  })
})

it('maps the base URL to the matching WebSocket origin', () => {
  expect(wsOriginFor('https://hermes.example.com')).toBe('wss://hermes.example.com')
  expect(wsOriginFor('http://10.0.0.2:9130')).toBe('ws://10.0.0.2:9130')
})

describe('linkProblem', () => {
  it('says in plain words that the host does not answer', () => {
    expect(linkProblem('502: <html><head><title>502 Bad Gateway</title></head></html>')).toContain('does not answer')
    expect(linkProblem('530: error code: 1033')).toContain('does not answer')
  })

  it('says that the phone has no way to the host', () => {
    expect(linkProblem('Network request failed')).toContain('cannot reach')
    expect(linkProblem('Aborted')).toContain('cannot reach')
  })

  it('keeps a short sentence, and hides markup and long raw text', () => {
    expect(linkProblem('Sign-in was refused for this user.')).toBe('Sign-in was refused for this user.')
    expect(linkProblem('{"detail":"x"}')).toBe('The link to Hermes is down. The app tries again by itself.')
    expect(linkProblem(null)).toBeNull()
  })
})
