import { atom } from 'nanostores'

import { vaultAddRequest, type VaultEntry, type VaultForm } from '@/core/vault'

import { rpc } from './link'

export interface VaultSource {
  name: string
  display_name: string
  enabled: boolean
  needs_unlock: boolean
  unlocked: boolean
  installed: boolean
}

/** Null until the first answer, so the screen can tell "loading" from "empty". */
export const $vaultItems = atom<VaultEntry[] | null>(null)
export const $vaultSources = atom<VaultSource[]>([])
export const $vaultError = atom<string | null>(null)

export async function loadVault(): Promise<void> {
  try {
    const [list, sources] = await Promise.all([
      rpc<{ items?: VaultEntry[] }>('vault.list'),
      rpc<{ sources?: VaultSource[] }>('vault.sources')
    ])

    $vaultItems.set(list.items ?? [])
    $vaultSources.set(sources.sources ?? [])
    $vaultError.set(null)
  } catch (error) {
    $vaultError.set(error instanceof Error ? error.message : String(error))
  }
}

export async function addVaultItem(form: VaultForm): Promise<void> {
  await rpc('vault.add', { ...vaultAddRequest(form) })
  await loadVault()
}

export async function removeVaultItem(id: string): Promise<void> {
  await rpc('vault.remove', { id })
  $vaultItems.set(($vaultItems.get() ?? []).filter(item => item.id !== id))
}

/** Turn a password manager on or off as a source of logins. Off also locks it. */
export async function setVaultSource(name: string, enabled: boolean): Promise<void> {
  await rpc('vault.source.set', { name, enabled })
  await loadVault()
}

/** Unlock a password manager for this run of the backend. The master password is not stored. */
export async function unlockVaultSource(name: string, password: string): Promise<void> {
  await rpc('vault.unlock', { name, password })
  await loadVault()
}

export async function lockVaultSource(name: string): Promise<void> {
  await rpc('vault.lock', { name })
  await loadVault()
}

export function clearVault(): void {
  $vaultItems.set(null)
  $vaultSources.set([])
  $vaultError.set(null)
}
