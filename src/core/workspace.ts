/**
 * The Workspace tab: a folder on the Hermes host, its files, its git changes
 * and a command line. The host may be macOS, Linux or Windows, so a path is
 * taken apart by both separators and a command is built for the host's shell.
 */

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
}

/** A changed file, as `GET /api/git/review/list` gives it. `status`: M, A, D, R, `?` for a new file. */
export interface GitFile {
  path: string
  added: number
  removed: number
  status: string
  staged: boolean
}

export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  changed: number
}

/** The answer of `GET /api/fs/read-text`. */
export interface TextFile {
  path: string
  text: string
  binary: boolean
  truncated: boolean
  byteSize: number
  /** The language the host reads from the name: `json`, `python`. */
  language?: string | null
}

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/

export function isWindowsPath(path: string): boolean {
  return WINDOWS_PATH.test(path)
}

export function baseName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

/** The folder above, or null at the top of the file system. */
export function parentPath(path: string): string | null {
  const clean = path.replace(/[\\/]+$/, '')
  const cut = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'))

  if (cut < 0 || /^[A-Za-z]:$/.test(clean)) {
    return null
  }

  if (cut === 0) {
    return clean.length > 1 ? '/' : null
  }

  const parent = clean.slice(0, cut)

  // "C:" is not a folder; "C:\" is.
  return /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

/** The path of a folder as the screen shows it under the root: "src / core". Empty at the root. */
export function pathUnderRoot(root: string, path: string): string {
  const rest = path.startsWith(root) ? path.slice(root.length) : path

  return rest.split(/[\\/]/).filter(Boolean).join(' / ')
}

const STATUS_WORDS: Record<string, string> = { M: 'Changed', A: 'Added', D: 'Deleted', R: 'Renamed', '?': 'New', U: 'Conflict' }

export function statusWord(status: string): string {
  return STATUS_WORDS[status] ?? 'Changed'
}

/** The changes in two groups, the way a commit sees them. */
export function changeGroups(files: readonly GitFile[]): { staged: GitFile[]; unstaged: GitFile[] } {
  return { staged: files.filter(file => file.staged), unstaged: files.filter(file => !file.staged) }
}

/**
 * What the commit button will do. The host commits what is staged; with
 * nothing staged it stages every change first. The button must say which.
 */
export function commitLabel(files: readonly GitFile[]): string {
  const { staged } = changeGroups(files)

  return staged.length ? `Commit ${staged.length} staged ${staged.length === 1 ? 'file' : 'files'}` : 'Commit all changes'
}

export function commitProblem(message: string, files: readonly GitFile[]): string | null {
  if (!files.length) {
    return 'There is nothing to commit.'
  }

  return message.trim() ? null : 'Write what the change is.'
}

/** Why the app does not open this file in its editor, or null. */
export function editProblem(file: Pick<TextFile, 'binary' | 'truncated'>): string | null {
  if (file.binary) {
    return 'This file is not text.'
  }

  return file.truncated ? 'This file is too large to edit on the phone. A save would cut it.' : null
}

function quote(path: string): string {
  return isWindowsPath(path) ? `"${path.replace(/"/g, '')}"` : `'${path.replace(/'/g, `'\\''`)}'`
}

/** The command for the host's shell, run in the folder. Each command is its own process, so the folder is set every time. */
export function shellCommand(cwd: string, command: string): string {
  return isWindowsPath(cwd) ? `cd /d ${quote(cwd)} && ${command}` : `cd ${quote(cwd)} && ${command}`
}

/**
 * The folder a `cd` asks for, or null for any other command. A `cd` in its
 * own process changes nothing, so the app keeps the folder itself.
 */
export function cdTarget(command: string): string | null {
  const match = /^\s*cd(?:\s+(.*?))?\s*$/.exec(command)

  if (!match || /[;&|]/.test(match[1] ?? '')) {
    return null
  }

  return (match[1] ?? '').replace(/^(['"])(.*)\1$/, '$2') || '~'
}

/** The command that answers with the full path of the folder a `cd` leads to. */
export function resolveCdCommand(cwd: string, target: string): string {
  return isWindowsPath(cwd) ? `cd /d ${quote(cwd)} && cd /d ${quote(target)} && cd` : `cd ${quote(cwd)} && cd ${target === '~' ? '~' : quote(target)} && pwd`
}

export interface TerminalEntry {
  key: number
  cwd: string
  command: string
  /** Null while the command runs. */
  output: string | null
  failed: boolean
  /** How long the command ran, in seconds. */
  seconds?: number
}

/** The terminal keeps the last commands only. An old one is in the host's own history, not in the phone's memory. */
export const TERMINAL_KEEP = 60

export function withEntry(entries: readonly TerminalEntry[], entry: TerminalEntry): TerminalEntry[] {
  return [...entries, entry].slice(-TERMINAL_KEEP)
}

/** The last different commands, the newest first: one tap runs a command again. */
export function recentCommands(entries: readonly TerminalEntry[], keep = 5): string[] {
  const seen: string[] = []

  for (let index = entries.length - 1; index >= 0 && seen.length < keep; index -= 1) {
    const command = entries[index]!.command.trim()

    if (command && !seen.includes(command)) {
      seen.push(command)
    }
  }

  return seen
}

/** What a finished command shows: its output, then its error text. An empty answer says so. */
export function commandOutput(result: { stdout: string; stderr: string; code: number }): string {
  const text = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter(Boolean).join('\n')

  return text || (result.code === 0 ? '(no output)' : `(ended with code ${result.code})`)
}

/** The address a preview loads for what the user typed: "3000" and "localhost:3000" are servers on the host. */
export function previewTarget(typed: string): string | null {
  const text = typed.trim()

  if (!text) {
    return null
  }

  if (/^\d{2,5}$/.test(text)) {
    return `http://localhost:${text}`
  }

  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
}

/** The start folders, with no folder twice and no empty one. The newest choice is first. */
export function withRecentRoot(recent: readonly string[], root: string, keep = 6): string[] {
  return [root, ...recent.filter(path => path !== root)].filter(Boolean).slice(0, keep)
}
