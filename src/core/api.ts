/**
 * REST transport for one workspace.
 *
 * React Native's fetch is a native request: it has no origin policy and it
 * keeps cookies in the system cookie store. The Hermes session cookie that
 * `/auth/password-login` sets therefore rides on every later call without any
 * code here. That is the whole reason this app does not need a WebView.
 *
 * Two contracts are kept from the desktop transport, because callers classify
 * on them:
 *
 * 1. A non-2xx response throws `HttpError` with `.status`. 401 and 403 mean
 *    "sign in again", never "retry".
 * 2. A `401 {"reason":"no_cookie"}` is answered ONCE with a sign-in and a
 *    replay. A second 401 is the backend's final answer.
 */

import type { Workspace } from './workspaces'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ApiRequest {
  path: string
  method?: string
  body?: unknown
  /** Profile scope: sent as `?profile=`. */
  profile?: string | null
  timeoutMs?: number
}

export class HttpError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`${status}: ${body}`)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

/** The backend answered with an HTML page: an access proxy stands in front of Hermes and refused the request. */
export class ProxyPageError extends Error {
  constructor() {
    super(
      'The address answered with a web page, not with Hermes. If your Hermes is behind Cloudflare Access, add the Access client ID and secret.'
    )
    this.name = 'ProxyPageError'
  }
}

export class SignInError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignInError'
  }
}

const DEFAULT_TIMEOUT_MS = 30_000

export class HermesApi {
  constructor(
    readonly workspace: Workspace,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  private headers(): Record<string, string> {
    return { accept: 'application/json', 'x-requested-with': 'hermes-mobile', ...this.workspace.headers }
  }

  private url(request: ApiRequest): string {
    const path = request.path.startsWith('/') ? request.path : `/${request.path}`
    const url = `${this.workspace.baseUrl}${path}`

    if (!request.profile) {
      return url
    }

    return `${url}${url.includes('?') ? '&' : '?'}profile=${encodeURIComponent(request.profile)}`
  }

  /**
   * Sign in to the password provider. `provider` is required: without it the
   * backend answers 422, which reads like bad input and is not.
   */
  async signIn(): Promise<void> {
    let response: Response

    try {
      response = await this.fetchImpl(`${this.workspace.baseUrl}/auth/password-login`, {
        method: 'POST',
        headers: { ...this.headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'basic',
          username: this.workspace.username,
          password: this.workspace.password,
          next: '/'
        })
      })
    } catch {
      throw new SignInError('Could not reach that address. Check the address and your network.')
    }

    const text = await response.text()

    if (looksLikeHtml(text)) {
      throw new ProxyPageError()
    }

    if (response.status === 401 || response.status === 403) {
      throw new SignInError('Hermes refused that username and password.')
    }

    if (!response.ok) {
      throw new SignInError(`Hermes answered ${response.status} to the sign-in.`)
    }
  }

  /** Revoke the session on the backend. Returns false when the backend did not confirm. */
  async signOut(): Promise<boolean> {
    try {
      const response = await this.fetchImpl(`${this.workspace.baseUrl}/auth/logout`, {
        method: 'POST',
        headers: this.headers()
      })

      return response.ok
    } catch {
      return false
    }
  }

  async request<T>(request: ApiRequest): Promise<T> {
    let signedIn = false

    for (;;) {
      const { status, text } = await this.send(request)

      if (status >= 200 && status < 300) {
        return (text ? JSON.parse(text) : undefined) as T
      }

      if (status === 401 && !signedIn && isCookieRefusal(text)) {
        signedIn = true
        await this.signIn()

        continue
      }

      throw new HttpError(status, text)
    }
  }

  /**
   * Send a file of the phone as a multipart stream. `file` is a file object of
   * the system (it reads the bytes itself: they never pass through
   * JavaScript), so this module needs no native code.
   */
  async upload<T>(path: string, fields: Record<string, string>, file: Blob, name: string, timeoutMs: number): Promise<T> {
    let signedIn = false

    for (;;) {
      const form = new FormData()

      for (const [name, value] of Object.entries(fields)) {
        form.append(name, value)
      }

      form.append('file', file, name)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const response = await this.fetchImpl(`${this.workspace.baseUrl}${path}`, { method: 'POST', headers: this.headers(), body: form, signal: controller.signal })
        const text = await response.text()

        if (looksLikeHtml(text)) {
          throw new ProxyPageError()
        }

        if (response.ok) {
          return (text ? JSON.parse(text) : undefined) as T
        }

        if (response.status === 401 && !signedIn && isCookieRefusal(text)) {
          signedIn = true
          await this.signIn()

          continue
        }

        throw new HttpError(response.status, text)
      } finally {
        clearTimeout(timer)
      }
    }
  }

  private async send(request: ApiRequest): Promise<{ status: number; text: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const headers = this.headers()
    const init: RequestInit = { method: (request.method ?? 'GET').toUpperCase(), headers, signal: controller.signal }

    if (request.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(request.body)
    }

    try {
      const response = await this.fetchImpl(this.url(request), init)
      const text = await response.text()

      if (looksLikeHtml(text)) {
        throw new ProxyPageError()
      }

      return { status: response.status, text }
    } finally {
      clearTimeout(timer)
    }
  }

  /** A single-use WebSocket ticket (30 s lifetime). Mint one for every dial. */
  async wsTicket(profile?: string | null): Promise<string> {
    const response = await this.request<{ ticket?: unknown } | string>({
      path: '/api/auth/ws-ticket',
      method: 'POST',
      profile
    })

    const ticket = typeof response === 'string' ? response : response?.ticket

    if (typeof ticket !== 'string' || !ticket) {
      throw new Error('Hermes did not return a WebSocket ticket.')
    }

    return ticket
  }
}

function looksLikeHtml(text: string): boolean {
  return text.trimStart().startsWith('<')
}

function isCookieRefusal(body: string): boolean {
  try {
    return (JSON.parse(body) as { reason?: string })?.reason === 'no_cookie'
  } catch {
    return false
  }
}

/** True when the error means the stored credentials no longer work. */
export function isAuthRejection(error: unknown): boolean {
  return error instanceof SignInError || (error instanceof HttpError && (error.status === 401 || error.status === 403))
}
