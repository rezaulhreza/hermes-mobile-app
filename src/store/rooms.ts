/**
 * Writes to the group chats of bots. The host runs a round: the `group-rooms`
 * plugin of the host takes a message, gives it to each member and logs the
 * answers in the record that every client reads. Without the plugin a room
 * can be read and not written.
 */

import { atom } from 'nanostores'

import { logMessages, type Room, type RoomMessage, roomRow, withRoom } from '@/core/bots'
import { type HistoryPage, historyPagePath, pageMessages } from '@/core/history-page'
import { NO_ROUND, type Round, type RoundAction, roundOf, turnWork } from '@/core/rounds'
import { transcriptFromHistory, type TranscriptItem } from '@/core/transcript'

import { $rooms } from './bots'
import { currentApi } from './link'

const ROUTE = '/api/plugins/group-rooms'
const POLL_MS = 2000
// A round can start from another device while the room is on screen: an idle room is read at this pace.
const IDLE_MS = 8000

/** Whether the host can take a message for a room. Null: not asked yet. */
export const $roomsWritable = atom<boolean | null>(null)
/** The id of the room in which the bots answer now. */
export const $roomWorking = atom<string | null>(null)
/** The round in the room on screen: which bot works, which one waits, and what waits for the user. No turn when the host gives none. */
export const $roomRound = atom<Round>(NO_ROUND)

let timer: ReturnType<typeof setTimeout> | null = null
let watched: string | null = null

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

const at = (id: string) => `${ROUTE}/rooms/${encodeURIComponent(id)}`

/** Put the answer of the host for one room in the list, and say whether its bots still answer. */
function take(answer: unknown): Room {
  const room = roomRow('', answer)

  if (!room) {
    throw new Error('The host gave no room.')
  }

  $rooms.set(withRoom($rooms.get(), room))

  // Only a read of the room has the turns. An answer to a write must not empty the list.
  if (watched === room.id && Array.isArray((answer as { round?: unknown }).round)) {
    $roomRound.set(roundOf(answer))
  }

  if ((answer as { working?: unknown }).working === true) {
    $roomWorking.set(room.id)
  } else if ($roomWorking.get() === room.id) {
    $roomWorking.set(null)
  }

  return room
}

export async function checkRoomsWritable(): Promise<void> {
  try {
    $roomsWritable.set(((await api().request({ path: `${ROUTE}/status` })) as { ok?: unknown } | null)?.ok === true)
  } catch {
    $roomsWritable.set(false)
  }
}

function again(id: string): void {
  if (timer) {
    clearTimeout(timer)
  }

  timer = setTimeout(
    () => {
      timer = null

      if (watched === id) {
        void readRoom(id).catch(() => again(id))
      }
    },
    $roomWorking.get() === id ? POLL_MS : IDLE_MS
  )
}

/**
 * Read one room from the host, and read it again while it is on screen: every
 * two seconds while its bots answer, and at a slow pace when nothing runs, so
 * an answer or a round from another device shows by itself.
 */
async function readRoom(id: string): Promise<void> {
  take(await api().request({ path: at(id) }))

  if (watched === id) {
    again(id)
  }
}

/** The room screen opened: follow the room while it is on screen. */
export function watchRoom(id: string): void {
  watched = id
  void readRoom(id).catch(() => undefined)
}

/** The room screen closed: no timer stays. */
export function unwatchRoom(): void {
  watched = null
  $roomWorking.set(null)
  $roomRound.set(NO_ROUND)

  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

/** Send a message to a room. `thread` is the thread it goes on with; null starts a new thread. */
export async function sendToRoom(id: string, text: string, thread: string | null): Promise<void> {
  // The key lets the host drop a second copy when the phone sends again after a lost answer.
  const key = `p${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  // The turns on screen are of the message before this one.
  $roomRound.set(NO_ROUND)
  take(await api().request({ path: `${at(id)}/messages`, method: 'POST', body: { text: text.trim(), id: key, ...(thread ? { thread } : { fresh: true }) }, timeoutMs: 60_000 }))

  if (watched === id) {
    again(id)
  }
}

const EARLIER_PAGE = 30

/**
 * The messages of a room from before `before` (Unix milliseconds), the newest
 * of them, in full and in the order of time. The record of a room keeps its
 * newest messages only; the log of the engine has them all. `more` says that
 * there are still earlier ones.
 */
export async function readEarlier(id: string, before: number): Promise<{ messages: RoomMessage[]; more: boolean }> {
  const answer = (await api().request({ path: `${at(id)}/history?before=${Math.floor(before)}&limit=${EARLIER_PAGE}` })) as { messages?: unknown; more?: unknown } | null

  return { messages: logMessages(answer?.messages), more: answer?.more === true }
}

/** A message the host cut in the record, in full. The host refuses when it has no log of the message. */
export async function readFullMessage(id: string, messageId: string): Promise<string> {
  const answer = (await api().request({ path: `${at(id)}/messages/${encodeURIComponent(messageId)}` })) as { text?: unknown } | null

  if (typeof answer?.text !== 'string' || !answer.text.trim()) {
    throw new Error('The host does not have the rest of this message.')
  }

  return answer.text
}

/**
 * What a bot did in its turn so far: its thoughts, the tools it used and the
 * words of its answer. The host stores each row as the bot makes it, so a
 * read of the session shows the work while it runs. Only a read: it takes no
 * place in the session and cannot disturb the turn.
 */
export async function readTurnWork(member: string, session: string): Promise<TranscriptItem[]> {
  const page = await api().request<HistoryPage>({ path: historyPagePath(session, 0), profile: member })

  return turnWork(transcriptFromHistory(pageMessages(page.messages ?? [])).items)
}

/** Stop one turn: the bot that works on it, or a turn that waits. The round goes on with the next bot. */
export async function stopTurn(id: string, taskId: string): Promise<void> {
  await api().request({ path: `${at(id)}/turns/${encodeURIComponent(taskId)}/stop`, method: 'POST' })
  await readRoom(id)
}

/** Run again a turn of which the engine does not know the end, and follow the room while the bot works. */
export async function retryTurn(id: string, taskId: string): Promise<void> {
  await api().request({ path: `${at(id)}/turns/${encodeURIComponent(taskId)}/retry`, method: 'POST' })
  await readRoom(id)

  if (watched === id) {
    again(id)
  }
}

/** Answer a bot that waits for a yes before it does something: this one time, or no. */
export async function answerApproval(id: string, action: Extract<RoundAction, { kind: 'approval' }>, choice: 'once' | 'deny'): Promise<void> {
  await api().request({
    path: `${at(id)}/approvals`,
    method: 'POST',
    body: { task_id: action.taskId, member: action.member, request_id: action.requestId, execution_generation: action.generation, choice }
  })
  await readRoom(id)
}

export async function stopRoom(id: string): Promise<void> {
  await api().request({ path: `${at(id)}/stop`, method: 'POST' })
}

export async function makeRoom(name: string, members: readonly string[]): Promise<string> {
  return take(await api().request({ path: `${ROUTE}/rooms`, method: 'POST', body: { name: name.trim(), members } })).id
}

export async function changeRoom(id: string, change: { name?: string; members?: readonly string[] }): Promise<void> {
  take(await api().request({ path: at(id), method: 'PATCH', body: change }))
}

export async function closeRoom(id: string): Promise<void> {
  await api().request({ path: at(id), method: 'DELETE', timeoutMs: 60_000 })
  $rooms.set($rooms.get().filter(room => room.id !== id))
}

/** Remove a group that has no room on the host: the bots stop naming it. */
export async function forgetGroup(id: string, name: string): Promise<void> {
  await api().request({ path: `${ROUTE}/groups?name=${encodeURIComponent(name)}`, method: 'DELETE', timeoutMs: 60_000 })
  $rooms.set($rooms.get().filter(room => room.id !== id))
}
