/**
 * Bots: the profiles of a Hermes host. Each profile is an agent of its own,
 * with its own role, skills, model and memory, and one long conversation
 * with the owner (its "Bot Chat"). On the phone a bot is a person in a list:
 * who it is, what it does now, and a tap to talk.
 */

import type { ProfileRow } from './gateway/gateway-contract.generated'

export interface Bot {
  /** The name of the profile on the host: the id in every call. */
  name: string
  /** The name a person reads. */
  title: string
  description: string
  model: string
  /** The profile the host itself runs as. It cannot be deleted. */
  isDefault: boolean
  /** The stored id of its Bot Chat. Null for a bot nobody has talked to. */
  chatId: string | null
  /** The last words of its chat, for the row. */
  preview: string
  /** Unix seconds of its last activity, in a chat or as a worker. */
  lastActive: number
  /** It works on a task now (a kanban or tool worker was active a moment ago). */
  working: boolean
  skillCount: number
  hasAvatar: boolean
}

/** A worker row this fresh means the bot is at work. */
const WORKING_WINDOW_S = 120

function titleOf(row: ProfileRow): string {
  const shown = (row.display_name || row.name).trim()

  return shown.charAt(0).toUpperCase() + shown.slice(1)
}

export function botRows(profiles: readonly ProfileRow[], nowS: number): Bot[] {
  return profiles
    // A profile that exists only to finish a setup is not a bot yet.
    .filter(row => row.role !== 'setup')
    .map(row => {
      const chat = row.canonical_session
      const workerAt = row.worker_session?.last_active ?? 0

      return {
        name: row.name,
        title: titleOf(row),
        description: (row.description ?? '').trim(),
        model: row.model ?? '',
        isDefault: Boolean(row.is_default),
        chatId: chat?.resolved_id || chat?.id || null,
        preview: (chat?.preview ?? row.last_session?.preview ?? '').replace(/\s+/g, ' ').trim(),
        lastActive: Math.max(chat?.last_active ?? 0, row.last_session?.last_active ?? 0, workerAt),
        working: workerAt > 0 && nowS - workerAt < WORKING_WINDOW_S,
        skillCount: row.skill_count ?? 0,
        hasAvatar: Boolean(row.has_avatar)
      }
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(b.working) - Number(a.working) || b.lastActive - a.lastActive || a.title.localeCompare(b.title))
}

export function filterBots(bots: readonly Bot[], query: string): Bot[] {
  const needle = query.trim().toLowerCase()

  return needle ? bots.filter(bot => `${bot.title} ${bot.name} ${bot.description}`.toLowerCase().includes(needle)) : [...bots]
}

/** What a person types as a name, as the host stores it: lowercase, with hyphens for spaces. */
export function botSlug(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Why a new bot cannot have this name, or null. */
export function botNameProblem(typed: string, taken: readonly string[]): string | null {
  const slug = botSlug(typed)

  if (!slug) {
    return 'Give the bot a name with letters or digits.'
  }

  if (slug.length > 48) {
    return 'The name is too long. Use 48 characters or less.'
  }

  if (slug === 'default') {
    return '“default” is the name of the main profile.'
  }

  return taken.includes(slug) ? `A bot named “${slug}” exists already.` : null
}

/** One or two letters for a bot with no picture. */
export function botInitials(title: string): string {
  const words = title.split(/[\s-]+/).filter(Boolean)

  return (words.length > 1 ? words[0][0] + words[1][0] : title.slice(0, 2)).toUpperCase()
}
