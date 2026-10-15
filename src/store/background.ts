/**
 * The background commands of the chat on screen. Read when the chat opens,
 * after a tool that starts or ends a command, when the host says that one
 * ended, and every five seconds while one runs. Nothing is read, and no timer
 * runs, for a chat that is not on screen.
 */

import { map } from 'nanostores'

import { BACKGROUND_POLL_MS, type BackgroundJob, backgroundJobs, DONE_LINGER_MS, FAILED_LINGER_MS, mergeBackground, touchesBackground } from '@/core/background'

import { onGatewayEvent, rpc } from './link'

/** Live session id -> its background commands. */
export const $background = map<Record<string, BackgroundJob[]>>({})

let watched: string | null = null
let poll: ReturnType<typeof setTimeout> | null = null
const dismissed = new Map<string, Set<string>>()
const leaving = new Map<string, ReturnType<typeof setTimeout>>()

function stopPoll(): void {
  if (poll) {
    clearTimeout(poll)
    poll = null
  }
}

function forget(sessionId: string, id: string): void {
  const set = dismissed.get(sessionId) ?? new Set<string>()

  set.add(id)
  dismissed.set(sessionId, set)
  clearTimeout(leaving.get(id))
  leaving.delete(id)
  $background.setKey(sessionId, ($background.get()[sessionId] ?? []).filter(job => job.id !== id))
}

/** Read the list of one chat. A finished row leaves by itself after a short time. */
export async function refreshBackground(sessionId: string): Promise<void> {
  let fresh: BackgroundJob[]

  try {
    fresh = backgroundJobs(await rpc('process.list', { session_id: sessionId }))
  } catch {
    // The session is gone from the host, or the socket is down: the next trigger reads again.
    return
  }

  const jobs = mergeBackground($background.get()[sessionId] ?? [], fresh, dismissed.get(sessionId) ?? new Set())

  $background.setKey(sessionId, jobs)

  for (const job of jobs) {
    if (job.state !== 'running' && !leaving.has(job.id)) {
      leaving.set(job.id, setTimeout(() => forget(sessionId, job.id), job.state === 'failed' ? FAILED_LINGER_MS : DONE_LINGER_MS))
    }
  }

  stopPoll()

  if (watched === sessionId && jobs.some(job => job.state === 'running')) {
    poll = setTimeout(() => {
      poll = null
      void refreshBackground(sessionId)
    }, BACKGROUND_POLL_MS)
  }
}

/** The chat screen opened. */
export function watchBackground(sessionId: string): void {
  watched = sessionId
  void refreshBackground(sessionId)
}

/** The chat screen closed: no timer stays, and its list leaves the memory. */
export function unwatchBackground(sessionId: string): void {
  if (watched === sessionId) {
    watched = null
    stopPoll()
  }

  for (const job of $background.get()[sessionId] ?? []) {
    clearTimeout(leaving.get(job.id))
    leaving.delete(job.id)
  }

  $background.setKey(sessionId, [])
}

/** Stop a running command on the host. The row leaves only when the host confirms. */
export async function stopBackground(sessionId: string, id: string): Promise<void> {
  await rpc('process.kill', { session_id: sessionId, process_id: id })
  forget(sessionId, id)
}

/** Take a finished row away now. */
export function dismissBackground(sessionId: string, id: string): void {
  forget(sessionId, id)
}

onGatewayEvent(event => {
  const sessionId = event.session_id

  if (!sessionId || sessionId !== watched) {
    return
  }

  const payload = event.payload as { name?: unknown; kind?: unknown } | undefined

  // A terminal or process tool starts or ends a command; the host also says when one ended by itself.
  if ((event.type === 'tool.complete' && touchesBackground(payload?.name)) || (event.type === 'status.update' && payload?.kind === 'process')) {
    void refreshBackground(sessionId)
  }
})
