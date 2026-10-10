/**
 * The transcript of one session, as a pure reducer over gateway events.
 *
 * The screen never reads events. It renders `Transcript.items`, and this
 * module is the only place that knows how a turn is assembled: a user row,
 * then tool rows and assistant text in the order they arrive, then a final
 * `message.complete` that settles the turn.
 */

import type { GatewayEvent } from './gateway/gateway-events'
import type { TranscriptMessage } from './gateway/gateway-contract.generated'

/**
 * What the backend did with a message sent during a turn. `queued`: it runs as
 * the next turn. `steered`: the model reads it after its current action, with
 * no new turn. `redirected`: the running turn changed course to follow it.
 */
export type Delivery = 'queued' | 'steered' | 'redirected'

export type TranscriptItem =
  | { kind: 'user'; key: string; text: string; delivery?: Delivery; attached?: string[] }
  | { kind: 'assistant'; key: string; text: string; streaming: boolean }
  | { kind: 'thinking'; key: string; text: string; streaming: boolean }
  | { kind: 'tool'; key: string; toolId: string; name: string; detail: string; state: 'running' | 'done'; durationS?: number }
  /** What a slash command printed. Not part of the conversation with the model. */
  | { kind: 'output'; key: string; command: string; text: string }
  | { kind: 'notice'; key: string; text: string; tone: 'info' | 'error' }

export interface Transcript {
  items: TranscriptItem[]
  /** A turn is in flight: the composer shows Stop and new text is queued. */
  running: boolean
  /** Short status line from the backend, e.g. "Compressing context". */
  status: string | null
  nextKey: number
}

export const EMPTY_TRANSCRIPT: Transcript = { items: [], running: false, status: null, nextKey: 0 }

/** Build a transcript from the stored history a `session.resume` returns. */
export function transcriptFromHistory(
  messages: readonly TranscriptMessage[],
  running = false,
  queuedText?: string | null
): Transcript {
  let transcript = EMPTY_TRANSCRIPT

  for (const message of messages) {
    const text = messageText(message)

    if (message.role === 'user' && text) {
      transcript = push(transcript, key => ({ kind: 'user', key, text }))
    } else if (message.role === 'assistant' && text) {
      transcript = push(transcript, key => ({ kind: 'assistant', key, text, streaming: false }))
    } else if (message.role === 'tool' && message.name) {
      const name = message.name

      transcript = push(transcript, key => ({
        kind: 'tool',
        key,
        toolId: message.tool_call_id ?? key,
        name,
        detail: message.context ?? '',
        state: 'done'
      }))
    }
  }

  return { ...withQueuedFromHistory(transcript, queuedText?.trim() ?? ''), running }
}

/**
 * A prompt still waiting in the backend queue when the conversation opens. The
 * backend stores a queued prompt the moment it accepts it, so the history
 * normally holds it already and only the label is missing.
 */
function withQueuedFromHistory(transcript: Transcript, text: string): Transcript {
  if (!text) {
    return transcript
  }

  const last = transcript.items[transcript.items.length - 1]

  if (last?.kind === 'user' && last.text.trim() === text) {
    return { ...transcript, items: [...transcript.items.slice(0, -1), { ...last, delivery: 'queued' }] }
  }

  return push(transcript, key => ({ kind: 'user', key, text, delivery: 'queued' }))
}

/** The key the next added row gets. Lets the sender label its own row when the backend answers. */
export function nextItemKey(transcript: Transcript): string {
  return `i${transcript.nextKey}`
}

/** Record what the backend did with a message sent during a turn. */
export function withDelivery(transcript: Transcript, key: string, delivery: Delivery): Transcript {
  return {
    ...transcript,
    items: transcript.items.map(item => (item.kind === 'user' && item.key === key ? { ...item, delivery } : item))
  }
}

/** Add the user's own message the moment they send it. */
export function withUserMessage(transcript: Transcript, text: string, attached: readonly string[] = []): Transcript {
  const files = attached.length ? { attached: [...attached] } : {}

  return { ...push(transcript, key => ({ kind: 'user', key, text, ...files })), running: true }
}

/** Add what a slash command printed. It does not start a turn. */
export function withCommandOutput(transcript: Transcript, command: string, text: string): Transcript {
  return push(transcript, key => ({ kind: 'output', key, command, text }))
}

export function withNotice(transcript: Transcript, text: string, tone: 'info' | 'error' = 'info'): Transcript {
  return push(transcript, key => ({ kind: 'notice', key, text, tone }))
}

export function reduceTranscript(transcript: Transcript, event: GatewayEvent): Transcript {
  switch (event.type) {
    case 'message.start':
      return { ...startQueuedTurn(transcript), running: true }

    case 'btw.complete':
    case 'background.complete': {
      const payload = event.payload as { text?: unknown; question?: unknown } | undefined
      const text = typeof payload?.text === 'string' ? payload.text.trim() : ''
      const name = event.type === 'btw.complete' ? '/btw' : '/bg'
      const question = typeof payload?.question === 'string' ? ` ${payload.question.trim()}` : ''

      return text ? withCommandOutput(transcript, `${name}${question}`, text) : transcript
    }

    case 'message.delta': {
      const text = (event as GatewayEvent<'message.delta'>).payload?.text ?? ''

      return text ? appendStream(transcript, 'assistant', text) : transcript
    }

    case 'reasoning.delta': {
      const text = (event.payload as { text?: unknown } | undefined)?.text

      return typeof text === 'string' && text ? appendStream(transcript, 'thinking', text) : transcript
    }

    // Not reasoning: the backend's "working" line (a face and a verb). It is
    // status, it replaces itself, and it never belongs in the transcript.
    case 'thinking.delta': {
      const text = (event.payload as { text?: unknown } | undefined)?.text

      return typeof text === 'string' && text.trim() ? { ...transcript, running: true, status: text.trim() } : transcript
    }

    case 'tool.start': {
      const payload = (event as GatewayEvent<'tool.start'>).payload

      if (!payload) {
        return transcript
      }

      return push(settleStream(transcript), key => ({
        kind: 'tool',
        key,
        toolId: payload.tool_id,
        name: payload.name,
        detail: payload.preview ?? payload.context ?? payload.args_text ?? '',
        state: 'running'
      }))
    }

    case 'tool.complete': {
      const payload = (event as GatewayEvent<'tool.complete'>).payload

      if (!payload) {
        return transcript
      }

      return {
        ...transcript,
        items: transcript.items.map(item =>
          item.kind === 'tool' && item.toolId === payload.tool_id
            ? { ...item, state: 'done', durationS: payload.duration_s ?? undefined, detail: payload.summary ?? item.detail }
            : item
        )
      }
    }

    case 'status.update': {
      const payload = (event as GatewayEvent<'status.update'>).payload as { text?: unknown } | undefined

      return { ...transcript, status: typeof payload?.text === 'string' && payload.text ? payload.text : null }
    }

    case 'message.complete':
      return completeTurn(transcript, (event as GatewayEvent<'message.complete'>).payload)

    case 'error': {
      const payload = (event as GatewayEvent<'error'>).payload as { message?: unknown } | undefined
      const text = typeof payload?.message === 'string' ? payload.message : 'Hermes reported an error.'

      return { ...push(settleStream(transcript), key => ({ kind: 'notice', key, text, tone: 'error' })), running: false }
    }

    default:
      return transcript
  }
}

function completeTurn(
  transcript: Transcript,
  payload: GatewayEvent<'message.complete'>['payload']
): Transcript {
  let next = settleStream(transcript)
  const finalText = typeof payload?.text === 'string' ? payload.text : ''
  const last = next.items[next.items.length - 1]

  // A turn with no deltas (a reused or non-streamed response) still carries its text here.
  if (finalText && !(last?.kind === 'assistant' && last.text.trim())) {
    next = push(next, key => ({ kind: 'assistant', key, text: finalText, streaming: false }))
  }

  if (payload?.status === 'error') {
    const text = payload.error || payload.failure_reason || 'The turn failed.'

    next = push(next, key => ({ kind: 'notice', key, text, tone: 'error' }))
  } else if (payload?.status === 'interrupted') {
    next = push(next, key => ({ kind: 'notice', key, text: 'Stopped', tone: 'info' }))
  }

  return {
    ...next,
    // A tool still marked running when the turn ends was cut short; it is not running.
    items: next.items.map(item => (item.kind === 'tool' && item.state === 'running' ? { ...item, state: 'done' } : item)),
    running: false,
    status: null
  }
}

/**
 * A turn starts. If a queued message waits, this turn is its turn: the message
 * moves below everything the last turn printed, as the backend stores it, and
 * loses its label. Queued messages run oldest first.
 */
function startQueuedTurn(transcript: Transcript): Transcript {
  const queued = transcript.items.find(item => item.kind === 'user' && item.delivery === 'queued')

  if (queued?.kind !== 'user') {
    return transcript
  }

  const { delivery: _sent, ...started } = queued
  const rest = transcript.items.filter(item => item !== queued)
  const firstWaiting = rest.findIndex(item => item.kind === 'user' && item.delivery === 'queued')
  const at = firstWaiting === -1 ? rest.length : firstWaiting

  return { ...transcript, items: [...rest.slice(0, at), started, ...rest.slice(at)] }
}

/** Grow the open row of this kind, or open one. A row of the other kind closes first. */
function appendStream(transcript: Transcript, kind: 'assistant' | 'thinking', text: string): Transcript {
  const last = transcript.items[transcript.items.length - 1]

  if (last?.kind === kind && last.streaming) {
    return {
      ...transcript,
      running: true,
      items: [...transcript.items.slice(0, -1), { ...last, text: last.text + text }]
    }
  }

  return { ...push(settleStream(transcript), key => ({ kind, key, text, streaming: true })), running: true }
}

function settleStream(transcript: Transcript): Transcript {
  const last = transcript.items[transcript.items.length - 1]

  if ((last?.kind !== 'assistant' && last?.kind !== 'thinking') || !last.streaming) {
    return transcript
  }

  return { ...transcript, items: [...transcript.items.slice(0, -1), { ...last, streaming: false }] }
}

function push(transcript: Transcript, make: (key: string) => TranscriptItem): Transcript {
  return {
    ...transcript,
    items: [...transcript.items, make(`i${transcript.nextKey}`)],
    nextKey: transcript.nextKey + 1
  }
}

function messageText(message: TranscriptMessage): string {
  if (typeof message.text === 'string') {
    return message.text
  }

  return typeof message.content === 'string' ? message.content : ''
}
