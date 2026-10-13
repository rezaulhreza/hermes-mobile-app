import { type FetchLike, HermesApi, HttpError, isAuthRejection, ProxyPageError, SignInError } from '../api'
import type { Workspace } from '../workspaces'

const workspace: Workspace = {
  id: 'a',
  kind: 'cloudflare',
  label: 'a',
  baseUrl: 'https://hermes.example.com',
  username: 'me',
  password: 'pw',
  headers: { 'CF-Access-Client-Id': 'id' }
}

interface Call {
  url: string
  init?: RequestInit
}

function fake(responses: { status: number; body: string }[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  const queue = [...responses]

  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })

      const next = queue.shift()

      if (!next) {
        throw new Error('unexpected request')
      }

      return { ok: next.status >= 200 && next.status < 300, status: next.status, text: async () => next.body } as Response
    }
  }
}

const NO_COOKIE = { status: 401, body: '{"reason":"no_cookie","login_url":"/login"}' }

describe('HermesApi.request', () => {
  it('sends the proxy headers and the profile scope on every call', async () => {
    const { fetch, calls } = fake([{ status: 200, body: '{"ok":true}' }])

    await expect(new HermesApi(workspace, fetch).request({ path: 'api/status', profile: 'work' })).resolves.toEqual({ ok: true })
    expect(calls[0].url).toBe('https://hermes.example.com/api/status?profile=work')
    expect((calls[0].init?.headers as Record<string, string>)['CF-Access-Client-Id']).toBe('id')
  })

  it('signs in once on a missing-cookie refusal and replays the call', async () => {
    const { fetch, calls } = fake([NO_COOKIE, { status: 200, body: '{}' }, { status: 200, body: '{"n":1}' }])

    await expect(new HermesApi(workspace, fetch).request({ path: '/api/x' })).resolves.toEqual({ n: 1 })
    expect(calls.map(c => c.url.replace(workspace.baseUrl, ''))).toEqual(['/api/x', '/auth/password-login', '/api/x'])
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ provider: 'basic', username: 'me', password: 'pw', next: '/' })
  })

  it('does not loop when the refusal repeats after a sign-in', async () => {
    const { fetch, calls } = fake([NO_COOKIE, { status: 200, body: '{}' }, NO_COOKIE])
    const error = await new HermesApi(workspace, fetch).request({ path: '/api/x' }).catch(e => e)

    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(401)
    expect(calls).toHaveLength(3)
    expect(isAuthRejection(error)).toBe(true)
  })

  it('does not sign in for a 401 that is not about the cookie', async () => {
    const { fetch, calls } = fake([{ status: 401, body: '{"reason":"forbidden"}' }])

    await expect(new HermesApi(workspace, fetch).request({ path: '/api/x' })).rejects.toBeInstanceOf(HttpError)
    expect(calls).toHaveLength(1)
  })

  it('reports an access proxy page as a proxy problem, not as bad JSON', async () => {
    const { fetch } = fake([{ status: 200, body: '<!doctype html><title>Sign in</title>' }])

    await expect(new HermesApi(workspace, fetch).request({ path: '/api/x' })).rejects.toBeInstanceOf(ProxyPageError)
  })
})

describe('HermesApi.signIn', () => {
  it('says the credentials were refused on a 401', async () => {
    const { fetch } = fake([{ status: 401, body: '{}' }])
    const error = await new HermesApi(workspace, fetch).signIn().catch(e => e)

    expect(error).toBeInstanceOf(SignInError)
    expect(isAuthRejection(error)).toBe(true)
  })

  it('says the address is unreachable when the request never lands', async () => {
    const api = new HermesApi(workspace, async () => {
      throw new TypeError('Network request failed')
    })

    await expect(api.signIn()).rejects.toThrow(/Could not reach/)
  })
})

it('reads a ticket from either response shape', async () => {
  await expect(new HermesApi(workspace, fake([{ status: 200, body: '{"ticket":"t1"}' }]).fetch).wsTicket()).resolves.toBe('t1')
  await expect(new HermesApi(workspace, fake([{ status: 200, body: '"t2"' }]).fetch).wsTicket()).resolves.toBe('t2')
  await expect(new HermesApi(workspace, fake([{ status: 200, body: '{}' }]).fetch).wsTicket()).rejects.toThrow(/ticket/)
})
