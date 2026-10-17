/**
 * The backend's command catalog: every slash command and skill, with where
 * each one works. One copy per link. It feeds the command sheet and tells the
 * composer which commands a phone cannot run.
 */

import { atom } from 'nanostores'

import type { CommandsCatalogResult } from '@/core/gateway/gateway-contract.generated'

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
}
