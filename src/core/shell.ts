/**
 * The terminal of the app: a login shell on the host, from the phone-shell
 * plugin (`host/phone-shell`). The shell runs in a pseudo-terminal on the
 * host and outlives the socket, so a dev server keeps running when the
 * screen closes. This file holds what the screen sends and reads.
 */

export interface ShellInfo {
  id: string
  /** The folder the shell started in. Null when the host did not say. */
  cwd: string | null
  /** Seconds since 1970. Null when the host did not say. */
  started: number | null
}

/** The keys a phone keyboard does not have, as the bytes a terminal sends for them. */
export const SHELL_KEYS: readonly { label: string; name: string; bytes: string }[] = [
  { label: 'esc', name: 'Escape', bytes: '\x1b' },
  { label: 'tab', name: 'Tab', bytes: '\t' },
  { label: '↑', name: 'Up', bytes: '\x1b[A' },
  { label: '↓', name: 'Down', bytes: '\x1b[B' },
  { label: '←', name: 'Left', bytes: '\x1b[D' },
  { label: '→', name: 'Right', bytes: '\x1b[C' },
  { label: '|', name: 'Pipe', bytes: '|' },
  { label: '~', name: 'Tilde', bytes: '~' },
  { label: '/', name: 'Slash', bytes: '/' },
  { label: '-', name: 'Dash', bytes: '-' }
]

/** The host closes the socket with this code when the shell itself ended. */
export const SHELL_ENDED = 4410

const ID = /^[A-Za-z0-9_-]{1,64}$/

export function newShellId(random: () => number = Math.random): string {
  return `s${Date.now().toString(36)}${Math.floor(random() * 36 ** 4).toString(36)}`
}

/** The path of the socket of one shell. The plugin starts the shell in `cwd` the first time. */
export function shellSocketPath(id: string, cwd: string | null, size: { cols: number; rows: number }): string {
  const query = [`id=${encodeURIComponent(id)}`, cwd ? `cwd=${encodeURIComponent(cwd)}` : '', `cols=${size.cols}`, `rows=${size.rows}`].filter(Boolean).join('&')

  return `/api/plugins/phone-shell/pty?${query}`
}

/** The frame that resizes the pseudo-terminal, as on the core `/api/pty`. */
export function resizeFrame(cols: number, rows: number): string {
  return `\x1b[RESIZE:${Math.max(2, Math.round(cols))};${Math.max(2, Math.round(rows))}]`
}

/**
 * A typed key with Ctrl held: a letter (and the few signs that have one)
 * becomes its control code. Ctrl-C is 0x03. Any other text is sent as it is.
 */
export function withControl(text: string): string {
  if (text.length !== 1) {
    return text
  }

  const code = text.toUpperCase().charCodeAt(0)

  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : text
}

/** The shells the host has, from `GET /api/plugins/phone-shell/shells`. Anything odd is left out. */
export function shellsFrom(result: unknown): ShellInfo[] {
  const rows = (result as { shells?: unknown } | null)?.shells

  return (Array.isArray(rows) ? rows : []).flatMap((row: Record<string, unknown>): ShellInfo[] =>
    typeof row?.id === 'string' && ID.test(row.id)
      ? [{ id: row.id, cwd: typeof row.cwd === 'string' ? row.cwd : null, started: typeof row.started === 'number' ? row.started : null }]
      : []
  )
}

/** The name of a shell on its tab: the last folder of where it started. */
export function shellLabel(shell: Pick<ShellInfo, 'cwd'>): string {
  const folder = (shell.cwd ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop()

  return folder || 'shell'
}
