/**
 * Slash commands on a phone: which ones the app runs itself, which ones have
 * no meaning here, and the list the command sheet shows.
 *
 * The backend's command registry says where each command works (its `desktop`
 * field names the reason a command has no desktop surface). A phone shares
 * those reasons and adds its own: a command that drives the desktop window has
 * nothing to drive here.
 */

import type { CommandsCatalogResult, CompletionItem } from './gateway/gateway-contract.generated'

/** A command the app runs with its own code, not through `slash.exec`. */
export type PhoneAction =
  | 'new'
  | 'title'
  | 'branch'
  | 'model'
  | 'sessions'
  | 'help'
  | 'stop'
  | 'compress'
  | 'btw'
  | 'background'
  | 'steer'
  | 'queue'

const ACTIONS: Readonly<Record<string, PhoneAction>> = {
  '/new': 'new',
  '/reset': 'new',
  '/clear': 'new',
  '/title': 'title',
  '/branch': 'branch',
  '/fork': 'branch',
  '/model': 'model',
  '/resume': 'sessions',
  '/sessions': 'sessions',
  '/switch': 'sessions',
  '/help': 'help',
  '/commands': 'help',
  '/stop': 'stop',
  // The slash worker times out on a large session; the dedicated RPC waits.
  '/compress': 'compress',
  '/compact': 'compress',
  // Through the slash worker these two only return an acknowledgement. The
  // answer arrives later as an event on the live session.
  '/btw': 'btw',
  '/bg': 'background',
  '/background': 'background',
  '/steer': 'steer',
  '/queue': 'queue',
  '/q': 'queue'
}

type Reason = 'terminal' | 'desktop' | 'messaging' | 'settings' | 'voice' | 'advanced'

const REASON_TEXT: Readonly<Record<Reason, string>> = {
  terminal: 'works in the terminal only',
  desktop: 'works in the desktop app only',
  messaging: 'works in a messaging channel only',
  settings: 'is a setting, not a command, on the phone',
  voice: 'is not available on the phone yet',
  advanced: 'is not available on the phone'
}

/** The registry's `desktop` values, as phone reasons. */
const REGISTRY_REASON: Readonly<Record<string, Reason>> = {
  terminal: 'terminal',
  messaging: 'messaging',
  settings: 'settings',
  'composer-voice': 'voice',
  advanced: 'advanced'
}

/**
 * The commands with no phone surface, for the time before the catalog answers
 * and for names the registry does not know. The first five rows mirror
 * `apps/desktop/src/lib/desktop-slash-registry.json` in the Hermes repo.
 */
const NO_PHONE: Readonly<Record<Reason, readonly string[]>> = {
  terminal: [
    '/busy', '/config', '/copy', '/cron', '/exit', '/footer', '/gateway', '/history', '/image', '/indicator',
    '/paste', '/platforms', '/plugins', '/quit', '/redraw', '/reload', '/restart', '/sb', '/set-home', '/sethome',
    '/snap', '/snapshot', '/statusbar', '/toolsets', '/update', '/verbose', '/density', '/details', '/logs', '/mouse',
    '/battery'
  ],
  messaging: ['/approve', '/deny'],
  settings: ['/login'],
  voice: ['/voice'],
  advanced: ['/curator', '/fast', '/insights', '/kanban', '/reload-mcp', '/reload-skills', '/reload_mcp', '/reload_skills'],
  // The desktop runs these inside its own window: theme, pets, wake word, panels.
  desktop: [
    '/compose', '/prompt', '/skin', '/wake', '/pet', '/pets', '/hatch', '/generate-pet', '/journey', '/learning',
    '/memory-graph', '/palette', '/browser', '/profile'
  ]
}

const STATIC_REASON = new Map<string, Reason>(
  (Object.entries(NO_PHONE) as [Reason, readonly string[]][]).flatMap(([reason, names]) =>
    names.map(name => [name, reason] as const)
  )
)

type Catalog = CommandsCatalogResult | null | undefined

/** "/Model sonnet" and "model" both become "/model". */
export function commandName(text: string): string {
  const word = text.trim().split(/\s/, 1)[0].toLowerCase()

  return word.startsWith('/') ? word : `/${word}`
}

export function phoneAction(command: string): PhoneAction | null {
  return ACTIONS[commandName(command)] ?? null
}

/** Why a command does not run on a phone, as the end of a sentence. Null when it does run. */
export function phoneBlock(command: string, catalog?: Catalog): string | null {
  const name = commandName(command)

  if (ACTIONS[name]) {
    return null
  }

  const canonical = catalog?.canon?.[name] ?? name
  const reason =
    STATIC_REASON.get(name) ??
    STATIC_REASON.get(canonical) ??
    REGISTRY_REASON[catalog?.commands?.[name]?.desktop ?? catalog?.commands?.[canonical]?.desktop ?? '']

  return reason ? REASON_TEXT[reason] : null
}

/**
 * Drop the completions that name a command with no phone surface. Argument and
 * path completions pass. The backend sends a command's name without the slash
 * and marks the row with `kind`.
 */
export function phoneCompletions(items: readonly CompletionItem[], catalog?: Catalog): CompletionItem[] {
  return items.filter(item => !(item.kind === 'command' || item.text.startsWith('/')) || phoneBlock(item.text, catalog) === null)
}

export interface CommandRow {
  command: string
  description: string
}

export interface CommandSection {
  name: string
  data: CommandRow[]
}

/** The command sheet: the catalog's categories, then the skills, without the commands a phone cannot run. */
export function commandSections(catalog: Catalog): CommandSection[] {
  const rows = (pairs: readonly string[][] | undefined): CommandRow[] =>
    (pairs ?? [])
      .filter(pair => typeof pair[0] === 'string' && phoneBlock(pair[0], catalog) === null)
      .map(pair => ({ command: pair[0], description: pair[1] ?? '' }))

  const skills = catalog?.skills ?? {}
  const sections = (catalog?.categories ?? []).map(category => ({ name: category.name, data: rows(category.pairs) }))

  sections.push({ name: 'Skills', data: rows((catalog?.pairs ?? []).filter(pair => pair[0] in skills)) })

  return sections.filter(section => section.data.length > 0)
}

export function filterCommandSections(sections: readonly CommandSection[], query: string): CommandSection[] {
  const needle = query.trim().toLowerCase().replace(/^\//, '')

  if (!needle) {
    return [...sections]
  }

  return sections
    .map(section => ({
      ...section,
      data: section.data.filter(
        row => row.command.toLowerCase().includes(needle) || row.description.toLowerCase().includes(needle)
      )
    }))
    .filter(section => section.data.length > 0)
}
