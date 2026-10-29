const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A day as a person reads it: "11 Nov". The year is there only when it is not this year: "11 Nov 2025". */
export function dayWords(date: Date, now = new Date()): string {
  const day = `${date.getDate()} ${MONTHS[date.getMonth()]}`

  return date.getFullYear() === now.getFullYear() ? day : `${day} ${date.getFullYear()}`
}

/** A time of day as a person reads it: "8:00 pm", "12:05 am". */
export function clockWords(date: Date): string {
  const hour = date.getHours()

  return `${hour % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}`
}

/** A day and a time: "11 Nov at 8:00 pm". */
export function dateWords(date: Date, now = new Date()): string {
  return `${dayWords(date, now)} at ${clockWords(date)}`
}

// "2026-10-07", "2026-10-07 20:00", "2026-10-07T20:00:00.25+01:00". The sign before it must not be a digit or a "-": that is a longer number.
const TECHNICAL_DATE = /(^|[^\d-])(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\d-])/g

const STAMP = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}) (\d{2}):(\d{2})\b/g

/**
 * A text of the host with its dates as a person reads them: "once at
 * 2026-10-07 20:00" is "once at 7 Oct at 8:00 pm". The time is the time as
 * it is written: the host wrote it for its own clock, and no zone is changed.
 * For a name, a title and a label. Not for the words of a message: there a
 * date is what somebody wrote.
 */
export function readableDates(text: string, now = new Date()): string {
  return text.replace(TECHNICAL_DATE, (whole: string, before: string, year: string, month: string, day: string, hour?: string, minute?: string) => {
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour ?? 0), Number(minute ?? 0))

    // "2026-13-45" is not a date: a number that only looks like one stays as it is.
    if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day) || Number(hour ?? 0) > 23 || Number(minute ?? 0) > 59) {
      return whole
    }

    return before + (hour === undefined ? dayWords(date, now) : dateWords(date, now))
  }).replace(STAMP, (whole: string, month: string, day: string, hour: string, minute: string) =>
    // The stamp the host puts at the end of a title: "Oct 10 20:31".
    Number(day) <= 31 && Number(hour) <= 23 && Number(minute) <= 59 ? `${Number(day)} ${month} at ${clockWords(new Date(2000, 0, 1, Number(hour), Number(minute)))}` : whole
  )
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

  return dayWords(new Date(at * 1000), new Date(now))
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
  // A row is a label: a date in it reads as a date.
  return readableDates(withoutMarkdown(text).replace(TERMINAL_DECORATION, ' ').replace(/\s+/g, ' ').trim())
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
