/** Providers, models and keys of the active workspace. */

import { atom } from 'nanostores'

import type { ModelOptionsResult } from '@/core/gateway/gateway-contract.generated'
import { type KeyRow, keyRows, tidySecret } from '@/core/providers'

import { readCached, writeCached } from './cache'
import { currentApi, rpc } from './link'
import { $activeWorkspace } from './workspaces'

export const $providers = atom<ModelOptionsResult | null>(null)
export const $keys = atom<KeyRow[] | null>(null)

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

/** Every provider Hermes knows, also those with no key yet. `refresh` asks the providers for their model lists again. */
export async function loadProviders(refresh = false): Promise<void> {
  const workspaceId = $activeWorkspace.get()?.id
  const options = await rpc<ModelOptionsResult>('model.options', { include_unconfigured: true, ...(refresh ? { refresh: true } : {}) }, 60_000)

  $providers.set(options)
  // Names of providers and models, and which of them has a key. No key is in it.
  writeCached('providers', options, workspaceId)
}

/** Show the providers of the last run until the host answers. */
export function restoreProviders(): void {
  const options = readCached<ModelOptionsResult>('providers')

  if (options && !$providers.get()) {
    $providers.set(options)
  }
}

export async function saveProviderKey(slug: string, key: string): Promise<void> {
  await rpc('model.save_key', { slug, api_key: tidySecret(key) }, 60_000)
  await loadProviders()
}

export async function disconnectProvider(slug: string): Promise<void> {
  await rpc('model.disconnect', { slug })
  await loadProviders()
}

/** Make a model the one every new conversation starts with. */
export async function setDefaultModel(provider: string, model: string): Promise<void> {
  // `config.set model` needs a live session and changes that session. The default of the profile has its own route.
  await api().request({ path: '/api/model/set', method: 'POST', body: { scope: 'main', provider, model }, timeoutMs: 60_000 })
  await loadProviders()
}

export async function loadKeys(): Promise<void> {
  $keys.set(keyRows(await api().request<Record<string, unknown>>({ path: '/api/env' })))
}

export async function saveKey(name: string, value: string): Promise<void> {
  await api().request({ path: '/api/env', method: 'PUT', body: { key: name.trim(), value: tidySecret(value) } })
  await loadKeys()
}

export async function removeKey(name: string): Promise<void> {
  await api().request({ path: '/api/env', method: 'DELETE', body: { key: name } })
  await loadKeys()
}

export function clearProviders(): void {
  $providers.set(null)
  $keys.set(null)
}
