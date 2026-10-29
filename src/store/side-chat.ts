/**
 * The side chats of the conversations on screen, by live session id. The
 * list leaves the memory when its conversation closes.
 */

import { map } from 'nanostores'

import type { SideAgentCompletePayload, TaskIdResult } from '@/core/gateway/gateway-contract.generated'
import { type SideTurn, withAnswer, withFailure, withQuestion, withTask } from '@/core/side-chat'

import { onGatewayEvent, rpc } from './link'

export const $sideChat = map<Record<string, SideTurn[]>>({})

let nextKey = 0
// An answer can come before the reply that names its task. It waits here for that reply.
const early = new Map<string, string>()
// The tasks of the side chat, and the questions still on their way to the host, by session.
const ownTasks = new Set<string>()
const asking = new Map<string, number>()

/**
 * Is this answer for the side chat? The chat then leaves it out of the
 * conversation on screen. An answer to the /btw command is not: that one
 * shows in the conversation.
 */
export function isSideAnswer(sessionId: string, taskId: string): boolean {
  return ownTasks.has(taskId) || (asking.get(sessionId) ?? 0) > 0
}

function words(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Ask the side agent. The bot of the conversation is not stopped, and its conversation does not change. */
export async function askSide(sessionId: string, text: string, profile?: string): Promise<void> {
  const question = text.trim()

  if (!question) {
    return
  }

  const key = (nextKey += 1)
  const turns = () => $sideChat.get()[sessionId] ?? []

  $sideChat.setKey(sessionId, withQuestion(turns(), key, question))
  asking.set(sessionId, (asking.get(sessionId) ?? 0) + 1)

  try {
    const { task_id: taskId } = await rpc<TaskIdResult>('prompt.btw', { session_id: sessionId, text: question, ...(profile ? { profile } : {}) })
    const answer = early.get(taskId)

    ownTasks.add(taskId)
    early.delete(taskId)
    $sideChat.setKey(sessionId, withTask(turns(), key, taskId, answer))
  } catch (error) {
    $sideChat.setKey(sessionId, withFailure(turns(), key, words(error)))
  } finally {
    asking.set(sessionId, (asking.get(sessionId) ?? 1) - 1)
  }
}

/** The conversation closed: its side chat goes. */
export function closeSide(sessionId: string): void {
  for (const turn of $sideChat.get()[sessionId] ?? []) {
    if (turn.taskId) {
      ownTasks.delete(turn.taskId)
    }
  }

  $sideChat.setKey(sessionId, [])
}

onGatewayEvent(event => {
  if (event.type !== 'btw.complete') {
    return
  }

  const { task_id: taskId, text } = event.payload as SideAgentCompletePayload

  for (const [sessionId, turns] of Object.entries($sideChat.get())) {
    const next = withAnswer(turns ?? [], taskId, text)

    if (next) {
      $sideChat.setKey(sessionId, next)

      return
    }
  }

  early.set(taskId, text)

  // Kept for a short time only: an answer for another app on the same host never finds its question here.
  setTimeout(() => early.delete(taskId), 30_000)
})
