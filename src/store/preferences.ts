/**
 * Choices of the user that belong to this phone, not to a workspace: which
 * speech engine a call uses, and whether this phone listens for the wake word.
 */

import * as SecureStore from 'expo-secure-store'
import { atom } from 'nanostores'
import { Appearance } from 'react-native'

import type { EngineName } from './voice-engine'

export interface Preferences {
  /** `auto` takes the first engine the host can run. */
  engine: EngineName | 'auto'
  /** This phone listens for the wake word while the app is open. */
  wake: boolean
  /** The folders the Workspace tab opened last, the newest first. */
  roots: string[]
  /** Light, dark, or what the system says. */
  appearance: AppearanceChoice
  /** The voice of a call on the Deepgram engine. Empty: the voice the host is set to. */
  voice: string
  /** The language this phone speaks in Live voice. Empty: the language the host is set to. */
  language: string
  /** How lively a Flux voice sounds in Live voice, -2 to 2. Null: the level the host is set to. */
  expressivity: number | null
  /** A call plays through the loudspeaker. False: the earpiece, as a phone call. */
  speaker: boolean
  /** The Kanban boards pinned on this phone, by workspace id: they come first in the list of boards. */
  pinnedBoards: Record<string, string[]>
}

export type AppearanceChoice = 'system' | 'light' | 'dark'

/** Make the whole app, its sheets and its keyboard light or dark. `system` gives the choice back to the phone. */
function applyAppearance(choice: AppearanceChoice): void {
  Appearance.setColorScheme(choice === 'system' ? 'unspecified' : choice)
}

const STORAGE_KEY = 'hermes.preferences'
const DEFAULTS: Preferences = { engine: 'auto', wake: false, roots: [], appearance: 'system', voice: '', language: '', expressivity: null, speaker: true, pinnedBoards: {} }
const ENGINES: readonly string[] = ['auto', 'deepgram', 'relay', 'gpt-live']

export const $preferences = atom<Preferences>(DEFAULTS)

export async function loadPreferences(): Promise<void> {
  try {
    const stored = JSON.parse((await SecureStore.getItemAsync(STORAGE_KEY)) ?? '{}') as Partial<Preferences>

    $preferences.set({
      engine: ENGINES.includes(String(stored.engine)) ? (stored.engine as Preferences['engine']) : DEFAULTS.engine,
      wake: stored.wake === true,
      roots: Array.isArray(stored.roots) ? stored.roots.filter((root): root is string => typeof root === 'string') : [],
      appearance: stored.appearance === 'light' || stored.appearance === 'dark' ? stored.appearance : 'system',
      voice: typeof stored.voice === 'string' ? stored.voice : '',
      language: typeof stored.language === 'string' ? stored.language : '',
      expressivity: typeof stored.expressivity === 'number' && Number.isInteger(stored.expressivity) && Math.abs(stored.expressivity) <= 2 ? stored.expressivity : null,
      speaker: stored.speaker !== false,
      pinnedBoards: pinnedBoardsOf(stored.pinnedBoards)
    })
    applyAppearance($preferences.get().appearance)
  } catch {
    // Unreadable text is the same as no choice.
  }
}

function pinnedBoardsOf(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([workspace, slugs]) => [workspace, Array.isArray(slugs) ? slugs.filter((slug): slug is string => typeof slug === 'string') : []])
  )
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  $preferences.set({ ...$preferences.get(), [key]: value })

  if (key === 'appearance') {
    applyAppearance(value as AppearanceChoice)
  }

  void SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify($preferences.get())).catch(() => undefined)
}
