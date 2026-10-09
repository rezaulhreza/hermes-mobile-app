import * as SecureStore from 'expo-secure-store'
import { atom, computed } from 'nanostores'

import {
  activeWorkspace,
  EMPTY_WORKSPACES,
  parseWorkspaceList,
  removeWorkspace,
  upsertWorkspace,
  type Workspace,
  type WorkspaceList
} from '@/core/workspaces'

// The list holds passwords and proxy secrets, so it lives in the Keychain /
// Keystore and nowhere else.
const STORAGE_KEY = 'hermes.workspaces.v1'

export const $workspaces = atom<WorkspaceList>(EMPTY_WORKSPACES)
/** False until the stored list has been read once. Screens wait on it. */
export const $workspacesLoaded = atom(false)
export const $activeWorkspace = computed($workspaces, activeWorkspace)

export async function loadWorkspaces(): Promise<void> {
  $workspaces.set(parseWorkspaceList(await SecureStore.getItemAsync(STORAGE_KEY)))
  $workspacesLoaded.set(true)
}

async function commit(list: WorkspaceList): Promise<void> {
  $workspaces.set(list)
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(list))
}

export function saveWorkspace(workspace: Workspace): Promise<void> {
  return commit(upsertWorkspace($workspaces.get(), workspace))
}

export function forgetWorkspace(id: string): Promise<void> {
  return commit(removeWorkspace($workspaces.get(), id))
}

export function switchWorkspace(id: string): Promise<void> {
  const list = $workspaces.get()

  return list.workspaces.some(w => w.id === id) ? commit({ ...list, activeId: id }) : Promise.resolve()
}

export function newWorkspaceId(): string {
  return `ws_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
