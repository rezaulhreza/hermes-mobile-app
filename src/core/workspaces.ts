/**
 * A workspace is one Hermes backend plus the account that signs in to it.
 * The app holds any number of workspaces and shows one at a time.
 *
 * This module is pure: parsing, validation and list edits. Persistence lives
 * in `store/workspaces.ts`, because the password and the proxy header values
 * are credentials and belong in the Keychain / Keystore.
 */

export interface Workspace {
  id: string
  /** Name shown in the workspace switcher. */
  label: string
  /** Base URL with no trailing slash, e.g. https://hermes.example.com */
  baseUrl: string
  username: string
  password: string
  /**
   * Extra headers sent on every request and on the WebSocket upgrade. An access
   * proxy in front of the backend needs them; Cloudflare Access service tokens
   * (CF-Access-Client-Id / CF-Access-Client-Secret) are the common case.
   */
  headers: Record<string, string>
}

export interface WorkspaceList {
  activeId: string | null
  workspaces: Workspace[]
}

export const EMPTY_WORKSPACES: WorkspaceList = { activeId: null, workspaces: [] }

export interface WorkspaceDraft {
  label?: string
  baseUrl: string
  username: string
  password: string
  accessClientId?: string
  accessClientSecret?: string
}

export type DraftResult = { ok: true; workspace: Workspace } | { ok: false; field: keyof WorkspaceDraft; message: string }

/**
 * Normalise what the user typed into a base URL. A bare host gets `https://`,
 * because a phone almost always reaches Hermes through a tunnel or a proxy.
 * Returns null when the text is not a usable http(s) URL.
 */
export function normaliseBaseUrl(input: string): string | null {
  const trimmed = input.trim()

  if (!trimmed) {
    return null
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(withScheme)

    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.host) {
      return null
    }

    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

/** ws(s):// origin that matches an http(s):// base URL. */
export function wsOriginFor(baseUrl: string): string {
  const url = new URL(baseUrl)

  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`
}

export function workspaceFromDraft(draft: WorkspaceDraft, id: string): DraftResult {
  const baseUrl = normaliseBaseUrl(draft.baseUrl)

  if (!baseUrl) {
    return { ok: false, field: 'baseUrl', message: 'Enter the address of your Hermes, for example hermes.example.com' }
  }

  const username = draft.username.trim()

  if (!username) {
    return { ok: false, field: 'username', message: 'Enter your Hermes username' }
  }

  if (!draft.password) {
    return { ok: false, field: 'password', message: 'Enter your Hermes password' }
  }

  const clientId = draft.accessClientId?.trim() ?? ''
  const clientSecret = draft.accessClientSecret?.trim() ?? ''

  // A service token is a pair. One half alone is always refused by the proxy.
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    return {
      ok: false,
      field: clientId ? 'accessClientSecret' : 'accessClientId',
      message: 'An Access service token needs both the client ID and the client secret'
    }
  }

  const headers: Record<string, string> = clientId
    ? { 'CF-Access-Client-Id': clientId, 'CF-Access-Client-Secret': clientSecret }
    : {}

  return {
    ok: true,
    workspace: {
      id,
      label: draft.label?.trim() || new URL(baseUrl).host,
      baseUrl,
      username,
      password: draft.password,
      headers
    }
  }
}

/** Add a workspace, or replace the one with the same id, and make it active. */
export function upsertWorkspace(list: WorkspaceList, workspace: Workspace): WorkspaceList {
  const rest = list.workspaces.filter(w => w.id !== workspace.id)

  return { activeId: workspace.id, workspaces: [...rest, workspace] }
}

/** Remove a workspace. When the active one goes, the first remaining one becomes active. */
export function removeWorkspace(list: WorkspaceList, id: string): WorkspaceList {
  const workspaces = list.workspaces.filter(w => w.id !== id)
  const activeId = list.activeId === id ? (workspaces[0]?.id ?? null) : list.activeId

  return { activeId, workspaces }
}

export function activeWorkspace(list: WorkspaceList): Workspace | null {
  return list.workspaces.find(w => w.id === list.activeId) ?? null
}

/**
 * Rebuild a stored list field by field. A corrupt or hand-edited entry must
 * never become a request header or a dial target, so anything malformed is
 * dropped instead of trusted.
 */
export function parseWorkspaceList(raw: string | null): WorkspaceList {
  if (!raw) {
    return EMPTY_WORKSPACES
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return EMPTY_WORKSPACES
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.workspaces)) {
    return EMPTY_WORKSPACES
  }

  const workspaces = parsed.workspaces.flatMap(entry => {
    const workspace = parseWorkspace(entry)

    return workspace ? [workspace] : []
  })

  const activeId =
    typeof parsed.activeId === 'string' && workspaces.some(w => w.id === parsed.activeId)
      ? parsed.activeId
      : (workspaces[0]?.id ?? null)

  return { activeId, workspaces }
}

function parseWorkspace(entry: unknown): Workspace | null {
  if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id || typeof entry.baseUrl !== 'string') {
    return null
  }

  const baseUrl = normaliseBaseUrl(entry.baseUrl)

  if (!baseUrl) {
    return null
  }

  const headers: Record<string, string> = {}

  if (isRecord(entry.headers)) {
    for (const [name, value] of Object.entries(entry.headers)) {
      if (name && typeof value === 'string' && value) {
        headers[name] = value
      }
    }
  }

  return {
    id: entry.id,
    label: typeof entry.label === 'string' && entry.label ? entry.label : new URL(baseUrl).host,
    baseUrl,
    username: typeof entry.username === 'string' ? entry.username : '',
    password: typeof entry.password === 'string' ? entry.password : '',
    headers
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
