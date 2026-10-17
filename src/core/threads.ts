/**
 * The threads of a group chat. Every message belongs to a thread: one topic,
 * as in the desktop app. The bots read the thread of a message as its
 * context, so a reply in an old thread goes on with that work, and a new
 * thread starts with a clean page.
 */

import { messageWords } from './attachments'
import type { RoomMessage } from './bots'

/** A message this soon after the one before goes on with its thread. The host has the same number. */
export const THREAD_GAP_MS = 15 * 60_000

export interface ThreadRow {
  message: RoomMessage
  /** The thread of the message. For a message from before threads, a name the phone made. */
  thread: string
  /** The message starts its thread on screen. */
  first: boolean
  /** The message ends its thread on screen. */
  last: boolean
  /** The host knows the thread, so a message can name it. */
  known: boolean
}

/** The thread of each message. A message with none (an old room) shares one with the messages around it. */
function threadsOf(messages: readonly RoomMessage[]): { thread: string; known: boolean }[] {
  let made = 0
  let before: RoomMessage | undefined

  return messages.map(message => {
    if (message.thread) {
      before = undefined

      return { thread: message.thread, known: true }
    }

    if (!before || message.at - before.at > THREAD_GAP_MS) {
      made += 1
    }

    before = message

    return { thread: `old-${made}`, known: false }
  })
}

/**
 * The messages for the list, a thread at a time: the thread with the newest
 * message is last, and inside a thread the messages keep their order. A
 * reply to an old thread moves that thread to the end, where the answers come.
 */
export function threadRows(messages: readonly RoomMessage[]): ThreadRow[] {
  const threads = threadsOf(messages)
  const newest = new Map<string, number>()

  threads.forEach(({ thread }, index) => newest.set(thread, index))

  const order = [...newest.entries()].sort((a, b) => a[1] - b[1]).map(([thread]) => thread)

  return order.flatMap(thread => {
    const own = messages.flatMap((message, index) => (threads[index].thread === thread ? [{ message, thread, known: threads[index].known }] : []))

    return own.map((row, index) => ({ ...row, first: index === 0, last: index === own.length - 1 }))
  })
}

/** A thread that is folded to its first message: what its replies are, in short. */
export interface ThreadFold {
  /** The messages after the first one. */
  replies: number
  /** The bots that wrote the replies, the newest first: profile names. Three at most. */
  from: string[]
  /** Unix milliseconds of the newest reply. */
  lastAt: number
}

const FOLD_FACES = 3

/** The replies of each thread in short, for the line that shows and hides them. A thread with no reply has none. */
export function threadFolds(rows: readonly ThreadRow[]): Map<string, ThreadFold> {
  const folds = new Map<string, ThreadFold>()

  for (const row of rows) {
    if (row.first) {
      continue
    }

    const fold = folds.get(row.thread) ?? { replies: 0, from: [], lastAt: 0 }

    folds.set(row.thread, {
      replies: fold.replies + 1,
      from: row.message.mine ? fold.from : [row.message.from, ...fold.from.filter(name => name !== row.message.from)].slice(0, FOLD_FACES),
      lastAt: Math.max(fold.lastAt, row.message.at)
    })
  }

  return folds
}

/** The rows on screen: a thread that is not open shows its first message only. */
export function shownRows(rows: readonly ThreadRow[], open: (thread: string) => boolean): ThreadRow[] {
  return rows.flatMap(row => (open(row.thread) ? [row] : row.first ? [{ ...row, last: true }] : []))
}

/** The thread a new message goes on with when the user chose none: the newest one, while it is recent. Null: a new thread. */
export function currentThread(messages: readonly RoomMessage[], nowMs: number): string | null {
  const newest = messages[messages.length - 1]

  return newest?.thread && nowMs - newest.at < THREAD_GAP_MS ? newest.thread : null
}

const TITLE_CHARS = 48

/** A thread in a few words: the start of its first message. */
export function threadTitle(messages: readonly RoomMessage[], thread: string): string {
  // The files of a message are lines of its text. A title is its words.
  const words = messageWords(messages.find(message => message.thread === thread)?.text ?? '').replace(/\s+/g, ' ').trim()

  return words.length > TITLE_CHARS ? `${words.slice(0, TITLE_CHARS).trimEnd()}…` : words
}
