/**
 * The Workspace tab: one folder on the host, its files, its git changes and a
 * command line. Everything is asked for when a panel shows it; nothing polls.
 * `clearWorkspace` drops it all when the user leaves the Hermes workspace.
 */

import { atom } from 'nanostores'

import type { ProjectsPayload, ShellExecResult } from '@/core/gateway/gateway-contract.generated'
import {
  type FsEntry,
  type GitBranch,
  type GitFile,
  type GitWorktree,
  joinPath,
  renameCommand,
  searchCommand,
  type SearchHit,
  searchHits,
  type GitStatus,
  type TextFile,
  withRecentRoot
} from '@/core/workspace'

import { currentApi, rpc } from './link'
import { $preferences, setPreference } from './preferences'

/** The folder the tab works in. Null until the user chose one. */
export const $root = atom<string | null>(null)

export interface Folder {
  path: string
  entries: FsEntry[]
  loading: boolean
  problem: string | null
}

/** The folder the Files panel shows now. One level: a folder opens in the place of its parent. */
export const $folder = atom<Folder | null>(null)

export interface Changes {
  status: GitStatus | null
  files: GitFile[]
  loading: boolean
  /** Not a git folder, or git failed. */
  problem: string | null
}

export const $changes = atom<Changes>({ status: null, files: [], loading: false, problem: null })


/** Where the folder choice can start: the folder Hermes runs in and the projects of the host. */
export const $startPoints = atom<{ label: string; path: string }[]>([])

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

function words(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  return text.replace(/^\d{3}: /, '').replace(/^\{"detail":"(.*)"\}$/, '$1')
}

const q = encodeURIComponent

export async function loadStartPoints(): Promise<void> {
  const [cwd, projects] = await Promise.all([
    api()
      .request<{ cwd?: string }>({ path: '/api/fs/default-cwd' })
      .catch(() => ({ cwd: undefined })),
    rpc<ProjectsPayload>('projects.list', {}).catch(() => ({ projects: [] }) as ProjectsPayload)
  ])
  const points = [
    ...(cwd.cwd ? [{ label: 'Where Hermes runs', path: cwd.cwd }] : []),
    ...projects.projects.filter(project => !project.archived && project.primary_path).map(project => ({ label: project.name, path: project.primary_path as string }))
  ]

  $startPoints.set(points.filter((point, index) => points.findIndex(other => other.path === point.path) === index))
}

/** The folders inside a folder, for the folder choice. Files are left out: a folder is what the user picks. */
export async function listFolders(path: string): Promise<FsEntry[]> {
  const result = await api().request<{ entries?: FsEntry[]; error?: string }>({ path: `/api/fs/list?path=${q(path)}` })

  if (result.error) {
    throw new Error(`The host cannot read this folder (${result.error}).`)
  }

  return (result.entries ?? []).filter(entry => entry.isDirectory)
}

/** The home folder of the account that runs Hermes: where a browse of the host starts. */
export async function hostHome(): Promise<string | null> {
  for (const command of ['cd ~ && pwd', 'cd /d %USERPROFILE% && cd']) {
    const result = await rpc<ShellExecResult>('shell.exec', { command }).catch(() => null)
    const home = result?.code === 0 ? result.stdout.trim().split('\n').pop() : ''

    if (home) {
      return home
    }
  }

  return null
}

/** Work in this folder. The Files panel shows it, and a new shell starts in it. */
export function openRoot(path: string): void {
  $root.set(path)
  $folder.set(null)
  $changes.set({ status: null, files: [], loading: false, problem: null })
  setPreference('roots', withRecentRoot($preferences.get().roots, path))
  void showFolder(path)
}

export async function showFolder(path: string): Promise<void> {
  $folder.set({ path, entries: $folder.get()?.path === path ? $folder.get()!.entries : [], loading: true, problem: null })

  try {
    const result = await api().request<{ entries?: FsEntry[]; error?: string }>({ path: `/api/fs/list?path=${q(path)}` })

    // The user may have opened another folder while this one loaded.
    if ($folder.get()?.path === path) {
      $folder.set({ path, entries: result.entries ?? [], loading: false, problem: result.error ? `The host cannot read this folder (${result.error}).` : null })
    }
  } catch (error) {
    if ($folder.get()?.path === path) {
      $folder.set({ path, entries: [], loading: false, problem: words(error) })
    }
  }
}

export function readFile(path: string): Promise<TextFile> {
  return api().request<TextFile>({ path: `/api/fs/read-text?path=${q(path)}` })
}

/**
 * Save a text file. The host writes what it gets, so the app reads the file
 * again first: when the text on the host is no longer what the editor opened
 * (the agent or another person changed it), the save is refused.
 */
export async function saveFile(path: string, content: string, opened: string): Promise<void> {
  const now = await readFile(path)

  if (now.text !== opened) {
    throw new Error('The file changed on the host after you opened it. Open it again, then make your change.')
  }

  await api().request({ path: '/api/fs/write-text', method: 'POST', body: { path, content } })
}

export async function loadChanges(): Promise<void> {
  const root = $root.get()

  if (!root) {
    return
  }

  $changes.set({ ...$changes.get(), loading: true })

  try {
    const [status, list] = await Promise.all([
      api().request<GitStatus>({ path: `/api/git/status?path=${q(root)}` }),
      api().request<{ files?: GitFile[] }>({ path: `/api/git/review/list?path=${q(root)}&scope=uncommitted` })
    ])

    if ($root.get() === root) {
      $changes.set({ status, files: list.files ?? [], loading: false, problem: status.branch ? null : 'This folder is not in a git repository.' })
    }
  } catch (error) {
    if ($root.get() === root) {
      $changes.set({ status: null, files: [], loading: false, problem: words(error) })
    }
  }
}

export async function loadDiff(file: GitFile): Promise<string> {
  const root = $root.get() ?? ''
  const result = await api().request<{ diff?: string }>({
    path: `/api/git/review/diff?path=${q(root)}&file=${q(file.path)}&scope=uncommitted&staged=${file.staged}`
  })

  return result.diff ?? ''
}

async function gitAction(route: string, body: Record<string, unknown>): Promise<void> {
  await api().request({ path: `/api/git/review/${route}`, method: 'POST', body: { path: $root.get(), ...body }, timeoutMs: 120_000 })
  await loadChanges()
}

export const stageFile = (file: GitFile) => gitAction(file.staged ? 'unstage' : 'stage', { file: file.path })
export const stageAll = () => gitAction('stage', {})
export const unstageAll = () => gitAction('unstage', {})
/** Throw the changes of one file away. This cannot be undone. */
export const revertFile = (file: GitFile) => gitAction('revert', { file: file.path })
/** The branches of the repository. */
export async function loadBranches(): Promise<GitBranch[]> {
  return (await api().request<{ branches?: GitBranch[] }>({ path: `/api/git/branches?path=${q($root.get() ?? '')}` })).branches ?? []
}

/** Check another branch out in the opened folder. The host refuses when changes would be lost. */
export async function switchBranch(branch: string): Promise<void> {
  await api().request({ path: '/api/git/branch/switch', method: 'POST', body: { path: $root.get(), branch }, timeoutMs: 120_000 })
  await Promise.all([loadChanges(), $folder.get() ? showFolder($folder.get()!.path) : Promise.resolve()])
}

/** The other folders of this repository, each on a branch of its own. */
export async function loadWorktrees(): Promise<GitWorktree[]> {
  return (await api().request<{ worktrees?: GitWorktree[] }>({ path: `/api/git/worktrees?path=${q($root.get() ?? '')}` })).worktrees ?? []
}

export interface ShipInfo {
  /** The GitHub tool of the host is signed in. */
  ghReady: boolean
  pr: { number?: number; url?: string; title?: string; state?: string } | null
}

/** Whether the branch has a pull request, and whether the host can open one. */
export function loadShipInfo(): Promise<ShipInfo> {
  return api().request<ShipInfo>({ path: `/api/git/review/ship-info?path=${q($root.get() ?? '')}` })
}

/** Open a pull request for the branch with the GitHub tool of the host. Returns its address when the host gives one. */
export async function createPullRequest(): Promise<string | null> {
  const result = await api().request<{ url?: string; pr?: { url?: string } }>({ path: '/api/git/review/create-pr', method: 'POST', body: { path: $root.get() }, timeoutMs: 180_000 })

  return result?.url ?? result?.pr?.url ?? null
}

async function shell(command: string): Promise<ShellExecResult> {
  return rpc<ShellExecResult>('shell.exec', { command })
}

/** Make an empty file in the folder on screen. */
export async function newFile(name: string): Promise<string> {
  const folder = $folder.get()?.path ?? ''
  const path = joinPath(folder, name.trim())

  await api().request({ path: '/api/fs/write-text', method: 'POST', body: { path, content: '' } })
  await showFolder(folder)

  return path
}

export async function newFolder(name: string): Promise<void> {
  const folder = $folder.get()?.path ?? ''

  await api().request({ path: '/api/files/mkdir', method: 'POST', body: { path: joinPath(folder, name.trim()) } })
  await showFolder(folder)
}

/** Give a file or a folder a new name. The host has no route for it: its shell does it. */
export async function renameEntry(entry: FsEntry, name: string): Promise<void> {
  const folder = $folder.get()?.path ?? ''
  const result = await shell(renameCommand(entry.path, joinPath(folder, name.trim())))

  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || 'The host did not rename it.').trim())
  }

  await showFolder(folder)
}

/** Delete a file, or a folder with all that is in it. This cannot be undone. */
export async function deleteEntry(entry: FsEntry): Promise<void> {
  await api().request({ path: '/api/files', method: 'DELETE', body: { path: entry.path, recursive: entry.isDirectory } })
  await showFolder($folder.get()?.path ?? '')
}

/** Find text in the files of the opened folder. */
export async function searchFolder(words: string): Promise<SearchHit[]> {
  const root = $root.get() ?? ''
  const result = await shell(searchCommand(root, words.trim(), Boolean($changes.get().status?.branch)))

  // A search that finds nothing ends with code 1 and no text. That is an answer, not a fault.
  if (result.code !== 0 && result.code !== 1) {
    throw new Error((result.stderr || 'The host could not search this folder.').trim())
  }

  return searchHits(result.stdout)
}

export const commitChanges = (message: string, push: boolean) => gitAction('commit', { message: message.trim(), push })
export const pushBranch = () => gitAction('push', {})

export function clearWorkspace(): void {
  $root.set(null)
  $folder.set(null)
  $changes.set({ status: null, files: [], loading: false, problem: null })
  $startPoints.set([])
}
