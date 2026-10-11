/** The schedules (cron jobs) of the active workspace, for every bot. */

import { atom } from 'nanostores'

import { type Schedule, type ScheduleRun, scheduleRows, scheduleRuns } from '@/core/cron'

import { currentApi, onGatewayEvent } from './link'

export const $schedules = atom<Schedule[] | null>(null)

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

export async function loadSchedules(): Promise<void> {
  $schedules.set(scheduleRows(await api().request({ path: '/api/cron/jobs' })))
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

export async function updateSchedule(schedule: Schedule, updates: { name?: string; prompt?: string; schedule?: string }): Promise<void> {
  await jobRequest(schedule, '', 'PUT', { updates })
  await loadSchedules()
}

export async function createSchedule(prompt: string, when: string, name: string, profile?: string): Promise<void> {
  await api().request({ path: '/api/cron/jobs', method: 'POST', body: { prompt: prompt.trim(), schedule: when.trim(), name: name.trim() }, profile, timeoutMs: 60_000 })
  await loadSchedules()
}

export async function loadRuns(schedule: Schedule): Promise<ScheduleRun[]> {
  return scheduleRuns(await jobRequest(schedule, '/runs?limit=10', 'GET'))
}

export function clearSchedules(): void {
  $schedules.set(null)
}

// Another client, or the scheduler, changed a job.
onGatewayEvent(event => {
  if (event.type === 'cron.changed' && $schedules.get()) {
    void loadSchedules().catch(() => undefined)
  }
})
