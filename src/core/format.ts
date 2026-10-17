export function greeting(now: Date): string {
  const hour = now.getHours()

  if (hour < 5) {
    return 'Good night'
  }

  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

/** A short age for a list row: "now", "12m", "3h", "5d", then a date. `at` is Unix seconds. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor(now / 1000 - at))

  if (seconds < 60) {
    return 'now'
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`
  }

  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h`
  }

  if (seconds < 7 * 86_400) {
    return `${Math.floor(seconds / 86_400)}d`
  }

  return new Date(at * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "0.4s", "12s", "2m 5s" for a tool row. */
export function duration(seconds: number): string {
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }

  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/** "640 B", "340 KB", "1.2 MB" for a file. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  const megabytes = bytes / (1024 * 1024)

  return `${megabytes < 10 ? megabytes.toFixed(1) : Math.round(megabytes)} MB`
}

// Private-use glyphs (terminal prompt icons), box drawing and block elements:
// decoration from pasted terminal output that a phone font cannot draw.
const TERMINAL_DECORATION = /[\uE000-\uF8FF\u2500-\u259F]|[\uDB80-\uDBFF][\uDC00-\uDFFF]/g

/**
 * A text without the marks of Markdown: a row of a list shows words, and it
 * does not draw Markdown. The text can be cut in the middle (the host cuts a
 * preview), so a mark with no partner goes too.
 */
function withoutMarkdown(text: string): string {
  return (
    text
      .replace(/```[\w-]*/g, ' ')
      // A link and a picture: their words.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // At the start of a line: a heading, a quote, a list, a rule.
      .replace(/^[ \t]{0,3}(?:#{1,6}|>+|[-*+]|\d+[.)])[ \t]+/gm, '')
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, ' ')
      .replace(/\*\*|~~/g, '')
      // One star around words. A star with a space beside it is a sign of its own ("2 * 3").
      .replace(/(^|[\s(])\*(?=\S)([^*\n]*?\S)\*(?=[\s).,;:!?]|$)/g, '$1$2')
      .replace(/`/g, '')
  )
}

/** One readable line for a list row, from text that may be Markdown or pasted terminal output. */
export function previewLine(text: string): string {
  return withoutMarkdown(text).replace(TERMINAL_DECORATION, ' ').replace(/\s+/g, ' ').trim()
}

/** The first lines of a long text, and how many lines were left out. */
export function headLines(text: string, limit: number): { head: string; hidden: number } {
  const lines = text.replace(/\s+$/, '').split('\n')

  if (lines.length <= limit) {
    return { head: lines.join('\n'), hidden: 0 }
  }

  return { head: lines.slice(0, limit).join('\n'), hidden: lines.length - limit }
}

/**
 * The words of the backend's "working" line, with its drawn face cut off:
 * "◉_◉ analyzing..." gives "Analyzing…". The face is the host's skin (a
 * kaomoji); the phone shows its own animated mark in that place. A line with
 * no plain words at its end is returned as it is.
 */
export function statusWords(text: string): string {
  const words = /([A-Za-z][A-Za-z' -]*?)\s*(?:\.{2,}|…)?\s*$/.exec(text)?.[1]?.trim()

  if (!words) {
    return text.trim()
  }

  const dots = /(?:\.{2,}|…)\s*$/.test(text) ? '…' : ''

  return `${words[0]!.toUpperCase()}${words.slice(1)}${dots}`
}

/**
 * What went wrong, in the words of the host and nothing else: a refused
 * request arrives as `400: {"detail":"..."}`, and a person needs only the
 * sentence. Text that is no such answer comes back as it is.
 */
export function faultWords(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const body = text.replace(/^(HttpError: )?\d{3}: /, '')

  try {
    const detail = (JSON.parse(body) as { detail?: unknown; message?: unknown }) ?? {}
    const words = typeof detail.detail === 'string' ? detail.detail : typeof detail.message === 'string' ? detail.message : ''

    return words || body
  } catch {
    return body
  }
}
