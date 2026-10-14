/**
 * What a bot can do: its skills, its groups of tools, its MCP servers and its
 * plugins. Hermes keeps all of them PER PROFILE, so every list and every
 * change names the bot.
 */

export type CapabilityKind = 'skills' | 'toolsets' | 'mcp' | 'plugins'

export const CAPABILITY_KINDS: readonly { kind: CapabilityKind; label: string; detail: string; icon: 'book-open' | 'tool' | 'server' | 'package' }[] = [
  { kind: 'skills', label: 'Skills', detail: 'What the bot knows how to do', icon: 'book-open' },
  { kind: 'toolsets', label: 'Tools', detail: 'What the bot can use, in groups', icon: 'tool' },
  { kind: 'mcp', label: 'MCP servers', detail: 'Tools from other programs', icon: 'server' },
  { kind: 'plugins', label: 'Plugins', detail: 'Additions to Hermes itself', icon: 'package' }
]

export interface Capability {
  /** The name the host knows it by. Sent with a change, not shown. */
  id: string
  /** The name for a person. */
  title: string
  detail: string
  /** A word for the group it is in: a category, a source. */
  group: string
  on: boolean
  /** Why the user cannot switch it here. Empty: the user can. */
  locked: string
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')
const rows = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object') : [])

/** `apple-notes`, `web_search`, `platforms/a2a` as words: "Apple notes", "Web search", "A2a". */
export function readableName(key: string): string {
  const words = (key.split('/').pop() ?? key).replace(/[-_.]+/g, ' ').trim()

  return words ? words[0].toUpperCase() + words.slice(1) : key
}

const firstSentence = (words: string) => words.replace(/\s+/g, ' ').trim()

export function skillRows(result: unknown): Capability[] {
  return rows(result).flatMap(row =>
    text(row.name) ? [{ id: text(row.name), title: readableName(text(row.name)), detail: firstSentence(text(row.description)), group: readableName(text(row.category) || 'other'), on: row.enabled === true, locked: '' }] : []
  )
}

/** The host describes some groups by the keys of their tools (`execute_code`). A person gets the count. */
function toolsDetail(words: string, count: number): string {
  const said = firstSentence(words)

  return /^[a-z0-9_]+(, ?[a-z0-9_]+)*$/.test(said) && /_|^[a-z0-9]+$/.test(said) ? (count === 1 ? 'One tool' : `${count || 'Some'} tools`) : said
}

export function toolsetRows(result: unknown): Capability[] {
  return rows(result).flatMap(row =>
    text(row.name)
      ? [
          {
            id: text(row.name),
            title: text(row.label) || readableName(text(row.name)),
            detail: toolsDetail(text(row.description), Array.isArray(row.tools) ? row.tools.length : 0),
            group: '',
            on: row.enabled === true,
            locked: row.available === false ? 'This host does not have what these tools need.' : ''
          }
        ]
      : []
  )
}

export function mcpRows(result: unknown): Capability[] {
  return rows((result as { servers?: unknown } | null)?.servers).flatMap(row =>
    text(row.name)
      ? [
          {
            id: text(row.name),
            title: readableName(text(row.name)),
            detail: row.transport === 'stdio' ? 'A program on the host' : 'A server the host calls',
            group: '',
            on: row.enabled !== false,
            locked: text(row.plugin) ? `It comes with the plugin ${readableName(text(row.plugin))}.` : ''
          }
        ]
      : []
  )
}

export function pluginRows(result: unknown): Capability[] {
  return rows((result as { plugins?: unknown } | null)?.plugins).flatMap(row => {
    const key = text(row.key) || text(row.name)

    return key
      ? [
          {
            id: key,
            title: readableName(text(row.name) || key),
            detail: firstSentence(text(row.description).split('\n')[0]),
            group: row.source === 'bundled' ? 'Comes with Hermes' : 'Added to this host',
            on: row.status === 'enabled',
            // Without its sign-in the host lets nobody in, the phone too.
            locked: key.startsWith('dashboard_auth/') ? 'The sign-in of the host. It stays on.' : ''
          }
        ]
      : []
  })
}

/** The order of a list when it is read: what is on first, then by name. */
export function sortedCapabilities(items: readonly Capability[]): Capability[] {
  return [...items].sort((a, b) => Number(b.on) - Number(a.on) || a.title.localeCompare(b.title))
}

/** The rows that match what the user typed. The order stays: a row does not jump away when its switch moves. */
export function shownCapabilities(items: readonly Capability[], query: string): Capability[] {
  const needle = query.trim().toLowerCase()

  return needle ? items.filter(item => `${item.title} ${item.id} ${item.detail} ${item.group}`.toLowerCase().includes(needle)) : [...items]
}

/** "23 of 115 on". */
export function capabilityCount(items: readonly Capability[] | undefined): string {
  return items ? `${items.filter(item => item.on).length} of ${items.length} on` : ''
}
