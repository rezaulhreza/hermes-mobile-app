/**
 * Writes to the group chats of bots. The host runs a round: the `group-rooms`
 * plugin of the host takes a message, gives it to each member and logs the
 * answers in the record that every client reads. Without the plugin a room
 * can be read and not written.
 */

import { atom } from 'nanostores'

import { type Room, roomRow, withRoom } from '@/core/bots'
import { roundTurns, type Turn } from '@/core/rounds'

import { $rooms } from './bots'
import { currentApi } from './link'

const ROUTE = '/api/plugins/group-rooms'
const POLL_MS = 2000

/** Whether the host can take a message for a room. Null: not asked yet. */
export const $roomsWritable = atom<boolean | null>(null)
/** The id of the room in which the bots answer now. */
export const $roomWorking = atom<string | null>(null)
/** The turns of the round in the room on screen: which bot works, which one waits. Empty when the host gives none. */
export const $roomRound = atom<Turn[]>([])

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
    $roomRound.set(roundTurns(answer))
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
  timer = setTimeout(() => {
    timer = null

    if (watched === id) {
      void readRoom(id).catch(() => again(id))
    }
  }, POLL_MS)
}

/** Read one room from the host. While its bots answer, read it again every two seconds. */
async function readRoom(id: string): Promise<void> {
  take(await api().request({ path: at(id) }))

  if (watched === id && $roomWorking.get() === id && !timer) {
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
  $roomRound.set([])

  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

export async function sendToRoom(id: string, text: string): Promise<void> {
  // The key lets the host drop a second copy when the phone sends again after a lost answer.
  const key = `p${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  // The turns on screen are of the message before this one.
  $roomRound.set([])
  take(await api().request({ path: `${at(id)}/messages`, method: 'POST', body: { text: text.trim(), id: key }, timeoutMs: 60_000 }))

  if (watched === id && !timer) {
    again(id)
  }
}

/** A message the host cut in the record, in full. The host refuses when it has no log of the message. */
export async function readFullMessage(id: string, messageId: string): Promise<string> {
  const answer = (await api().request({ path: `${at(id)}/messages/${encodeURIComponent(messageId)}` })) as { text?: unknown } | null

  if (typeof answer?.text !== 'string' || !answer.text.trim()) {
    throw new Error('The host does not have the rest of this message.')
  }

  return answer.text
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
