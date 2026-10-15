/**
 * The commands a chat left running in the background (a development server,
 * a long build). The host lists them for one session; the chat shows them
 * over the message field, as the desktop app does, so the user sees that
 * something still runs after the answer ended.
 */

export type BackgroundState = 'running' | 'done' | 'failed'

export interface BackgroundJob {
  /** The id of the process on the host. Sent to stop it. */
  id: string
  command: string
  state: BackgroundState
  /** Seconds since it started. */
  uptime: number
  /** Null while it runs, and when the host did not say. */
  exitCode: number | null
  /** Its last lines of output. */
  tail: string
}

/** A finished row leaves by itself after this long. A failure stays longer, so it is read. */
export const DONE_LINGER_MS = 4_000
export const FAILED_LINGER_MS = 12_000
/** How often the list is read again while a command runs: one that ends in silence sends no event. */
export const BACKGROUND_POLL_MS = 5_000

const text = (value: unknown) => (typeof value === 'string' ? value : '')

export function backgroundJobs(result: unknown): BackgroundJob[] {
  const processes = (result as { processes?: unknown } | null)?.processes

  return (Array.isArray(processes) ? processes : []).flatMap((entry: Record<string, unknown>): BackgroundJob[] => {
    const id = text(entry?.session_id)

    if (!id) {
      return []
    }

    const exitCode = typeof entry.exit_code === 'number' ? entry.exit_code : null
    const running = text(entry.status) === 'running'

    return [
      {
        id,
        command: text(entry.command).replace(/\s+/g, ' ').trim() || 'A command',
        state: running ? 'running' : exitCode ? 'failed' : 'done',
        uptime: typeof entry.uptime_seconds === 'number' ? entry.uptime_seconds : 0,
        exitCode: running ? null : exitCode,
        tail: (text(entry.output_tail) || text(entry.output_preview)).trim().split('\n').slice(-3).join('\n')
      }
    ]
  })
}

/**
 * The list after a new answer of the host. Rows keep their place (a row that
 * ends changes where it is), new ones go to the end, and a row the user took
 * away stays away.
 */
export function mergeBackground(shown: readonly BackgroundJob[], fresh: readonly BackgroundJob[], dismissed: ReadonlySet<string>): BackgroundJob[] {
  const next = new Map(fresh.filter(job => !dismissed.has(job.id)).map(job => [job.id, job]))
  const kept = shown.flatMap(old => {
    const now = next.get(old.id)

    next.delete(old.id)

    return now ? [now] : []
  })

  return [...kept, ...next.values()]
}

/** "1 command runs in the background", "2 commands run in the background", or what ended. */
export function backgroundHeading(jobs: readonly BackgroundJob[]): string {
  const running = jobs.filter(job => job.state === 'running').length

  if (running) {
    return `${running} ${running === 1 ? 'command runs' : 'commands run'} in the background`
  }

  return jobs.some(job => job.state === 'failed') ? 'A background command failed' : 'The background command ended'
}

/** The line under a command: how long it runs, or how it ended. */
export function backgroundLine(job: BackgroundJob): string {
  if (job.state === 'running') {
    const minutes = Math.floor(job.uptime / 60)

    return `Runs for ${minutes < 1 ? `${Math.round(job.uptime)} s` : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`}`
  }

  return job.state === 'failed' ? `Failed${job.exitCode === null ? '' : ` with code ${job.exitCode}`}` : 'Ended'
}

/** The tools that start or end a background command. After one of them the list is read again. */
export function touchesBackground(toolName: unknown): boolean {
  return toolName === 'terminal' || toolName === 'process'
}
