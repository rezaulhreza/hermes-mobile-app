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

/** A branch of the repository, as `GET /api/git/branches` gives it. */
export interface GitBranch {
  name: string
  checkedOut: boolean
  isDefault: boolean
  isRemote: boolean
  /** Another folder (a worktree) has this branch checked out. */
  worktreePath: string | null
}

/** A worktree: one more folder of the same repository, on a branch of its own. */
export interface GitWorktree {
  path: string
  branch: string | null
  isMain: boolean
}

/** A path as one word of a shell command of the host. */
export function shellQuote(path: string): string {
  return isWindowsPath(path) ? `"${path.replace(/"/g, '')}"` : `'${path.replace(/'/g, `'\\''`)}'`
}

/** A path made of a folder and a name, with the separator the folder uses. */
export function joinPath(folder: string, name: string): string {
  const slash = isWindowsPath(folder) ? '\\' : '/'

  return `${folder.replace(/[\\/]+$/, '')}${slash}${name}`
}

/** Why this cannot be the name of a file or a folder, or null. */
export function nameProblem(name: string, taken: readonly string[]): string | null {
  const typed = name.trim()

  if (!typed) {
    return 'Give it a name.'
  }

  if (/[\\/:*?"<>|]/.test(typed) || typed === '.' || typed === '..') {
    return 'A name cannot have / \\ : * ? " < > | in it.'
  }

  return taken.includes(typed) ? `“${typed}” exists already in this folder.` : null
}

/** The command that gives a file or a folder a new name on the host. */
export function renameCommand(from: string, to: string): string {
  return isWindowsPath(from) ? `move /Y ${shellQuote(from)} ${shellQuote(to)}` : `mv -n -- ${shellQuote(from)} ${shellQuote(to)}`
}

/**
 * The command that finds text in the files of a folder. Inside a git
 * repository `git grep` reads only the files of the project; elsewhere the
 * search of the system reads every file.
 */
export function searchCommand(folder: string, words: string, inGit: boolean): string {
  const text = isWindowsPath(folder) ? `"${words.replace(/"/g, '')}"` : `'${words.replace(/'/g, `'\\''`)}'`
  const enter = isWindowsPath(folder) ? `cd /d ${shellQuote(folder)}` : `cd ${shellQuote(folder)}`

  if (inGit) {
    return `${enter} && git grep -n -I -i --untracked -F -e ${text}`
  }

  return isWindowsPath(folder) ? `${enter} && findstr /s /n /i /l /c:${text} *` : `${enter} && grep -rnIi -F --exclude-dir=.git --exclude-dir=node_modules -e ${text} .`
}

export interface SearchHit {
  /** The path of the file, from the folder that was searched. */
  file: string
  line: number
  text: string
}

/** The answer of a search command as rows: `file:line:text`. Lines of another shape are left out. */
export function searchHits(output: string, limit = 200): SearchHit[] {
  const hits: SearchHit[] = []

  for (const row of output.split('\n')) {
    const match = /^(?:\.[\\/])?(.+?):(\d+):(.*)$/.exec(row)

    if (match) {
      hits.push({ file: match[1], line: Number(match[2]), text: match[3].trim().slice(0, 200) })

      if (hits.length >= limit) {
        break
      }
    }
  }

  return hits
}
