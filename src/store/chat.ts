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
  PromptSubmitResult,
  SessionBranchResult,
  SessionCompressResult,
  SessionCorrectionResult,
  SessionCreateResult,
  SessionLiveInfo,
  SessionResumeResult,
  SessionTitleResult
} from '@/core/gateway/gateway-contract.generated'
import { type Attachment, promptWithAttachments } from '@/core/attachments'
import { phoneAction, type PhoneAction, phoneBlock, phoneCompletions } from '@/core/commands'
import { isSlashCommand, slashOutcome, splitSlash, type Trigger } from '@/core/composer'
import { type ModelChoice, type ReasoningLevel, sessionModelValue } from '@/core/models'
import {
  type Delivery,
  EMPTY_TRANSCRIPT,
  nextItemKey,
  reduceTranscript,
  type Transcript,
  transcriptFromHistory,
  withCommandOutput,
  withDelivery,
  withNotice,
  withUserMessage
} from '@/core/transcript'

import { takeAttachments } from './attachments'
import { $catalog, loadCatalog } from './commands'
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
    transcript: transcriptFromHistory(result.messages ?? [], Boolean(result.running), result.queued?.user)
  })

  return result.session_id
}

/** What the screen must do after a draft was sent. Most drafts need nothing. */
export type DraftEffect =
  | { kind: 'none' }
  /** A command handed text back for the user to finish. */
  | { kind: 'prefill'; text: string }
  /** Show this live conversation instead (a new chat, a branch). */
  | { kind: 'open'; sessionId: string }
  | { kind: 'sheet'; sheet: 'model' | 'commands' }
  /** Go to the list of conversations. */
  | { kind: 'sessions' }

const NOTHING: DraftEffect = { kind: 'none' }

/** How a message sent during a turn reaches the agent. `queue` waits for the turn; `steer` joins it. */
export type SendMode = 'queue' | 'steer'

/** Send a draft. A slash command runs as a command; anything else goes to the agent. */
export async function sendDraft(sessionId: string, text: string, mode: SendMode = 'queue'): Promise<DraftEffect> {
  const trimmed = text.trim()

  if (isSlashCommand(trimmed)) {
    // A command takes no attachments. They stay staged for the next message.
    return runSlash(sessionId, trimmed)
  }

  const attachments = takeAttachments(sessionId)

  if (!trimmed && !attachments.length) {
    return NOTHING
  }

  // Steering puts text into the running turn. Files need a turn of their own.
  await (mode === 'steer' && !attachments.length ? steerTurn(sessionId, trimmed) : submitPrompt(sessionId, trimmed, attachments))

  return NOTHING
}

function note(sessionId: string, text: string, tone: 'info' | 'error' = 'info'): void {
  patch(sessionId, c => ({ ...c, transcript: withNotice(c.transcript, text, tone) }))
}

function fail(sessionId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)

  patch(sessionId, c => ({ ...c, transcript: reduceTranscript(c.transcript, { type: 'error', payload: { message } }) }))
}

/** Add the user's row now and return its key, so the backend's answer can label it. */
function showUserMessage(sessionId: string, text: string, attached: readonly string[] = []): string {
  const current = $conversations.get()[sessionId]
  const key = current ? nextItemKey(current.transcript) : ''

  patch(sessionId, c => ({ ...c, transcript: withUserMessage(c.transcript, text, attached) }))

  return key
}

function label(sessionId: string, key: string, delivery: Delivery): void {
  patch(sessionId, c => ({ ...c, transcript: withDelivery(c.transcript, key, delivery) }))
}

/**
 * Send a message to the agent. During a turn the app always asks for the
 * queue: the backend's own default for a mid-turn message is to interrupt the
 * turn, and a send button must never stop work the user did not ask to stop.
 * The backend decides in the end (the turn can finish first), so the label
 * comes from its answer, not from what the app asked for.
 */
async function submitPrompt(sessionId: string, text: string, attachments: readonly Attachment[] = []): Promise<void> {
  const busy = $conversations.get()[sessionId]?.transcript.running ?? false
  // The row shows the user's words and the file names. The model also gets the references.
  const key = showUserMessage(sessionId, text, attachments.map(attachment => attachment.name))

  try {
    const result = await rpc<PromptSubmitResult>('prompt.submit', {
      session_id: sessionId,
      text: promptWithAttachments(text, attachments),
      surface: 'mobile',
      ...(busy ? { queued: true } : {})
    })

    if (result?.status === 'queued' || result?.status === 'steered' || result?.status === 'redirected') {
      label(sessionId, key, result.status)
    }
  } catch (error) {
    fail(sessionId, error)
  }
}

/**
 * Give the running turn a message without starting a new turn: the model reads
 * it after its current action. The backend refuses when no turn runs (or the
 * turn is past its last action); the message then goes out as a normal one.
 */
async function steerTurn(sessionId: string, text: string): Promise<void> {
  let accepted = false

  try {
    const result = await rpc<SessionCorrectionResult>('session.steer', { session_id: sessionId, text })

    accepted = result?.status === 'queued'
  } catch {
    // An agent that cannot steer answers with an error. The queue still works.
  }

  if (!accepted) {
    return submitPrompt(sessionId, text)
  }

  label(sessionId, showUserMessage(sessionId, text), 'steered')
}

// An alias that names an alias that names the first one must not run forever.
const MAX_ALIAS_HOPS = 3

async function runSlash(sessionId: string, command: string, hops = 0): Promise<DraftEffect> {
  const { name, arg } = splitSlash(command)
  const blocked = phoneBlock(name, $catalog.get() ?? (await loadCatalog(sessionId)))

  if (blocked) {
    note(sessionId, `/${name} ${blocked}.`)

    return NOTHING
  }

  const action = phoneAction(name)

  if (action) {
    try {
      return await ACTIONS[action](sessionId, arg)
    } catch (error) {
      note(sessionId, `/${name}: ${error instanceof Error ? error.message : String(error)}`, 'error')

      return NOTHING
    }
  }

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
      note(sessionId, `/${name}: ${execError instanceof Error ? execError.message : String(execError)}`, 'error')

      return NOTHING
    }
  }

  const outcome = slashOutcome(result, arg)

  switch (outcome.kind) {
    case 'alias':
      if (hops >= MAX_ALIAS_HOPS) {
        note(sessionId, `/${name}: alias loop`, 'error')

        return NOTHING
      }

      return runSlash(sessionId, outcome.command, hops + 1)

    case 'submit':
      if (outcome.notice) {
        note(sessionId, outcome.notice)
      }

      await submitPrompt(sessionId, outcome.text)

      return NOTHING

    case 'prefill':
      if (outcome.notice) {
        note(sessionId, outcome.notice)
      }

      return { kind: 'prefill', text: outcome.text }

    case 'output':
      patch(sessionId, c => ({ ...c, transcript: withCommandOutput(c.transcript, command, outcome.text) }))

      return NOTHING
  }
}

// Summarising a long conversation is a model call. The backend waits up to
// 630 s for it before it answers "pending"; the request must outlive that.
const COMPRESS_TIMEOUT_MS = 660_000

/** The commands the app runs with its own code. A thrown error becomes a notice in the conversation. */
const ACTIONS: Record<PhoneAction, (sessionId: string, arg: string) => Promise<DraftEffect>> = {
  new: async () => ({ kind: 'open', sessionId: await createConversation() }),

  title: async (sessionId, arg) => {
    const result = await rpc<SessionTitleResult>('session.title', { session_id: sessionId, ...(arg ? { title: arg } : {}) })

    if (arg) {
      patch(sessionId, c => ({ ...c, title: result.title || arg }))
    }

    note(sessionId, result.title ? `Title: ${result.title}` : 'This conversation has no title yet.')

    return NOTHING
  },

  branch: async (sessionId, arg) => {
    const result = await rpc<SessionBranchResult>('session.branch', { session_id: sessionId, ...(arg ? { name: arg } : {}) })

    $conversations.setKey(result.session_id, {
      sessionId: result.session_id,
      title: result.title || result.info?.title || '',
      info: result.info ?? {},
      transcript: withNotice(transcriptFromHistory(result.messages ?? []), 'Branched from the conversation before')
    })

    return { kind: 'open', sessionId: result.session_id }
  },

  model: async () => ({ kind: 'sheet', sheet: 'model' }),
  help: async () => ({ kind: 'sheet', sheet: 'commands' }),
  sessions: async () => ({ kind: 'sessions' }),

  stop: async sessionId => {
    await stopTurn(sessionId)

    return NOTHING
  },

  compress: async (sessionId, arg) => {
    patch(sessionId, c => ({ ...c, transcript: { ...c.transcript, status: 'Compressing the conversation…' } }))

    try {
      const result = await rpc<SessionCompressResult>(
        'session.compress',
        { session_id: sessionId, ...(arg ? { focus_topic: arg } : {}) },
        COMPRESS_TIMEOUT_MS
      )

      note(sessionId, compressNotice(result))
    } finally {
      patch(sessionId, c => ({ ...c, transcript: { ...c.transcript, status: null } }))
    }

    return NOTHING
  },

  btw: async (sessionId, arg) => {
    if (!arg) {
      return { kind: 'prefill', text: '/btw ' }
    }

    await rpc('prompt.btw', { session_id: sessionId, text: arg })
    note(sessionId, 'Side question sent. The answer arrives here.')

    return NOTHING
  },

  background: async (sessionId, arg) => {
    if (!arg) {
      return { kind: 'prefill', text: '/bg ' }
    }

    await rpc('prompt.background', { session_id: sessionId, text: arg })
    note(sessionId, 'Started in the background. The result arrives here.')

    return NOTHING
  },

  steer: async (sessionId, arg) => {
    if (!arg) {
      return { kind: 'prefill', text: '/steer ' }
    }

    await steerTurn(sessionId, arg)

    return NOTHING
  },

  queue: async (sessionId, arg) => {
    if (!arg) {
      return { kind: 'prefill', text: '/queue ' }
    }

    await submitPrompt(sessionId, arg)

    return NOTHING
  }
}

function compressNotice(result: SessionCompressResult | null): string {
  if (result?.lock_held) {
    return 'Another compression is running for this conversation.'
  }

  if (result?.status === 'pending') {
    return 'Compression is still running on the backend.'
  }

  if (result?.compressed === false) {
    return 'Nothing to compress.'
  }

  const before = result?.before_messages
  const after = result?.after_messages

  return typeof before === 'number' && typeof after === 'number'
    ? `Compressed: ${before} messages to ${after}.`
    : 'Compressed the conversation.'
}

export interface Completions {
  items: CompletionItem[]
  replaceFrom: number | null
}

/** Completions for the word the user is typing. Never throws: no completions is a normal answer. */
export async function completeDraft(sessionId: string, trigger: Trigger): Promise<Completions> {
  try {
    if (trigger.kind === 'slash') {
      // The catalog loads beside the list, never before it: the built-in rules
      // already hide the common terminal commands, and typing must not wait.
      void loadCatalog(sessionId)

      const result = await rpc<CompleteSlashResult>('complete.slash', { session_id: sessionId, text: trigger.word }, 8000)

      return { items: phoneCompletions(result.items ?? [], $catalog.get()), replaceFrom: result.replace_from ?? null }
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
