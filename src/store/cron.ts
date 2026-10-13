/** The schedules (cron jobs) of the active workspace, for every bot. */

import { atom } from 'nanostores'

import { type Blueprint, blueprintRows, type DeliveryTarget, runFilePath, type Schedule, type ScheduleRun, scheduleRows, scheduleRuns } from '@/core/cron'

import { readCached, writeCached } from './cache'
import { currentApi, onGatewayEvent } from './link'
import { $activeWorkspace } from './workspaces'

export const $schedules = atom<Schedule[] | null>(null)

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

export async function loadSchedules(): Promise<void> {
  const workspaceId = $activeWorkspace.get()?.id
  const rows = scheduleRows(await api().request({ path: '/api/cron/jobs' }))

  $schedules.set(rows)
  writeCached('schedules', rows, workspaceId)
}

/** Show the schedules of the last run until the host answers. */
export function restoreSchedules(): void {
  const rows = readCached<Schedule[]>('schedules')

  if (rows && !$schedules.get()) {
    $schedules.set(rows)
  }
}

/** A job belongs to a bot. The host finds it only in that bot's profile. */
function jobRequest(schedule: Schedule, tail: string, method: string, body?: unknown) {
  return api().request({ path: `/api/cron/jobs/${encodeURIComponent(schedule.id)}${tail}`, method, body, profile: schedule.profile, timeoutMs: 60_000 })
}

export async function pauseSchedule(schedule: Schedule, paused: boolean): Promise<void> {
  await jobRequest(schedule, paused ? '/pause' : '/resume', 'POST')
  await loadSchedules()
}

/** Run it now, once, apart from its times. */
export async function runSchedule(schedule: Schedule): Promise<void> {
  await jobRequest(schedule, '/trigger', 'POST')
  await loadSchedules()
}

export async function deleteSchedule(schedule: Schedule): Promise<void> {
  await jobRequest(schedule, '', 'DELETE')
  await loadSchedules()
}

export async function updateSchedule(schedule: Schedule, updates: { name?: string; prompt?: string; schedule?: string; deliver?: string }): Promise<void> {
  await jobRequest(schedule, '', 'PUT', { updates })
  await loadSchedules()
}

/** Make a schedule for a bot (`profile`; the main one with none). `deliver` is where its result goes. */
export async function createSchedule(prompt: string, when: string, name: string, profile?: string, deliver?: string): Promise<void> {
  await api().request({
    path: '/api/cron/jobs',
    method: 'POST',
    body: { prompt: prompt.trim(), schedule: when.trim(), name: name.trim(), ...(deliver ? { deliver } : {}) },
    profile,
    timeoutMs: 60_000
  })
  await loadSchedules()
}

/** The places a result can go on this host. Kept for the link: the list is the same for every schedule. */
export const $deliveryTargets = atom<DeliveryTarget[] | null>(null)

export async function loadDeliveryTargets(): Promise<void> {
  const result = await api().request<{ targets?: DeliveryTarget[] }>({ path: '/api/cron/delivery-targets' })

  $deliveryTargets.set((result.targets ?? []).filter(target => typeof target?.id === 'string'))
}

/** The templates of the host for a bot: ready schedules that ask a few questions. */
export async function loadBlueprints(profile?: string): Promise<Blueprint[]> {
  return blueprintRows(await api().request({ path: '/api/cron/blueprints', profile }))
}

/** Make a schedule from a template with the answers of the user. */
export async function createFromBlueprint(key: string, values: Record<string, string>, profile?: string): Promise<void> {
  await api().request({ path: '/api/cron/blueprints/instantiate', method: 'POST', body: { blueprint: key, values }, profile: profile || 'default', timeoutMs: 60_000 })
  await loadSchedules()
}

/** The whole text of a run whose result is a file on the host. Null for a run with a conversation. */
export async function loadRunText(schedule: Schedule, run: ScheduleRun): Promise<string | null> {
  const path = runFilePath(schedule, run)

  if (!path) {
    return null
  }

  return (await api().request<{ text?: string }>({ path: `/api/fs/read-text?path=${encodeURIComponent(path)}` })).text ?? ''
}

export async function loadRuns(schedule: Schedule): Promise<ScheduleRun[]> {
  return scheduleRuns(await jobRequest(schedule, '/runs?limit=10', 'GET'))
}

export function clearSchedules(): void {
  $deliveryTargets.set(null)
  $schedules.set(null)
}

// Another client, or the scheduler, changed a job.
onGatewayEvent(event => {
  if (event.type === 'cron.changed' && $schedules.get()) {
    void loadSchedules().catch(() => undefined)
  }
})
