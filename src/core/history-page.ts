/**
 * A page of a stored conversation, from the REST messages route.
 *
 * `session.resume` answers with the whole history: up to 1.5 MB for a long
 * chat, and every row of it in memory. The chat screen asks for a resume with
 * no history instead, and reads the newest rows from the REST route, then one
 * older page each time the user reaches the top.
 *
 * The REST rows are the stored rows. `session.resume` gives rows made for
 * display. `pageMessages` turns the first kind into the second, so one
 * function (`transcriptFromHistory`) builds the rows of the screen.
 */

import type { TranscriptMessage } from './gateway/gateway-contract.generated'
import { skillInvocationText } from './gateway/skill-scaffold'

/** Stored rows a request. A turn with many tool calls is many rows. */
export const HISTORY_PAGE = 60

export interface StoredMessage {
  id?: number | null
  role?: string | null
  content?: unknown
  /** What to show in the place of `content`, when the host made one (a summary of compacted history, a steer). */
  display_content?: unknown
  display_kind?: string | null
  tool_calls?: unknown
  tool_call_id?: string | null
  tool_name?: string | null
}

export interface HistoryPage {
  messages?: StoredMessage[]
}

/** The address of a page. `offset` counts stored rows back from the newest. */
export function historyPagePath(storedId: string, offset: number): string {
  return `/api/sessions/${encodeURIComponent(storedId)}/messages?order=latest&limit=${HISTORY_PAGE}&offset=${offset}&inline_images=false`
}

// A wake of a background process that an older host stored as a user row.
const HEARTBEAT_ROW = /^\[Background process \S+ heartbeat #\d+ /
// A routing note for the model in a Discord turn. The user did not write it.
const DISCORD_NOTE = /(^|\n)\[Triggering message id: `[^`\n]*` — use as `message_id` for reply\/react\/pin via the discord tools\.\]\n*/
const PREVIEW_CHARS = 80
/** The argument that says what a tool call did, in the order of how much it says. */
const MAIN_ARGUMENTS = ['command', 'path', 'file_path', 'url', 'query', 'pattern', 'prompt', 'goal', 'action', 'name']

function textOf(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (!Array.isArray(value)) {
    return ''
  }

  // Parts of a message: the text parts are the words, a picture has a mark.
  return value
    .map(part => {
      const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown }

      return typeof text === 'string' ? text : type === 'image_url' || type === 'image' || type === 'input_image' ? '[image]' : ''
    })
    .filter(Boolean)
    .join('\n')
}

function callsOf(message: StoredMessage): { id: string; name: string; args: Record<string, unknown> }[] {
  let calls = message.tool_calls

  // The REST route carries the JSON text of the database for some hosts.
  if (typeof calls === 'string') {
    try {
      calls = JSON.parse(calls)
    } catch {
      return []
    }
  }

  if (!Array.isArray(calls)) {
    return []
  }

  return calls.flatMap(call => {
    const { id, function: fn } = (call ?? {}) as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }

    if (typeof id !== 'string' || typeof fn?.name !== 'string') {
      return []
    }

    let args: unknown = fn.arguments

    if (typeof args === 'string') {
      try {
        args = JSON.parse(args)
      } catch {
        args = {}
      }
    }

    return [{ id, name: fn.name, args: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {} }]
  })
}

/** One line that says what a tool call did: its main argument, cut short. */
export function toolPreview(args: Record<string, unknown>): string {
  const texts = Object.entries(args).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
  const main = MAIN_ARGUMENTS.map(name => texts.find(([key]) => key === name)).find(Boolean) ?? texts[0]
  const line = (main?.[1] ?? '').trim().split('\n')[0]

  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS - 1)}…` : line
}

/**
 * Stored rows as the display rows of `session.resume`. A tool row gets its
 * name and its arguments from the call of the assistant row before it. The
 * output of a tool is left out: the tool sheet asks for it when it opens.
 */
export function pageMessages(rows: readonly StoredMessage[]): TranscriptMessage[] {
  const calls = new Map<string, { name: string; args: Record<string, unknown> }>()
  const messages: TranscriptMessage[] = []

  for (const row of rows) {
    const role = row.role

    if (role === 'assistant') {
      for (const call of callsOf(row)) {
        calls.set(call.id, call)
      }
    }

    if (row.display_kind === 'hidden' || (role !== 'user' && role !== 'assistant' && role !== 'tool')) {
      continue
    }

    if (role === 'tool') {
      const call = calls.get(row.tool_call_id ?? '')
      const args = call?.args ?? {}

      messages.push({
        role,
        name: call?.name || row.tool_name || 'tool',
        context: toolPreview(args),
        ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
        ...(Object.keys(args).length ? { args } : {})
      })

      continue
    }

    let text = typeof row.display_content === 'string' ? row.display_content : textOf(row.content)

    if (role === 'user') {
      if (HEARTBEAT_ROW.test(text.trim())) {
        continue
      }

      text = text.replace(DISCORD_NOTE, '$1')
      text = skillInvocationText(text) ?? text
    }

    if (text.trim()) {
      messages.push({ role, text, ...(typeof row.id === 'number' ? { row_id: row.id } : {}) })
    }
  }

  return messages
}

/** The lowest row id of a page: the mark of how far back the screen has rows. */
export function oldestRowId(rows: readonly StoredMessage[]): number | null {
  const ids = rows.map(row => row.id).filter((id): id is number => typeof id === 'number')

  return ids.length ? Math.min(...ids) : null
}

/**
 * The rows of an older page that the screen does not have yet. A turn that
 * runs adds rows at the newest end, so a page counted from that end can
 * repeat rows of the page before it.
 */
export function rowsBefore(rows: readonly StoredMessage[], oldestId: number | null): StoredMessage[] {
  return oldestId === null ? [...rows] : rows.filter(row => typeof row.id !== 'number' || row.id < oldestId)
}
