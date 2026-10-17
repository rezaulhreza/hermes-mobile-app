/**
 * What a tool row can show when the user opens it: what the agent asked the
 * tool to do, what came back, and the change to a file when there was one.
 */

export interface ToolDetail {
  /** The arguments, one per line, as the agent wrote them. */
  input?: string
  output?: string
  /** A unified diff of the file the tool changed. */
  diff?: string
  /** The host path of the picture the tool took (a capture of the screen). */
  picture?: string
}

// A tool can print megabytes. The sheet is for reading; the agent has the full text.
const OUTPUT_LIMIT = 20_000

function clip(text: string): string {
  return text.length > OUTPUT_LIMIT ? `${text.slice(0, OUTPUT_LIMIT)}\n… (${text.length - OUTPUT_LIMIT} more characters)` : text
}

function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || value === undefined) {
    return ''
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

/**
 * The arguments as text. One short value per line reads better on a phone
 * than JSON; a long or nested value keeps its JSON shape under its name.
 */
export function toolInput(args: Record<string, unknown> | null | undefined, fallback?: string | null): string | undefined {
  const entries = Object.entries(args ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== '')

  if (!entries.length) {
    return fallback?.trim() || undefined
  }

  // A tool with one argument (a command, a path) needs no name in front of it.
  if (entries.length === 1 && typeof entries[0][1] === 'string') {
    return clip(entries[0][1])
  }

  return clip(
    entries
      .map(([name, value]) => {
        const text = asText(value)

        return text.includes('\n') ? `${name}:\n${text}` : `${name}: ${text}`
      })
      .join('\n')
  )
}

export function toolOutput(resultText: string | null | undefined, result?: unknown): string | undefined {
  const text = (resultText ?? '').trim() || asText(result).trim()

  return text ? clip(text) : undefined
}

/**
 * The output of a tool as the backend stores it. Most tools store a JSON
 * object with `output`, and an `exit_code` or `error` when something failed.
 * The user wants the output, and the failure only when there is one.
 */
export function storedToolOutput(content: unknown): string | undefined {
  let value = content

  if (typeof content === 'string') {
    try {
      value = JSON.parse(content)
    } catch {
      return toolOutput(content)
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof (value as { output?: unknown }).output !== 'string') {
    return toolOutput(null, value)
  }

  const { output, exit_code: exitCode, error } = value as { output: string; exit_code?: unknown; error?: unknown }
  const lines = [output.replace(/\s+$/, '')]

  if (typeof exitCode === 'number' && exitCode !== 0) {
    lines.push(`exit code ${exitCode}`)
  }

  if (typeof error === 'string' && error.trim()) {
    lines.push(error.trim())
  }

  return toolOutput(lines.filter(Boolean).join('\n'))
}

// The path can hold spaces. It ends at the quote of its JSON value, or at white space in a sentence.
const PICTURE_IN_JSON = /"screenshot_path"\s*:\s*"((?:[^"\\]|\\.)+)"/
const PICTURE_IN_WORDS = /screenshot saved to\s+(\S+\.(?:png|jpe?g|webp))/i

/**
 * The picture a tool took, as a path on the host. A capture of the screen
 * names it in `screenshot_path` of its result; a stored result is JSON text
 * with the same field, and the short summary says "saved to <path>".
 */
export function toolPicture(result: unknown, text?: string | null): string | undefined {
  const direct = (result as { screenshot_path?: unknown } | null | undefined)?.screenshot_path

  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim()
  }

  const inJson = PICTURE_IN_JSON.exec(text ?? '')

  if (inJson) {
    try {
      return JSON.parse(`"${inJson[1]}"`) as string
    } catch {
      return inJson[1]
    }
  }

  return PICTURE_IN_WORDS.exec(text ?? '')?.[1]
}

/** Only the fields that have something, so a row with no detail has no empty object to compare. */
export function toolDetail(detail: ToolDetail): ToolDetail {
  return Object.fromEntries(Object.entries(detail).filter(([, value]) => typeof value === 'string' && value.trim())) as ToolDetail
}

export function hasToolDetail(detail: ToolDetail): boolean {
  return Boolean(detail.input || detail.output || detail.diff || detail.picture)
}

export type DiffLineKind = 'add' | 'remove' | 'hunk' | 'file' | 'context'

/** The lines of a unified diff with what each one is, for colour. */
export function diffLines(diff: string): { kind: DiffLineKind; text: string }[] {
  return diff
    .replace(/\s+$/, '')
    .split('\n')
    .map(text => ({
      kind: /^(\+\+\+|---|diff |index )/.test(text)
        ? 'file'
        : text.startsWith('@@')
          ? 'hunk'
          : text.startsWith('+')
            ? 'add'
            : text.startsWith('-')
              ? 'remove'
              : 'context',
      text
    }))
}

/**
 * The keys of the assistant rows that end a turn: the answer the user reads,
 * not the short lines between tool calls. Copy and share sit under these.
 */
export function finalAnswerKeys(items: readonly { kind: string; key: string; streaming?: boolean }[], running: boolean): Set<string> {
  const keys = new Set<string>()

  items.forEach((item, index) => {
    if (item.kind !== 'assistant' || item.streaming) {
      return
    }

    const next = items.slice(index + 1).find(other => other.kind !== 'notice' && other.kind !== 'output')

    // The last row of a turn in flight can still grow into more work.
    if (next ? next.kind === 'user' || next.kind === 'arrival' : !running) {
      keys.add(item.key)
    }
  })

  return keys
}
