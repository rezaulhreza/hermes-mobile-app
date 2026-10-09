/**
 * Things the agent needs from the user.
 *
 * Hermes runs unattended and stops when it needs a person: to approve a
 * command, to answer a question, or to supply a secret it must not guess. On
 * a phone this is the most important surface in the app, because the phone is
 * what the user has with them when the agent stops.
 *
 * The backend sends each one as a server-to-client JSON-RPC request. This
 * module turns the wire shape into one model the UI can render, and turns the
 * user's answer back into the wire result. It is pure.
 */

import type { ApprovalChoice } from './gateway/gateway-contract.generated'

interface Base {
  /** Stable across a re-delivery after a reconnect, so one card is shown, not two. */
  id: string
  sessionId: string
}

export interface ClarifyQuestion {
  qid: string
  question: string
  choices: string[]
  multiSelect: boolean
}

export type AgentRequest =
  | (Base & { kind: 'approval'; command: string; description: string; choices: ApprovalChoice[] })
  | (Base & { kind: 'clarify'; questions: ClarifyQuestion[] })
  | (Base & { kind: 'value'; title: string; detail: string; placeholder: string; numeric: boolean })
  | (Base & { kind: 'login'; site: string })

export type AgentAnswer =
  | { kind: 'approval'; choice: ApprovalChoice }
  | { kind: 'clarify'; answers: Record<string, string | null> }
  | { kind: 'value'; value: string }
  | { kind: 'login'; identifier: string; password: string }

const DEFAULT_CHOICES: ApprovalChoice[] = ['once', 'session', 'deny']
const APPROVAL_CHOICES: ReadonlySet<string> = new Set(['once', 'session', 'always', 'deny'])

/**
 * Model one inbound request. Returns null for a method this app does not
 * answer (for example `preview.read`), so the caller declines it and the
 * backend can try another client.
 */
export function agentRequestFrom(method: string, id: string, params: Record<string, unknown>): AgentRequest | null {
  const base: Base = { id: text(params.request_id) || id, sessionId: text(params.session_id) }

  switch (method) {
    case 'approval': {
      const choices = Array.isArray(params.choices)
        ? params.choices.filter((c): c is ApprovalChoice => typeof c === 'string' && APPROVAL_CHOICES.has(c))
        : []

      return {
        ...base,
        kind: 'approval',
        command: text(params.command),
        description: text(params.description),
        choices: choices.length ? choices : DEFAULT_CHOICES
      }
    }

    case 'clarify': {
      const questions = Array.isArray(params.questions) ? params.questions.flatMap(parseQuestion) : []

      return questions.length ? { ...base, kind: 'clarify', questions } : null
    }

    case 'secret':
      return value(base, text(params.env_var) || 'Secret', text(params.prompt), 'Value')

    case 'sudo':
      return value(base, 'Administrator password', text(params.command), 'Password')

    case 'vault.code':
      return value(base, 'Verification code', [text(params.site), text(params.hint)].filter(Boolean).join(' · '), 'Code', true)

    case 'vault.unlock_prompt':
      return value(base, `Unlock ${text(params.display_name) || 'password manager'}`, '', 'Master password')

    case 'vault.save_login':
      return { ...base, kind: 'login', site: text(params.site) || text(params.origin) }

    default:
      return null
  }
}

/** The JSON-RPC result the backend expects for an answer. */
export function wireResult(answer: AgentAnswer): Record<string, unknown> {
  switch (answer.kind) {
    case 'approval':
      return { choice: answer.choice }
    case 'clarify':
      return { answers: answer.answers }
    case 'value':
      return { value: answer.value }
    case 'login':
      // The backend reads this one as JSON text inside `value`.
      return { value: JSON.stringify({ identifier: answer.identifier, password: answer.password }) }
  }
}

/** Short label for a request, for a list row or a badge. */
export function requestSummary(request: AgentRequest): string {
  switch (request.kind) {
    case 'approval':
      return request.description || request.command || 'Approve a command'
    case 'clarify':
      return request.questions[0]?.question ?? 'A question'
    case 'value':
      return request.title
    case 'login':
      return `Save a login for ${request.site}`
  }
}

function value(base: Base, title: string, detail: string, placeholder: string, numeric = false): AgentRequest {
  return { ...base, kind: 'value', title, detail, placeholder, numeric }
}

function parseQuestion(raw: unknown): ClarifyQuestion[] {
  if (!raw || typeof raw !== 'object') {
    return []
  }

  const q = raw as Record<string, unknown>

  if (typeof q.qid !== 'string' || typeof q.question !== 'string') {
    return []
  }

  return [
    {
      qid: q.qid,
      question: q.question,
      choices: Array.isArray(q.choices) ? q.choices.filter((c): c is string => typeof c === 'string') : [],
      multiSelect: q.multi_select === true
    }
  ]
}

function text(raw: unknown): string {
  return typeof raw === 'string' ? raw : ''
}
