/**
 * The copy of an attachment that a preview can open. A file picked on this
 * phone is here already. A file from stored history is on the Hermes host, so
 * it is downloaded once into the cache directory.
 */

import { Directory, File, Paths } from 'expo-file-system'

import type { SentAttachment } from '@/core/attachments'

import { currentApi } from './link'

const FOLDER = 'previews'

/** The `file://` address of a copy on the phone. Throws with a sentence the user can read. */
export async function localCopy(item: SentAttachment): Promise<string> {
  if (item.uri) {
    return item.uri
  }

  const api = currentApi()

  if (!item.path || !api) {
    throw new Error('This file is no longer on the phone, and the message does not say where it is on the host.')
  }

  const folder = new Directory(Paths.cache, FOLDER)

  if (!folder.exists) {
    folder.create({ intermediates: true })
  }

  // The host path names the file. Two files with one name in different folders must not share a copy.
  const target = new File(folder, `${item.path.replace(/[^A-Za-z0-9]+/g, '_').slice(-80)}_${item.name}`)

  if (target.exists) {
    return target.uri
  }

  try {
    // No `session_id`: with one, the backend reads the path inside that session's working folder and answers 404.
    await File.downloadFileAsync(`${api.workspace.baseUrl}/api/fs/download?path=${encodeURIComponent(item.path)}`, target, {
      headers: api.workspace.headers
    })
  } catch {
    throw new Error(`Could not get ${item.name} from the Hermes host.`)
  }

  return target.uri
}

export function readText(uri: string): Promise<string> {
  return new File(uri).text()
}
