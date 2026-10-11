/**
 * The Workspace tab: one folder on the host, its files, its git changes and a
 * command line. Everything is asked for when a panel shows it; nothing polls.
 * `clearWorkspace` drops it all when the user leaves the Hermes workspace.
 */

import { atom } from 'nanostores'

import type { ProjectsPayload, ShellExecResult } from '@/core/gateway/gateway-contract.generated'
import {
  cdTarget,
  commandOutput,
  type FsEntry,
  type GitFile,
  type GitStatus,
  resolveCdCommand,
  shellCommand,
  type TerminalEntry,
  type TextFile,
  withEntry,
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

export interface Terminal {
  cwd: string
  entries: TerminalEntry[]
  running: boolean
}

export const $terminal = atom<Terminal | null>(null)

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

/** Work in this folder. The Files panel shows it, the terminal starts in it. */
export function openRoot(path: string): void {
  $root.set(path)
  $folder.set(null)
  $changes.set({ status: null, files: [], loading: false, problem: null })
  $terminal.set({ cwd: path, entries: [], running: false })
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
export const commitChanges = (message: string, push: boolean) => gitAction('commit', { message: message.trim(), push })
export const pushBranch = () => gitAction('push', {})

let nextKey = 0

/** Run one command in the terminal's folder. The host gives it 30 seconds and returns the end of its output. */
export async function runCommand(command: string): Promise<void> {
  const terminal = $terminal.get()

  if (!terminal || terminal.running || !command.trim()) {
    return
  }

  const key = (nextKey += 1)
  const started = Date.now()
  const { cwd } = terminal
  const target = cdTarget(command)
  const finish = (output: string, failed: boolean, nextCwd = cwd) => {
    const current = $terminal.get()

    if (current) {
      $terminal.set({
        cwd: nextCwd,
        running: false,
        entries: current.entries.map(entry => (entry.key === key ? { ...entry, output, failed, seconds: (Date.now() - started) / 1000 } : entry))
      })
    }
  }

  $terminal.set({ cwd, running: true, entries: withEntry(terminal.entries, { key, cwd, command, output: null, failed: false }) })

  try {
    // A `cd` in its own process changes nothing: the app asks where it leads and keeps that folder.
    const result = await rpc<ShellExecResult>('shell.exec', { command: target === null ? shellCommand(cwd, command) : resolveCdCommand(cwd, target) }, 40_000)

    if (target !== null && result.code === 0 && result.stdout.trim()) {
      finish('', false, result.stdout.trim().split('\n').pop()!)
    } else {
      finish(commandOutput(result), result.code !== 0)
    }
  } catch (error) {
    finish(words(error), true)
  }
}

export function clearTerminal(): void {
  const terminal = $terminal.get()

  if (terminal) {
    $terminal.set({ ...terminal, entries: [] })
  }
}

export function clearWorkspace(): void {
  $root.set(null)
  $folder.set(null)
  $changes.set({ status: null, files: [], loading: false, problem: null })
  $terminal.set(null)
  $startPoints.set([])
}
