/**
 * Open conversations. A conversation is keyed by its LIVE session id: the id
 * `session.create` / `session.resume` returns, and the id every event carries.
 * The stored id (the row in the session list) only opens a conversation.
 */

import { map } from 'nanostores'

import type {
  ModelOptionsResult,
  SessionCreateResult,
  SessionLiveInfo,
  SessionResumeResult
} from '@/core/gateway/gateway-contract.generated'
import { type ModelChoice, type ReasoningLevel, sessionModelValue } from '@/core/models'
import {
  EMPTY_TRANSCRIPT,
  reduceTranscript,
  type Transcript,
  transcriptFromHistory,
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

export async function sendMessage(sessionId: string, text: string): Promise<void> {
  const trimmed = text.trim()

  if (!trimmed) {
    return
  }

  patch(sessionId, c => ({ ...c, transcript: withUserMessage(c.transcript, trimmed) }))

  try {
    await rpc('prompt.submit', { session_id: sessionId, text: trimmed, surface: 'mobile' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    patch(sessionId, c => ({ ...c, transcript: reduceTranscript(c.transcript, { type: 'error', payload: { message } }) }))
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
