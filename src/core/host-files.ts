/**
 * Files on the Hermes host that an answer names. The agent writes a host path
 * ("saved to /Users/me/shot.png"), which nobody can open on a phone. The chat
 * shows the file under the answer instead, and the answer keeps only the name.
 */

import { attachmentKind, type SentAttachment } from './attachments'

/** A row of previews under one answer stays short. */
const MAX_FILES = 8

// A fenced code block is a sample, not a list of files. It is left alone.
const FENCE = /(```[\s\S]*?(?:```|$))/
// The backend's own mark for a file to deliver: `MEDIA:/path/to/file`.
const MEDIA = /MEDIA:\s*(?:"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`|(\S+))/g
// A path in code marks may hold spaces.
const QUOTED = /`((?:[A-Za-z]:)?[\\/][^`\n]*\.[A-Za-z0-9]{1,8})`/g
// A bare path ends at white space. A character before it that belongs to a word or an address rules it out.
const BARE = /(^|[\s("'[])((?:[A-Za-z]:)?[\\/][^\s`'"<>()[\]]*\.[A-Za-z0-9]{1,8})(?=[\s`'".,;:!?)\]]|$)/gm

function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** A host file has a folder and a name: one separator alone ("/etc.txt", a fraction, a route) is not enough. */
function isHostFile(path: string): boolean {
  return (path.match(/[\\/]/g)?.length ?? 0) >= 2 && !path.includes('//')
}

/** The folder of a host path, with the separator the path uses. Null for a path with no folder. */
export function hostFolder(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))

  if (cut < 0) {
    return null
  }

  // The root ("/x.png", "C:\\x.png") keeps its separator.
  return cut === 0 || path[cut - 1] === ':' ? path.slice(0, cut + 1) : path.slice(0, cut)
}

/**
 * The files that are on the host, given the names in each of their folders.
 * An answer can name a path that was never written, or a file that is gone:
 * a row for it would open nothing.
 */
export function filesThatExist<T extends { name: string; path?: string }>(files: readonly T[], namesIn: ReadonlyMap<string, ReadonlySet<string>>): T[] {
  return files.filter(file => {
    const folder = file.path ? hostFolder(file.path) : null

    return folder !== null && (namesIn.get(folder)?.has(file.name) ?? false)
  })
}

export interface AnswerFiles {
  /** The answer with each host path cut to the name of its file. */
  text: string
  files: SentAttachment[]
}

export function answerFiles(answer: string): AnswerFiles {
  const files: SentAttachment[] = []

  const keep = (path: string): boolean => {
    if (!isHostFile(path)) {
      return false
    }

    if (!files.some(file => file.path === path) && files.length < MAX_FILES) {
      const name = nameOf(path)

      files.push({ name, kind: attachmentKind({ name }), path })
    }

    return files.some(file => file.path === path)
  }

  const text = answer
    .split(FENCE)
    .map((part, index) => {
      if (index % 2) {
        return part
      }

      return part
        .replace(MEDIA, (whole, a?: string, b?: string, c?: string, d?: string) => (keep(a ?? b ?? c ?? d ?? '') ? '' : whole))
        .replace(QUOTED, (whole, path: string) => (keep(path) ? `\`${nameOf(path)}\`` : whole))
        .replace(BARE, (whole, before: string, path: string) => (keep(path) ? `${before}${nameOf(path)}` : whole))
    })
    .join('')

  // A `MEDIA:` mark on a line of its own leaves an empty line behind.
  return files.length ? { text: text.replace(/\n{3,}/g, '\n\n').trim(), files } : { text: answer, files }
}
