/**
 * Choices of the user that belong to this phone, not to a workspace: which
 * speech engine a call uses, and whether this phone listens for the wake word.
 */

import * as SecureStore from 'expo-secure-store'
import { atom } from 'nanostores'

import type { EngineName } from './voice-engine'

export interface Preferences {
  /** `auto` takes the fastest engine the host has. */
  engine: EngineName | 'auto'
  /** This phone listens for the wake word while the app is open. */
  wake: boolean
  /** The folders the Workspace tab opened last, the newest first. */
  roots: string[]
}

const STORAGE_KEY = 'hermes.preferences'
const DEFAULTS: Preferences = { engine: 'auto', wake: false, roots: [] }
const ENGINES: readonly string[] = ['auto', 'deepgram', 'relay', 'gpt-live']

export const $preferences = atom<Preferences>(DEFAULTS)

export async function loadPreferences(): Promise<void> {
  try {
    const stored = JSON.parse((await SecureStore.getItemAsync(STORAGE_KEY)) ?? '{}') as Partial<Preferences>

    $preferences.set({
      engine: ENGINES.includes(String(stored.engine)) ? (stored.engine as Preferences['engine']) : DEFAULTS.engine,
      wake: stored.wake === true,
      roots: Array.isArray(stored.roots) ? stored.roots.filter((root): root is string => typeof root === 'string') : []
    })
  } catch {
    // Unreadable text is the same as no choice.
  }
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  $preferences.set({ ...$preferences.get(), [key]: value })
  void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify($preferences.get())).catch(() => undefined)
}
