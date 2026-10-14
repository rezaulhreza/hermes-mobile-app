/**
 * The state of the Hermes host and its care: is it up, what it used, what
 * runs in the background, its logs, its maintenance jobs, and the chats of
 * other tools it can take in.
 */

export type OpsView = 'status' | 'usage' | 'work' | 'logs' | 'care' | 'import'

export const OPS_VIEWS: readonly { view: OpsView; label: string; detail: string; icon: 'activity' | 'bar-chart-2' | 'cpu' | 'file-text' | 'heart' | 'download' }[] = [
  { view: 'status', label: 'State', detail: 'Is Hermes up, and what version', icon: 'activity' },
  { view: 'usage', label: 'Usage', detail: 'Words in and out, and what they cost', icon: 'bar-chart-2' },
  { view: 'work', label: 'Background work', detail: 'Programs the bots left running', icon: 'cpu' },
  { view: 'logs', label: 'Logs', detail: 'The last lines Hermes wrote', icon: 'file-text' },
  { view: 'care', label: 'Care', detail: 'A health check, a backup, the skill curator', icon: 'heart' },
  { view: 'import', label: 'Chats from other tools', detail: 'Take a chat of Claude Code or Codex into Hermes', icon: 'download' }
]

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(record) : [])

/** 29926817 as "29.9M", 5400 as "5.4K". */
export function shortCount(count: number): string {
  const [limit, unit] = count >= 1e9 ? [1e9, 'B'] : count >= 1e6 ? [1e6, 'M'] : count >= 1e3 ? [1e3, 'K'] : [1, '']
  const scaled = count / limit

  return unit ? `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1).replace(/\.0$/, '')}${unit}` : String(Math.round(count))
}

export interface Fact {
  label: string
  value: string
  /** The value is a fault or a warning. */
  bad?: boolean
}

const GATEWAY_STATES: Readonly<Record<string, string>> = { running: 'Running', stopped: 'Stopped', starting: 'Starting', draining: 'Finishing its work before a restart', degraded: 'Running with a fault' }

/** The facts of the State view, from the status, the machine numbers and the update check. A part that did not answer adds nothing. */
export function hostFacts(status: unknown, stats: unknown, update: unknown): Fact[] {
  const s = record(status)
  const m = record(stats)
  const u = record(update)
  const platforms = record(record(s.components).platforms)
  const memory = record(m.memory)
  const disk = record(m.disk)
  const state = text(s.gateway_state)
  const facts: Fact[] = []

  if (text(s.version)) {
    facts.push({ label: 'Hermes', value: `Version ${text(s.version)}` })
  }

  if ('update_available' in u) {
    facts.push(u.update_available === true ? { label: 'Update', value: `A newer Hermes is ready${number(u.behind) ? `: ${number(u.behind)} changes` : ''}` } : { label: 'Update', value: 'Hermes is up to date' })
  }

  if (state || 'gateway_running' in s) {
    facts.push({ label: 'Messaging', value: GATEWAY_STATES[state] ?? (s.gateway_running === true ? 'Running' : 'Stopped'), bad: s.gateway_running !== true })
  }

  if (number(platforms.configured)) {
    facts.push({ label: 'Channels', value: `${number(platforms.connected)} of ${number(platforms.configured)} connected`, bad: number(platforms.connected) < number(platforms.configured) })
  }

  if ('active_sessions' in s) {
    facts.push({ label: 'At work now', value: number(s.active_agents) ? `${number(s.active_agents)} ${number(s.active_agents) === 1 ? 'bot' : 'bots'}` : 'Nothing' })
  }

  if (number(memory.total)) {
    facts.push({ label: 'Memory of the host', value: `${Math.round(number(memory.percent))}% in use`, bad: number(memory.percent) > 90 })
  }

  if (number(disk.total)) {
    const free = number(disk.free) / 1e9

    facts.push({ label: 'Disk of the host', value: `${free >= 10 ? Math.round(free) : free.toFixed(1)} GB free`, bad: free < 5 })
  }

  if (text(m.os)) {
    facts.push({ label: 'System', value: [text(m.os) === 'Darwin' ? 'macOS' : text(m.os), text(m.arch)].filter(Boolean).join(', ') })
  }

  return facts
}

export interface UsageDay {
  /** `2026-10-02`. */
  day: string
  tokens: number
  calls: number
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-10-09` as "9 Oct". Another shape stays as it is. */
export function dayName(day: string): string {
  const parts = /^\d{4}-(\d{2})-(\d{2})$/.exec(day)

  return parts && MONTHS[Number(parts[1]) - 1] ? `${Number(parts[2])} ${MONTHS[Number(parts[1]) - 1]}` : day
}

export interface UsageModel {
  model: string
  tokens: number
  calls: number
  sessions: number
}

export interface Usage {
  facts: Fact[]
  days: UsageDay[]
  /** The most tokens of one day, for the length of a bar. */
  peak: number
  models: UsageModel[]
}

const tokensOf = (row: Record<string, unknown>) => number(row.input_tokens) + number(row.output_tokens)

export function usageOf(result: unknown): Usage {
  const r = record(result)
  const totals = record(r.totals)
  const cost = number(totals.total_actual_cost) || number(totals.total_estimated_cost)
  const days = rows(r.daily)
    .flatMap(row => (text(row.day) ? [{ day: text(row.day), tokens: tokensOf(row), calls: number(row.api_calls) }] : []))
    .reverse()

  return {
    facts: [
      { label: 'Read by the models', value: `${shortCount(number(totals.total_input))} tokens` },
      { label: 'Written by the models', value: `${shortCount(number(totals.total_output))} tokens` },
      { label: 'Read again from the cache', value: `${shortCount(number(totals.total_cache_read))} tokens` },
      { label: 'Calls to the models', value: shortCount(number(totals.total_api_calls)) },
      { label: 'Chats', value: shortCount(number(totals.total_sessions)) },
      { label: 'Cost', value: cost ? `$${cost.toFixed(2)}` : 'No price is known for these models' }
    ],
    days,
    peak: Math.max(1, ...days.map(day => day.tokens)),
    models: rows(r.by_model)
      .flatMap(row => (text(row.model) ? [{ model: text(row.model), tokens: tokensOf(row), calls: number(row.api_calls), sessions: number(row.sessions) }] : []))
      .sort((a, b) => b.tokens - a.tokens)
  }
}

export interface BackgroundJob {
  /** The session that started it: the key to stop it. */
  sessionId: string
  command: string
  status: string
  /** Seconds. */
  uptime: number
}

export function backgroundJobs(result: unknown): BackgroundJob[] {
  return rows(record(result).processes).flatMap(row =>
    text(row.session_id) ? [{ sessionId: text(row.session_id), command: text(row.command) || 'A program', status: text(row.status), uptime: number(row.uptime) }] : []
  )
}

/** 75 as "1 min", 4000 as "1 h 6 min". */
export function uptimeWords(seconds: number): string {
  const minutes = Math.floor(seconds / 60)

  return minutes < 1 ? `${Math.round(seconds)} s` : minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export const LOG_FILES: readonly { id: string; label: string }[] = [
  { id: 'errors', label: 'Faults' },
  { id: 'agent', label: 'The bots' },
  { id: 'gateway', label: 'Messaging' }
]

export interface LogLine {
  id: string
  /** `20:34:00`, or empty for a line with no time (a part of the line before). */
  time: string
  level: string
  text: string
}

const LOG_HEAD = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2}:\d{2}),\d+ (\w+) (.*)$/s

/** The lines of a log, the newest first, each cut into its time, its level and its words. */
export function logLines(result: unknown): LogLine[] {
  const lines = record(result).lines

  return (Array.isArray(lines) ? lines : [])
    .flatMap((line, index): LogLine[] => {
      const whole = text(line).replace(/\s+$/, '')
      const head = LOG_HEAD.exec(whole)

      return whole ? [{ id: `l${index}`, time: head?.[1] ?? '', level: head?.[2] ?? '', text: head?.[3] ?? whole }] : []
    })
    .reverse()
}

export interface CareJob {
  id: string
  label: string
  detail: string
  /** The route that starts it. */
  path: string
  body?: Record<string, unknown>
  /** The name under which the host reports its output. Absent: the answer of the route is the result. */
  action?: string
  /** A check: an end with a fault code means that it found something, not that it broke. */
  finds?: boolean
  /** What the user must agree to first. Absent: it changes nothing. */
  confirm?: string
}

export const CARE_JOBS: readonly CareJob[] = [
  { id: 'doctor', label: 'Health check', detail: 'Hermes checks its own files, keys and tools', path: '/api/ops/doctor', action: 'doctor', finds: true },
  { id: 'audit', label: 'Security check', detail: 'Looks for weak settings and open doors', path: '/api/ops/security-audit', action: 'security-audit', finds: true },
  { id: 'backup', label: 'Backup', detail: 'Writes an archive of this Hermes on the host', path: '/api/ops/backup', body: {}, action: 'backup' },
  {
    id: 'share',
    label: 'Report for support',
    detail: 'Uploads a report and the logs, with secrets taken out, and gives links',
    path: '/api/ops/debug-share',
    confirm: 'This uploads a report and the logs of the host to a paste service. Secrets are taken out first. Anyone with the link can read them.'
  }
]

export interface JobOutput {
  running: boolean
  /** Null while it runs. 0 is success. */
  exitCode: number | null
  lines: string[]
}

export function jobOutput(result: unknown): JobOutput {
  const r = record(result)

  return { running: r.running === true, exitCode: typeof r.exit_code === 'number' ? r.exit_code : null, lines: (Array.isArray(r.lines) ? r.lines : []).map(line => text(line).replace(/\s+$/, '')) }
}

/** The links of a support report, or the words of the host when it gave none. */
export function shareLinks(result: unknown): string[] {
  const urls = record(result).urls

  return Array.isArray(urls) ? urls.map(text).filter(Boolean) : Object.values(record(urls)).map(text).filter(Boolean)
}

export interface Curator {
  enabled: boolean
  paused: boolean
  /** In words: when it ran last and how often it runs. */
  line: string
}

export function curatorOf(result: unknown, nowMs: number): Curator {
  const r = record(result)
  const last = Date.parse(text(r.last_run_at))
  const days = Number.isFinite(last) ? Math.floor((nowMs - last) / 86_400_000) : null
  const every = number(r.interval_hours)

  return {
    enabled: r.enabled === true,
    paused: r.paused === true,
    line: [days === null ? 'It did not run yet' : days < 1 ? 'It ran today' : `It ran ${days} ${days === 1 ? 'day' : 'days'} ago`, every ? `runs every ${every >= 48 ? `${Math.round(every / 24)} days` : `${every} hours`}` : ''].filter(Boolean).join(', ')
  }
}

export interface ForeignChat {
  id: string
  /** The tool it comes from, as a name: "Claude Code". */
  tool: string
  title: string
  turns: number
  /** Unix seconds. */
  at: number
}

export function foreignChats(result: unknown): ForeignChat[] {
  return rows(record(result).sessions).flatMap(row =>
    text(row.id) ? [{ id: text(row.id), tool: text(row.label) || text(row.source), title: (text(row.title) || text(row.excerpt) || 'A chat with no title').replace(/\s+/g, ' ').trim().slice(0, 120), turns: number(row.turn_count), at: number(row.mtime) }] : []
  )
}
