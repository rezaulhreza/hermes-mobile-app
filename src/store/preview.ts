/**
 * The copy of an attachment that a preview can open. A file picked on this
 * phone is here already. A file from stored history is on the Hermes host, so
 * it is downloaded once into the cache directory.
 */

import { Directory, File, Paths } from 'expo-file-system'

import type { SentAttachment } from '@/core/attachments'
import { filesThatExist, hostFolder } from '@/core/host-files'

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

  // No `session_id`: with one, the backend reads the path inside that session's working folder and answers 404.
  const download = (path: string) => File.downloadFileAsync(`${api.workspace.baseUrl}/api/fs/download?path=${encodeURIComponent(path)}`, target, { headers: api.workspace.headers })

  // The desktop app writes the path of a file with no "/" at its start.
  const paths = /^[/~]/.test(item.path) ? [item.path] : [item.path, `/${item.path}`]

  try {
    await paths.slice(1).reduce(
      (tried, path) => tried.catch(() => download(path)),
      download(paths[0])
    )
  } catch {
    // A file of an old message can be gone: the user or a bot moved or deleted it after the message.
    throw new Error(`${item.name} is not on the Hermes host any more. It was moved or deleted after this message.`)
  }

  return target.uri
}

// One list request per folder serves every answer that names a file in it. A folder changes: the answer is kept a short time.
const FOLDER_KEEP_MS = 30_000
const folders = new Map<string, { at: number; names: Promise<ReadonlySet<string>> }>()

function namesIn(folder: string): Promise<ReadonlySet<string>> {
  const kept = folders.get(folder)

  if (kept && Date.now() - kept.at < FOLDER_KEEP_MS) {
    return kept.names
  }

  const api = currentApi()
  const names: Promise<ReadonlySet<string>> = api
    ? api
        .request<{ entries?: { name: string; isDirectory?: boolean }[] }>({ path: `/api/fs/list?path=${encodeURIComponent(folder)}` })
        .then(result => new Set((result.entries ?? []).filter(entry => !entry.isDirectory).map(entry => entry.name)))
        .catch(() => new Set<string>())
    : Promise.resolve(new Set<string>())

  folders.set(folder, { at: Date.now(), names })

  // The map must not grow with every folder an agent ever named.
  if (folders.size > 40) {
    folders.delete(folders.keys().next().value as string)
  }

  return names
}

/** The files of an answer that are on the host now. A file the phone has a copy of needs no check. */
export async function hostFilesThatExist(files: readonly SentAttachment[]): Promise<SentAttachment[]> {
  const wanted = [...new Set(files.map(file => (file.path ? hostFolder(file.path) : null)).filter((folder): folder is string => folder !== null))]
  const found = new Map(await Promise.all(wanted.map(async folder => [folder, await namesIn(folder)] as const)))

  return filesThatExist(files, found)
}

export function clearHostFolders(): void {
  folders.clear()
}

export function readText(uri: string): Promise<string> {
  return new File(uri).text()
}
