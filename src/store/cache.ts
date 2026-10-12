/** The copy of the lists of the active workspace on the phone. See `core/cache.ts` for what may go in it. */

import { Directory, File, Paths } from 'expo-file-system'

import { type CacheKey, cacheFolderName, packCache, unpackCache } from '@/core/cache'

import { $activeWorkspace } from './workspaces'

const ROOT = 'lists'

function folder(workspaceId: string): Directory {
  return new Directory(Paths.cache, ROOT, cacheFolderName(workspaceId))
}

/** The stored list of the active workspace, or null. Never throws: a list with no copy only loads later. */
export function readCached<T>(key: CacheKey): T | null {
  const workspace = $activeWorkspace.get()

  if (!workspace) {
    return null
  }

  try {
    const file = new File(folder(workspace.id), `${key}.json`)

    return file.exists ? unpackCache<T>(file.textSync()) : null
  } catch {
    return null
  }
}

/** Store a list for the next run. `workspaceId` is the workspace the answer came from: the user can switch while a request runs. */
export function writeCached(key: CacheKey, value: unknown, workspaceId = $activeWorkspace.get()?.id): void {
  if (!workspaceId) {
    return
  }

  try {
    const target = folder(workspaceId)

    if (!target.exists) {
      target.create({ intermediates: true, idempotent: true })
    }

    new File(target, `${key}.json`).write(packCache(value))
  } catch {
    // The system can empty the cache folder or run out of space. The list still works from the host.
  }
}

/** Remove every stored list of a workspace the user signed out of. */
export function forgetCached(workspaceId: string): void {
  try {
    const target = folder(workspaceId)

    if (target.exists) {
      target.delete()
    }
  } catch {
    // Nothing to remove.
  }
}
