/**
 * Settings of the Hermes host that are not about one provider: the helper
 * models, the user's own endpoints, and the memory. Rules with no network.
 */

/** One helper job of the host and the model that does it, as `GET /api/model/auxiliary` gives it. */
export interface HelperTask {
  task: string
  /** `auto`: the host chooses, mostly the main model. */
  provider: string
  model: string
}

const TASK_NAMES: Readonly<Record<string, { name: string; what: string }>> = {
  vision: { name: 'Reading pictures', what: 'Describes a picture for a main model that cannot see' },
  compression: { name: 'Summaries of long chats', what: 'Makes a long conversation short when it fills up' },
  title: { name: 'Chat titles', what: 'Names a new conversation' },
  title_generation: { name: 'Chat titles', what: 'Names a new conversation' },
  approval: { name: 'Risk checks', what: 'Judges if a command needs your approval' },
  mcp: { name: 'Tool servers', what: 'Helps with the answers of MCP tools' },
  skills_hub: { name: 'Skills hub', what: 'Finds and reads skills' },
  web_extract: { name: 'Reading web pages', what: 'Takes the useful text out of a page' },
  session_search: { name: 'Search in old chats', what: 'Sums up what a search of your chats found' },
  flush_memories: { name: 'Saving memories', what: 'Writes what to remember when a chat ends' },
  curator: { name: 'Skill care', what: 'Keeps your skills tidy' }
}

/** The name of a helper job for a person, and what the job is. A job the app does not know shows its own name in words. */
export function taskName(task: string): { name: string; what: string } {
  return TASK_NAMES[task] ?? { name: task.replace(/[_-]+/g, ' ').replace(/^./, letter => letter.toUpperCase()), what: '' }
}

export function helperTasks(result: unknown): HelperTask[] {
  const tasks = (result as { tasks?: unknown } | null)?.tasks

  return Array.isArray(tasks)
    ? tasks.flatMap((item: Partial<HelperTask>) => (typeof item?.task === 'string' ? [{ task: item.task, provider: item.provider || 'auto', model: item.model || '' }] : []))
    : []
}

/** What a helper job runs on, in words. */
export function helperLine(task: HelperTask, label: (model: string) => string): string {
  return !task.model || task.provider === 'auto' ? 'Automatic: the host chooses' : label(task.model)
}

/** An endpoint the user added: a server that speaks the OpenAI protocol. */
export interface Endpoint {
  id: string
  name: string
  baseUrl: string
  model: string
  /** Hermes runs on it now. */
  active: boolean
}

export function endpointRows(result: unknown): Endpoint[] {
  const { endpoints, current } = (result ?? {}) as { endpoints?: unknown; current?: { base_url?: unknown } }
  const now = typeof current?.base_url === 'string' ? current.base_url.replace(/\/+$/, '') : ''

  return Array.isArray(endpoints)
    ? endpoints.flatMap((item: { id?: unknown; name?: unknown; base_url?: unknown; model?: unknown }) => {
        const baseUrl = typeof item?.base_url === 'string' ? item.base_url : ''

        return typeof item?.id === 'string' && baseUrl
          ? [{ id: item.id, name: typeof item.name === 'string' && item.name ? item.name : baseUrl, baseUrl, model: typeof item.model === 'string' ? item.model : '', active: baseUrl.replace(/\/+$/, '') === now }]
          : []
      })
    : []
}

/** Why the form of a new endpoint cannot be sent, or null. */
export function endpointProblem(form: { name: string; baseUrl: string; model: string }): string | null {
  if (!form.name.trim()) {
    return 'Give the endpoint a name.'
  }

  if (!/^https?:\/\/[^\s/]+/i.test(form.baseUrl.trim())) {
    return 'The address must start with http:// or https://.'
  }

  return form.model.trim() ? null : 'Name the model, or check the address to choose one.'
}

/** A way the host can keep memory between chats. */
export interface MemoryChoice {
  name: string
  description: string
  /** Its programs are on the host and it can be turned on. */
  available: boolean
  active: boolean
}

export function memoryChoices(result: unknown): MemoryChoice[] {
  const { active, providers } = (result ?? {}) as { active?: unknown; providers?: unknown }

  return Array.isArray(providers)
    ? providers.flatMap((item: { name?: unknown; description?: unknown; available?: unknown }) =>
        typeof item?.name === 'string'
          ? [{ name: item.name, description: typeof item.description === 'string' ? item.description.replace(/^[^—]*—\s*/, '') : '', available: item.available === true, active: item.name === active }]
          : []
      )
    : []
}

/** The name of a memory kind with a capital letter, as a person writes a name. */
export function memoryName(name: string): string {
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Built-in memory'
}
