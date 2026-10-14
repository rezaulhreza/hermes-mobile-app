/** The state and the care of the host. Filled while the Host screen is open, emptied when it closes. */

import { atom } from 'nanostores'

import { type BackgroundJob, backgroundJobs, type CareJob, type Curator, curatorOf, type Fact, type ForeignChat, foreignChats, hostFacts, type JobOutput, jobOutput, type LogLine, logLines, shareLinks, type Usage, usageOf } from '@/core/ops'

import { currentApi, rpc } from './link'

export const $hostFacts = atom<Fact[] | null>(null)
/** The host has a newer Hermes that it can install itself. */
export const $hostUpdate = atom(false)
export const $usage = atom<Usage | null>(null)
export const $backgroundJobs = atom<BackgroundJob[] | null>(null)
export const $logLines = atom<LogLine[] | null>(null)
export const $curator = atom<Curator | null>(null)
export const $foreignChats = atom<ForeignChat[] | null>(null)
/** The output of the care job that runs or ran last, by the id of the job. */
export const $careOutput = atom<{ id: string; output: JobOutput; links: string[] } | null>(null)

const POLL_MS = 1500
let poll: ReturnType<typeof setTimeout> | null = null

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

const get = (path: string, timeoutMs = 30_000) => api().request({ path, timeoutMs })
const quiet = (path: string) => get(path).catch(() => null)

/** The three parts are asked at the same time; a part that does not answer leaves its facts out. */
export async function loadHostFacts(): Promise<void> {
  const [status, stats, update] = await Promise.all([get('/api/status'), quiet('/api/system/stats'), quiet('/api/hermes/update/check')])
  const check = (update ?? {}) as { update_available?: unknown; can_apply?: unknown }

  $hostFacts.set(hostFacts(status, stats, update))
  $hostUpdate.set(check.update_available === true && check.can_apply === true)
}

export async function loadUsage(days: number): Promise<void> {
  $usage.set(usageOf(await get(`/api/analytics/usage?days=${days}`, 60_000)))
}

export async function loadBackgroundJobs(): Promise<void> {
  $backgroundJobs.set(backgroundJobs(await rpc('agents.list', {})))
}

/** Stop every program that one chat left running. */
export async function stopBackgroundJob(sessionId: string): Promise<void> {
  await rpc('process.stop', { session_id: sessionId })
  await loadBackgroundJobs()
}

export async function loadLog(file: string): Promise<void> {
  $logLines.set(null)
  $logLines.set(logLines(await get(`/api/logs?file=${encodeURIComponent(file)}&lines=200`)))
}

export async function loadCurator(): Promise<void> {
  $curator.set(curatorOf(await get('/api/curator'), Date.now()))
}

export async function pauseCurator(paused: boolean): Promise<void> {
  await api().request({ path: '/api/curator/paused', method: 'PUT', body: { paused } })
  await loadCurator()
}

function stopPoll(): void {
  if (poll) {
    clearTimeout(poll)
    poll = null
  }
}

function follow(job: CareJob): void {
  poll = setTimeout(async () => {
    poll = null

    try {
      const output = jobOutput(await get(`/api/actions/${job.action}/status?lines=200`))

      if ($careOutput.get()?.id !== job.id) {
        return
      }

      $careOutput.set({ id: job.id, output, links: [] })

      if (output.running) {
        follow(job)
      }
    } catch {
      follow(job)
    }
  }, POLL_MS)
}

/** Start a care job. The host runs it in the background; its output is read until it ends. */
export async function runCareJob(job: CareJob): Promise<void> {
  stopPoll()
  $careOutput.set({ id: job.id, output: { running: true, exitCode: null, lines: [] }, links: [] })

  try {
    const answer = await api().request({ path: job.path, method: 'POST', body: job.body, timeoutMs: 120_000 })

    if (job.action) {
      follow(job)
    } else {
      $careOutput.set({ id: job.id, output: { running: false, exitCode: 0, lines: [] }, links: shareLinks(answer) })
    }
  } catch (error) {
    $careOutput.set(null)
    throw error
  }
}

/** Start the messaging of the host again. Chats in the app stay; a channel answers again after some seconds. */
export async function restartMessaging(): Promise<void> {
  await api().request({ path: '/api/gateway/restart', method: 'POST', timeoutMs: 60_000 })
}

export async function updateHermes(): Promise<void> {
  await api().request({ path: '/api/hermes/update', method: 'POST', timeoutMs: 60_000 })
}

export async function loadForeignChats(): Promise<void> {
  $foreignChats.set(foreignChats(await rpc('session.foreign.list', { limit: 50 }, 60_000)))
}

/** Copy a chat of another tool into Hermes. Answers the id of the Hermes chat. */
export async function importForeignChat(id: string): Promise<string> {
  return (await rpc<{ session_id: string }>('session.foreign.import', { id }, 120_000)).session_id
}

export function clearOps(): void {
  stopPoll()
  $hostFacts.set(null)
  $hostUpdate.set(false)
  $usage.set(null)
  $backgroundJobs.set(null)
  $logLines.set(null)
  $curator.set(null)
  $foreignChats.set(null)
  $careOutput.set(null)
}
