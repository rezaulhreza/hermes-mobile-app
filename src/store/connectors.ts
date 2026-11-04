/**
 * Connected apps of ONE bot. Filled while the Connected apps screen is open,
 * emptied when it closes. A sign-in is followed while the screen is open: the
 * host is asked for its state every few seconds, and woken when the person
 * comes back from the browser.
 */

import { atom } from 'nanostores'
import { Linking } from 'react-native'

import { type ConnectOutcome, type ConnectorCard, type ConnectorPolicy, connectorCards, connectLink, connectOutcome, NO_POLICY, policyRevision, readPolicy } from '@/core/connectors'
import type { ConnectionOperationStatus, ConnectorAccountsResult, ConnectorsCatalogResult, ConnectorsConnectResult, ConnectorsListResult, ConnectorPolicyGetResult } from '@/core/gateway/gateway-contract.generated'

import { rpc } from './link'

const ACCOUNT = { type: 'account' } as const
const SLOW = 45_000
const POLL_MS = 2500

export const $connectorProfile = atom<string>('')
export const $connectorCards = atom<ConnectorCard[] | null>(null)

/** The sign-in that is open now, for one app. */
export interface SignIn {
  slug: string
  opId: string
  link: string | null
  outcome: ConnectOutcome
}

export const $signIn = atom<SignIn | null>(null)

let policy: ConnectorPolicy = NO_POLICY
let poll: ReturnType<typeof setInterval> | null = null

const call = <T>(method: string, params: Record<string, unknown> = {}) => rpc<T>(method, { ...params, profile: $connectorProfile.get() || undefined }, SLOW)

/** Show the apps of this bot. The cards of the bot before are dropped. */
export function showConnectorsOf(profile: string): void {
  if (profile !== $connectorProfile.get()) {
    $connectorProfile.set(profile)
    $connectorCards.set(null)
    policy = NO_POLICY
  }
}

/** Read the four lists. The policy and the accounts are optional: a host without them still shows the apps. */
export async function loadConnectors(): Promise<void> {
  const profile = $connectorProfile.get()
  const [catalog, list, accounts, rules] = await Promise.all([
    call<ConnectorsCatalogResult>('connectors.catalog'),
    call<ConnectorsListResult>('connectors.list', { owner: ACCOUNT }),
    call<ConnectorAccountsResult>('connectors.accounts').catch(() => ({ accounts: [] })),
    call<ConnectorPolicyGetResult>('connectors.policy.get').catch(() => null)
  ])

  if (profile !== $connectorProfile.get()) {
    return
  }

  policy = readPolicy(rules)
  $connectorCards.set(connectorCards({ catalog: catalog.connectors ?? [], list: list.connectors ?? [], accounts: accounts.accounts ?? [], policy }))
}

function follow(slug: string, operation: Pick<ConnectionOperationStatus, 'op_id' | 'targets' | 'settled' | 'settled_by'>): void {
  const outcome = connectOutcome(operation)

  $signIn.set({ slug, opId: operation.op_id, link: connectLink(operation), outcome })

  if (outcome !== 'waiting') {
    stopFollowing()
    void loadConnectors().catch(() => undefined)
  }
}

/**
 * Start a sign-in for one app, and open its page in the browser of the phone.
 * `alias` names a second account. `reconnect` repairs an account whose access ran out.
 */
export async function connectApp(slug: string, options: { alias?: string; reconnect?: boolean; connectionId?: string } = {}): Promise<void> {
  stopFollowing()

  const params: Record<string, unknown> = { owner: ACCOUNT, connectors: [slug], reconnect: Boolean(options.reconnect) }

  if (options.alias?.trim()) {
    params.alias = options.alias.trim()
  } else if (options.reconnect && options.connectionId) {
    params.connection_id = options.connectionId
  }

  const operation = await call<ConnectorsConnectResult>('connectors.connect', params)

  follow(slug, operation)

  const link = connectLink(operation)

  if (link) {
    void Linking.openURL(link)
  }

  if (connectOutcome(operation) === 'waiting') {
    poll = setInterval(() => void checkSignIn(), POLL_MS)
  }
}

/** Ask the host where the open sign-in stands. */
export async function checkSignIn(): Promise<void> {
  const open = $signIn.get()

  if (!open || open.outcome !== 'waiting') {
    return
  }

  const status = await call<ConnectionOperationStatus>('connectors.operation.status', { owner: ACCOUNT, op_id: open.opId }).catch(() => null)

  if (status && $signIn.get()?.opId === open.opId) {
    follow(open.slug, status)
  }
}

/** The person came back from the browser: the host looks at the sign-in at once, not at its next turn. */
export async function wakeSignIn(): Promise<void> {
  const open = $signIn.get()

  if (open?.outcome === 'waiting') {
    await call('connectors.operation.wake', { owner: ACCOUNT, op_id: open.opId }).catch(() => undefined)
    await checkSignIn()
  }
}

export function stopFollowing(): void {
  if (poll) {
    clearInterval(poll)
    poll = null
  }
}

/** Forget the sign-in on screen. The host lets an unfinished one run out by itself. */
export function dropSignIn(): void {
  stopFollowing()
  $signIn.set(null)
}

const put = (slug: string, change: Partial<ConnectorCard>) => $connectorCards.set(($connectorCards.get() ?? []).map(card => (card.slug === slug ? { ...card, ...change } : card)))

/** Let the bots use an app, or not. The card moves at once and goes back when the host refuses. */
export async function setAppOn(slug: string, on: boolean): Promise<void> {
  const before = $connectorCards.get()?.find(card => card.slug === slug)

  put(slug, { state: on ? 'available' : 'off' })

  try {
    await call('connectors.policy.set', { change: { type: 'connector', connector: slug, enabled: on }, expected_revision: policyRevision(policy) })
  } finally {
    await loadConnectors().catch(() => (before ? put(slug, { state: before.state }) : undefined))
  }
}

export async function renameAccount(connectionId: string, alias: string): Promise<void> {
  await call('connectors.accounts.rename', { connection_id: connectionId, alias: alias.trim() })
  await loadConnectors()
}

/** Sign one account out of its app. The bots lose it at once. */
export async function removeAccount(connectionId: string): Promise<void> {
  await call('connectors.accounts.remove', { connection_id: connectionId })
  await loadConnectors()
}

export function clearConnectors(): void {
  dropSignIn()
  $connectorProfile.set('')
  $connectorCards.set(null)
  policy = NO_POLICY
}
