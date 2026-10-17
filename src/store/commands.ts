/**
 * The backend's command catalog: every slash command and skill, with where
 * each one works. One copy per link. It feeds the command sheet and tells the
 * composer which commands a phone cannot run. Beside it: the plugins of the
 * host that take a reference in a message.
 */

import { atom } from 'nanostores'

import type { CommandsCatalogResult, CompletionItemsResult } from '@/core/gateway/gateway-contract.generated'
import { referencePlugins } from '@/core/mentions'

import { rpc } from './link'

export const $catalog = atom<CommandsCatalogResult | null>(null)

let loading: Promise<CommandsCatalogResult | null> | null = null

/** Load the catalog once. Never throws: without it the app falls back to its own short list. */
export function loadCatalog(sessionId: string): Promise<CommandsCatalogResult | null> {
  const known = $catalog.get()

  if (known) {
    return Promise.resolve(known)
  }

  loading ??= rpc<CommandsCatalogResult>('commands.catalog', { session_id: sessionId })
    .then(result => {
      $catalog.set(result)

      return result
    })
    .catch(() => null)
    .finally(() => {
      loading = null
    })

  return loading
}

export function clearCatalog(): void {
  $catalog.set(null)
  $referencePlugins.set(null)
}

/** The prefixes that plugins of the host answer to after "@" ("issue" for "@issue:12"). Null until the host was asked. */
export const $referencePlugins = atom<string[] | null>(null)

let asking: Promise<void> | null = null

/** Ask the host once which plugins take a reference. Never throws: without the answer only the references of Hermes itself are drawn. */
export function loadReferencePlugins(sessionId: string): Promise<void> {
  if ($referencePlugins.get()) {
    return Promise.resolve()
  }

  // The rows the host offers for a lone "@" name every such plugin.
  asking ??= rpc<CompletionItemsResult>('complete.path', { session_id: sessionId, word: '@' }, 8000)
    .then(result => $referencePlugins.set(referencePlugins(result.items ?? [])))
    .catch(() => undefined)
    .finally(() => {
      asking = null
    })

  return asking
}
