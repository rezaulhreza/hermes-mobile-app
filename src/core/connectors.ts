/**
 * Connected apps: the hosted apps (Linear, Notion, Gmail...) that a bot can
 * use after one sign-in in the browser. The host answers four lists: the
 * catalog, the state of each app, the signed-in accounts and the policy. This
 * file joins them into one card per app and says each state in plain words.
 */

import type {
  ConnectionOperationStatus,
  ConnectorAccountRow,
  ConnectorCatalogRow,
  ConnectorErrorReason,
  ConnectorPolicyGetResult,
  ConnectorPolicyLayer,
  ConnectorRow
} from './gateway/gateway-contract.generated'

/** What a person can do with an app now. */
export type ConnectorState = 'available' | 'connected' | 'connecting' | 'expired' | 'broken' | 'off' | 'locked'

export interface ConnectorAccount {
  id: string
  /** The name a person gave it ("work"), else the name of the account at the app. */
  title: string
  alias: string
  label: string
  active: boolean
  state: 'active' | 'pending' | 'expired' | 'failed'
  reason: string
}

export interface ConnectorCard {
  slug: string
  name: string
  description: string
  category: string
  logoUrl: string | null
  state: ConnectorState
  /** Why the state is not plain: what the app said when it refused. */
  reason: string
  accounts: ConnectorAccount[]
  /** Tools of the app that this person switched off. */
  toolsOff: number
}

interface PolicyRules {
  allowed: ReadonlySet<string> | null
  denied: ReadonlySet<string>
  revision: string
}

/** The policy as the screen needs it: the person's own layer (they can change it) and the layers above it. */
export interface ConnectorPolicy {
  member: PolicyRules | null
  others: PolicyRules[]
}

export const NO_POLICY: ConnectorPolicy = { member: null, others: [] }

function rulesOf(layer: ConnectorPolicyLayer): PolicyRules {
  const body = layer.body

  switch (body.mode) {
    case 'unrestricted':
      return { allowed: null, denied: new Set(), revision: layer.revision }
    case 'deny-all':
      return { allowed: new Set(), denied: new Set(), revision: layer.revision }
    case 'allow':
      return { allowed: new Set(body.connectors), denied: new Set(), revision: layer.revision }
    default:
      return { allowed: null, denied: new Set(body.disabled_connectors), revision: layer.revision }
  }
}

export function readPolicy(result: ConnectorPolicyGetResult | null | undefined): ConnectorPolicy {
  const layers = result?.layers ?? []
  const member = layers.find(layer => layer.kind === 'member')

  return { member: member ? rulesOf(member) : null, others: layers.filter(layer => layer.kind !== 'member').map(rulesOf) }
}

const allows = (rules: PolicyRules, slug: string) => (rules.allowed === null || rules.allowed.has(slug)) && !rules.denied.has(slug)

/** The revision to send with a change. Empty when the person has no layer yet: the host then makes one. */
export const policyRevision = (policy: ConnectorPolicy): string => policy.member?.revision ?? ''

const ACCOUNT_STATES: Record<string, ConnectorAccount['state']> = { active: 'active', pending: 'pending', expired: 'expired', revoked: 'expired', inactive: 'expired', failed: 'failed' }

export function accountOf(row: ConnectorAccountRow): ConnectorAccount {
  const alias = (row.alias ?? '').trim()
  const label = (row.label ?? '').trim()

  return {
    id: row.connection_id,
    title: alias || label || 'Account',
    alias,
    label,
    active: row.active,
    state: ACCOUNT_STATES[row.status] ?? 'failed',
    reason: (row.status_reason ?? '').trim()
  }
}

const LIST_STATES: Record<string, ConnectorState> = { active: 'connected', pending: 'connecting', expired: 'expired', revoked: 'expired', inactive: 'expired', failed: 'broken' }

function stateOf(row: ConnectorRow | undefined, policy: ConnectorPolicy, slug: string): ConnectorState {
  if (policy.others.some(rules => !allows(rules, slug))) {
    return 'locked'
  }

  if ((policy.member && !allows(policy.member, slug)) || row?.enabled === false) {
    return 'off'
  }

  if (!row?.connected) {
    return 'available'
  }

  return LIST_STATES[row.connection_status ?? 'active'] ?? 'broken'
}

const titleOfSlug = (slug: string) =>
  slug
    .split(/[-_]/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')

/** One card per app of the catalog, and one for an app the host lists that the catalog does not know. */
export function connectorCards(input: { catalog: readonly ConnectorCatalogRow[]; list: readonly ConnectorRow[]; accounts: readonly ConnectorAccountRow[]; policy: ConnectorPolicy }): ConnectorCard[] {
  const listed = new Map(input.list.map(row => [row.connector, row]))
  const known = new Map(input.catalog.map(row => [row.slug, row]))

  for (const row of input.list) {
    if (!known.has(row.connector)) {
      known.set(row.connector, { slug: row.connector, name: titleOfSlug(row.connector), description: '', category: '', logo_url: null })
    }
  }

  return [...known.values()].map(entry => {
    const row = listed.get(entry.slug)

    return {
      slug: entry.slug,
      name: entry.name.trim() || titleOfSlug(entry.slug),
      description: entry.description.trim(),
      category: entry.category.trim(),
      logoUrl: entry.logo_url || null,
      state: stateOf(row, input.policy, entry.slug),
      reason: (row?.status_reason ?? '').trim(),
      accounts: input.accounts.filter(account => account.connector === entry.slug).map(accountOf),
      toolsOff: row?.gateway_disabled_tools.length ?? 0
    }
  })
}

const STATE_ORDER: Record<ConnectorState, number> = { broken: 0, expired: 1, connecting: 2, connected: 3, off: 4, available: 5, locked: 6 }

/** Apps that need the person first, then the ones in use, then the rest by name. A query matches the name, the category or the text. */
export function shownConnectors(cards: readonly ConnectorCard[], query: string): ConnectorCard[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)

  return cards
    .filter(card => words.every(word => `${card.name} ${card.category} ${card.description}`.toLowerCase().includes(word)))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name))
}

const STATE_WORDS: Record<ConnectorState, string> = {
  available: 'Not connected',
  connected: 'Connected',
  connecting: 'Waiting for the sign-in',
  expired: 'The access ran out. Connect it again.',
  broken: 'Could not connect',
  off: 'Off for your bots',
  locked: 'Turned off by your organisation'
}

export function connectorStateWords(card: Pick<ConnectorCard, 'state' | 'accounts' | 'toolsOff'>): string {
  if (card.state !== 'connected') {
    return STATE_WORDS[card.state]
  }

  const shown = [card.accounts.length > 1 ? `${card.accounts.length} accounts` : 'Connected']

  if (card.toolsOff) {
    shown.push(`${card.toolsOff} ${card.toolsOff === 1 ? 'tool' : 'tools'} off`)
  }

  return shown.join(' · ')
}

/** A connected app comes first in the count of the Settings row. */
export const connectedCount = (cards: readonly ConnectorCard[] | null): number => (cards ?? []).filter(card => card.state === 'connected').length

/** The sign-in page an operation opened, if it has one yet. */
export const connectLink = (operation: Pick<ConnectionOperationStatus, 'targets'>): string | null => operation.targets.find(target => target.connect_url)?.connect_url ?? null

export type ConnectOutcome = 'waiting' | 'connected' | 'failed' | 'expired'

/** Where a sign-in stands. An operation that ended with no connected app failed, or ran out of time. */
export function connectOutcome(operation: Pick<ConnectionOperationStatus, 'targets' | 'settled' | 'settled_by'>): ConnectOutcome {
  if (operation.targets.some(target => target.state === 'connected')) {
    return 'connected'
  }

  if (!operation.settled) {
    return 'waiting'
  }

  return operation.settled_by === 'deadline' || operation.targets.some(target => target.state === 'expired') ? 'expired' : 'failed'
}

/** Why a name for a second account cannot be used. Null when it can. */
export function aliasProblem(alias: string, accounts: readonly ConnectorAccount[]): string | null {
  const clean = alias.trim()

  if (!clean) {
    return 'Give the account a name, for example “work”.'
  }

  if (clean.length > 40) {
    return 'Use 40 characters or fewer.'
  }

  if (accounts.some(account => account.alias.toLowerCase() === clean.toLowerCase())) {
    return 'An account of this app has this name already.'
  }

  return null
}

const REASON_WORDS: Partial<Record<ConnectorErrorReason, string>> = {
  NEEDS_NOUS_AUTH: 'Connected apps need a Nous account. Sign in to Nous on the host first.',
  CONNECTORS_UNAVAILABLE: 'Connected apps are not available on this host.',
  CATALOG_UNAVAILABLE: 'The list of apps could not be read. Try again.',
  ACCOUNTS_UNAVAILABLE: 'The accounts could not be read. Try again.',
  POLICY_UNAVAILABLE: 'The settings of the apps could not be read. Try again.',
  POLICY_CONFLICT: 'Another device changed this at the same time. Look at the list again and try once more.',
  FORBIDDEN_SCOPE: 'Your organisation does not let you change this.',
  ORG_REQUIRED: 'This needs an organisation on your Nous account.',
  ORG_ACCESS_DENIED: 'Your organisation does not let you change this.',
  ALIAS_TAKEN: 'An account of this app has this name already.',
  CONNECTION_NOT_FOUND: 'This account is gone already.',
  CONNECTOR_NOT_FOUND: 'The host does not know this app.',
  UNSUPPORTED_RUNTIME: 'This host cannot connect apps.',
  LINK_STILL_VALID: 'The sign-in page from before still works. Open it again.'
}

/** The reason code a connector call failed with, from the error data of the gateway. */
export function connectorReason(error: unknown): ConnectorErrorReason | null {
  const data = (error as { data?: { reason?: unknown } } | null)?.data

  return typeof data?.reason === 'string' ? (data.reason as ConnectorErrorReason) : null
}

/** Plain words for a failed connector call, or null to use the general words. */
export function connectorFaultWords(error: unknown): string | null {
  const reason = connectorReason(error)

  return reason ? (REASON_WORDS[reason] ?? null) : null
}
