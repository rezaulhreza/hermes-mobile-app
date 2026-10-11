/**
 * Providers and keys: what the agent thinks with, and the secrets it uses.
 * Adding a key is a main use of the phone (the key is in a password manager or
 * a mail on the phone), so the rules here aim at one thing: find the row,
 * paste, done.
 */

import type { ModelOptionProvider, ModelOptionsResult } from './gateway/gateway-contract.generated'
import { modelLabel } from './models'

export interface ProviderRow {
  slug: string
  name: string
  /** The host can use it now. */
  connected: boolean
  /** New conversations use this provider. */
  current: boolean
  /** The name of the key in the host's `.env`. Empty for a provider that signs in another way. */
  keyEnv: string
  /** The provider takes an API key that the phone can send. */
  takesKey: boolean
  /** Why the phone cannot connect it, for a provider that does not take a key. */
  signInNote: string
  models: string[]
  warning: string
}

function takesKey(provider: ModelOptionProvider): boolean {
  const auth = (provider.auth_type ?? '').toLowerCase()

  return Boolean(provider.key_env) && (!auth || auth.includes('key'))
}

export function providerRows(result: ModelOptionsResult): ProviderRow[] {
  return (result.providers ?? [])
    .map(provider => {
      const unavailable = new Set(provider.unavailable_models ?? [])

      return {
        slug: provider.slug,
        name: provider.name || provider.slug,
        connected: provider.authenticated !== false,
        current: provider.slug === result.provider,
        keyEnv: provider.key_env ?? '',
        takesKey: takesKey(provider),
        signInNote: takesKey(provider) ? '' : 'This provider signs in with a browser. Connect it on the computer that runs Hermes.',
        // Featured models first, each model once.
        models: [...new Set([...(provider.featured_models ?? []), ...(provider.models ?? [])])].filter(model => !unavailable.has(model)),
        // For a provider with no key the host's warning only says "paste the key", which the form says already.
        warning: provider.authenticated === false ? '' : (provider.warning ?? '')
      }
    })
    .sort((a, b) => Number(b.current) - Number(a.current) || Number(b.connected) - Number(a.connected) || a.name.localeCompare(b.name))
}

export function filterProviders(rows: readonly ProviderRow[], query: string): ProviderRow[] {
  const needle = query.trim().toLowerCase()

  return needle ? rows.filter(row => row.name.toLowerCase().includes(needle) || row.slug.toLowerCase().includes(needle)) : [...rows]
}

/** The line under a provider's name. */
export function providerLine(row: ProviderRow, currentModel: string | undefined): string {
  if (row.current && currentModel) {
    return `In use · ${modelLabel(currentModel)}`
  }

  if (row.connected) {
    return `Connected · ${row.models.length} ${row.models.length === 1 ? 'model' : 'models'}`
  }

  return row.takesKey ? 'Needs an API key' : 'Sign in on the computer'
}

/** One secret of the host, from `GET /api/env`. The value itself never comes to the phone. */
export interface KeyRow {
  name: string
  set: boolean
  /** A short masked form of the value, to tell two keys apart. */
  preview: string
  description: string
  url: string
  group: string
  /** A key the user added by name. */
  custom: boolean
}

interface WireKey {
  is_set?: boolean
  redacted_value?: string | null
  description?: string
  url?: string | null
  category?: string
  provider_label?: string
  channel_managed?: boolean
  advanced?: boolean
  custom?: boolean
}

const GROUP_NAMES: Readonly<Record<string, string>> = { provider: 'Model providers', tool: 'Tools', messaging: 'Messaging', skill: 'Skills', setting: 'Settings', custom: 'Your own' }

export function keyRows(env: Record<string, unknown>): KeyRow[] {
  return Object.entries(env)
    .flatMap(([name, raw]) => {
      const row = (raw ?? {}) as WireKey

      // A messaging credential has its own setup. An advanced key that is not set is noise on a phone.
      if (row.channel_managed || (row.advanced && !row.is_set)) {
        return []
      }

      return [
        {
          name,
          set: Boolean(row.is_set),
          preview: maskedEnd(row.redacted_value),
          description: row.description ?? '',
          url: row.url ?? '',
          group: row.custom ? GROUP_NAMES.custom : row.provider_label || GROUP_NAMES[row.category ?? ''] || 'Other',
          custom: Boolean(row.custom)
        }
      ]
    })
    .sort((a, b) => Number(b.set) - Number(a.set) || a.name.localeCompare(b.name))
}

/** The host marks a masked value as `«redacted:abc...xyz»`. The phone shows the masked ends only. */
function maskedEnd(value: string | null | undefined): string {
  const inner = /^«redacted:(.*)»$/.exec(value ?? '')?.[1] ?? value ?? ''

  return /^[*.…]*$/.test(inner) ? '' : inner.replace('...', '…')
}

export function filterKeys(rows: readonly KeyRow[], query: string): KeyRow[] {
  const needle = query.trim().toLowerCase().replace(/\s+/g, '_')

  return needle
    ? rows.filter(row => row.name.toLowerCase().includes(needle) || row.group.toLowerCase().includes(query.trim().toLowerCase()) || row.description.toLowerCase().includes(query.trim().toLowerCase()))
    : [...rows]
}

/** Why a new key cannot be saved, or null. A name is what a shell takes: capitals, digits and underscores. */
export function keyProblem(name: string, value: string): string | null {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(name.trim())) {
    return 'The name has capital letters, digits and underscores only, for example MY_SERVICE_KEY.'
  }

  // A value pasted from a mail often has a space or a line end around it.
  return value.trim() ? null : 'Paste the value.'
}

/** A pasted secret with the white space and the quotes around it removed. */
export function tidySecret(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2')
}
