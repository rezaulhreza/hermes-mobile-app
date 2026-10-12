/**
 * The messages a user sent while a turn ran. They wait on the phone and go
 * out one at a time when the turn ends, as in the desktop app. The host has a
 * queue of its own, but no call that takes one message out of it or changes
 * one; a queue on the phone can do both.
 */

export interface QueuedMessage {
  id: string
  text: string
  /** The recent spoken exchange of a call, for the model only. */
  voiceContext?: string
}

export interface Queue {
  items: QueuedMessage[]
  /** The user stopped a turn. The queue then waits for the user: a Stop must not start the next message. */
  paused: boolean
  nextId: number
}

export const EMPTY_QUEUE: Queue = { items: [], paused: false, nextId: 0 }

/** Add a message at the end. A new message from the user also ends a pause: they want the queue to run. */
export function enqueue(queue: Queue, text: string, voiceContext?: string): Queue {
  return {
    items: [...queue.items, { id: `q${queue.nextId}`, text, ...(voiceContext ? { voiceContext } : {}) }],
    paused: false,
    nextId: queue.nextId + 1
  }
}

export function removeQueued(queue: Queue, id: string): Queue {
  return { ...queue, items: queue.items.filter(item => item.id !== id) }
}

/** Put a message first, so it is the next one to go out. */
export function promoteQueued(queue: Queue, id: string): Queue {
  const item = queue.items.find(other => other.id === id)

  return item ? { ...queue, items: [item, ...queue.items.filter(other => other.id !== id)] } : queue
}

export function pauseQueue(queue: Queue): Queue {
  return queue.items.length && !queue.paused ? { ...queue, paused: true } : queue
}

export function resumeQueue(queue: Queue): Queue {
  return queue.paused ? { ...queue, paused: false } : queue
}

/** The message to send now, and the queue without it. Nothing goes out while a turn runs or the queue is paused. */
export function takeNext(queue: Queue, running: boolean): { send: QueuedMessage | null; queue: Queue } {
  if (running || queue.paused || !queue.items.length) {
    return { send: null, queue }
  }

  return { send: queue.items[0], queue: { ...queue, items: queue.items.slice(1) } }
}
