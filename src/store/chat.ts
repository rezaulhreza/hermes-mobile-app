/**
 * Open conversations. A conversation is keyed by its LIVE session id: the id
 * `session.create` / `session.resume` returns, and the id every event carries.
 * The stored id (the row in the session list) only opens a conversation.
 */

import { map } from 'nanostores'

import type {
  CompleteSlashResult,
  CompletionItem,
  CompletionItemsResult,
  ModelOptionsResult,
  SessionCreateResult,
  SessionLiveInfo,
  SessionResumeResult
} from '@/core/gateway/gateway-contract.generated'
import { isSlashCommand, slashOutcome, splitSlash, type Trigger } from '@/core/composer'
import { type ModelChoice, type ReasoningLevel, sessionModelValue } from '@/core/models'
import {
  EMPTY_TRANSCRIPT,
  reduceTranscript,
  type Transcript,
  transcriptFromHistory,
  withCommandOutput,
  withNotice,
  withUserMessage
} from '@/core/transcript'

import { onGatewayEvent, rpc } from './link'

export interface Conversation {
  sessionId: string
  title: string
  info: SessionLiveInfo
  transcript: Transcript
}

export const $conversations = map<Record<string, Conversation>>({})

function patch(sessionId: string, change: (conversation: Conversation) => Conversation): void {
  const current = $conversations.get()[sessionId]

  if (current) {
    $conversations.setKey(sessionId, change(current))
  }
}

/** Start a new conversation. Returns its live session id. */
export async function createConversation(): Promise<string> {
  const result = await rpc<SessionCreateResult>('session.create', { source: 'mobile' })

  $conversations.setKey(result.session_id, {
    sessionId: result.session_id,
    title: result.info?.title ?? '',
    info: result.info ?? {},
    transcript: EMPTY_TRANSCRIPT
  })

  return result.session_id
}

/** Open a stored conversation. Returns its live session id. */
export async function resumeConversation(storedId: string, title = ''): Promise<string> {
  const result = await rpc<SessionResumeResult>('session.resume', { session_id: storedId, source: 'mobile' })

  $conversations.setKey(result.session_id, {
    sessionId: result.session_id,
    title: result.info?.title ?? title,
    info: result.info ?? {},
    transcript: transcriptFromHistory(result.messages ?? [], Boolean(result.running))
  })

  return result.session_id
}

/** Send a draft. A slash command runs as a command; anything else goes to the agent. Returns text to put back in the composer, if any. */
export async function sendDraft(sessionId: string, text: string): Promise<string> {
  const trimmed = text.trim()

  if (!trimmed) {
    return ''
  }

  if (isSlashCommand(trimmed)) {
    return runSlash(sessionId, trimmed)
  }

  await submitPrompt(sessionId, trimmed)

  return ''
}

async function submitPrompt(sessionId: string, text: string): Promise<void> {
  patch(sessionId, c => ({ ...c, transcript: withUserMessage(c.transcript, text) }))

  try {
    await rpc('prompt.submit', { session_id: sessionId, text, surface: 'mobile' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    patch(sessionId, c => ({ ...c, transcript: reduceTranscript(c.transcript, { type: 'error', payload: { message } }) }))
  }
}

// An alias that names an alias that names the first one must not run forever.
const MAX_ALIAS_HOPS = 3

async function runSlash(sessionId: string, command: string, hops = 0): Promise<string> {
  const { name, arg } = splitSlash(command)
  let result: Record<string, unknown> | null

  try {
    result = await rpc<Record<string, unknown>>('slash.exec', { session_id: sessionId, command: command.replace(/^\//, '') })
  } catch (execError) {
    // Skills and a few commands are refused by the slash worker on purpose and
    // answer through command.dispatch. If that also fails, the first error is
    // the real one.
    try {
      result = await rpc<Record<string, unknown>>('command.dispatch', { session_id: sessionId, name, arg })
    } catch {
      const message = execError instanceof Error ? execError.message : String(execError)

      patch(sessionId, c => ({ ...c, transcript: withNotice(c.transcript, `/${name}: ${message}`, 'error') }))

      return ''
    }
  }

  const outcome = slashOutcome(result, arg)

  switch (outcome.kind) {
    case 'alias':
      if (hops >= MAX_ALIAS_HOPS) {
        patch(sessionId, c => ({ ...c, transcript: withNotice(c.transcript, `/${name}: alias loop`, 'error') }))

        return ''
      }

      return runSlash(sessionId, outcome.command, hops + 1)

    case 'submit':
      if (outcome.notice) {
        patch(sessionId, c => ({ ...c, transcript: withNotice(c.transcript, outcome.notice) }))
      }

      await submitPrompt(sessionId, outcome.text)

      return ''

    case 'prefill':
      if (outcome.notice) {
        patch(sessionId, c => ({ ...c, transcript: withNotice(c.transcript, outcome.notice) }))
      }

      return outcome.text

    case 'output':
      patch(sessionId, c => ({ ...c, transcript: withCommandOutput(c.transcript, command, outcome.text) }))

      return ''
  }
}

export interface Completions {
  items: CompletionItem[]
  replaceFrom: number | null
}

/** Completions for the word the user is typing. Never throws: no completions is a normal answer. */
export async function completeDraft(sessionId: string, trigger: Trigger): Promise<Completions> {
  try {
    if (trigger.kind === 'slash') {
      const result = await rpc<CompleteSlashResult>('complete.slash', { session_id: sessionId, text: trigger.word }, 8000)

      return { items: result.items ?? [], replaceFrom: result.replace_from ?? null }
    }

    const result = await rpc<CompletionItemsResult>('complete.path', { session_id: sessionId, word: trigger.word }, 8000)

    return { items: result.items ?? [], replaceFrom: null }
  } catch {
    return { items: [], replaceFrom: null }
  }
}

export function stopTurn(sessionId: string): Promise<unknown> {
  return rpc('session.interrupt', { session_id: sessionId })
}

export function loadModelOptions(sessionId: string): Promise<ModelOptionsResult> {
  return rpc<ModelOptionsResult>('model.options', { session_id: sessionId })
}

export type ModelSwitch = { done: true } | { done: false; confirmMessage: string }

/**
 * Switch the model of one conversation. The backend asks for a confirmation
 * before an expensive model; the caller shows the message and calls again
 * with `confirmed`. A switch during a turn applies at the next turn, and the
 * backend then publishes `session.info`, which is what updates the title bar.
 */
export async function switchModel(sessionId: string, choice: ModelChoice, confirmed = false): Promise<ModelSwitch> {
  const result = await rpc<{ confirm_required?: boolean; confirm_message?: string; deferred?: boolean }>('config.set', {
    session_id: sessionId,
    key: 'model',
    value: sessionModelValue(choice),
    ...(confirmed ? { confirm_expensive_model: true } : {})
  })

  if (result?.confirm_required && !confirmed) {
    return { done: false, confirmMessage: result.confirm_message || `Switch to ${choice.label}?` }
  }

  if (!result?.deferred) {
    patch(sessionId, c => ({ ...c, info: { ...c.info, model: choice.model, provider: choice.provider } }))
  }

  return { done: true }
}

export async function setReasoning(sessionId: string, level: ReasoningLevel): Promise<void> {
  const result = await rpc<{ value?: unknown }>('config.set', { session_id: sessionId, key: 'reasoning', value: level })
  const applied = typeof result?.value === 'string' ? result.value : level

  patch(sessionId, c => ({ ...c, info: { ...c.info, reasoning_effort: applied } }))
}

export function clearConversations(): void {
  $conversations.set({})
}

onGatewayEvent(event => {
  const sessionId = event.session_id

  if (!sessionId) {
    return
  }

  if (event.type === 'session.title') {
    const title = (event.payload as { title?: unknown } | undefined)?.title

    if (typeof title === 'string') {
      patch(sessionId, c => ({ ...c, title }))
    }

    return
  }

  if (event.type === 'session.info') {
    const info = event.payload as SessionLiveInfo | undefined

    if (info) {
      patch(sessionId, c => ({ ...c, info: { ...c.info, ...info }, title: info.title || c.title }))
    }

    return
  }

  patch(sessionId, c => ({ ...c, transcript: reduceTranscript(c.transcript, event) }))
})
