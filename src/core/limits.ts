/**
 * A limit of a usage-window plan: the allowance of a plan ran out during a
 * turn. The gateway says what ran out, when it comes back, and the ways on:
 * a model that still works past the limit, or credits. This file reads that
 * and says it in words.
 */

import { clockWords } from './format'

export interface LimitSuggestion {
  model: string
  provider: string
  label: string
  note: string
}

/** `use`: turn on Keep going on credits. `add`: the account has no credits. `add_and_use`: both. */
export type CreditsWay = 'use' | 'add' | 'add_and_use'

export interface LimitCard {
  message: string
  /** What ran out: "today", "this week", "large models". Empty when the host gave no name. */
  name: string
  /** Unix milliseconds. Null when the host did not say. */
  resetsAt: number | null
  suggestions: LimitSuggestion[]
  credits: CreditsWay | null
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const CREDITS: Record<string, CreditsWay> = { use_credits: 'use', add_credits: 'add', add_credits_and_keep_going: 'add_and_use' }

/** The limit in the error surface of a failed turn. Null for any other failure. */
export function limitOf(surface: unknown): LimitCard | null {
  const limit = (surface as { usage_limit?: Record<string, unknown> | null } | null)?.usage_limit

  if (!limit || typeof limit !== 'object' || !text(limit.message)) {
    return null
  }

  const credits = (limit.credits as { action?: unknown } | null)?.action

  return {
    message: text(limit.message),
    name: text(limit.limit_name),
    resetsAt: typeof limit.resets_at_ms === 'number' && limit.resets_at_ms > 0 ? limit.resets_at_ms : null,
    suggestions: (Array.isArray(limit.suggestions) ? limit.suggestions : []).flatMap((row): LimitSuggestion[] => {
      const { model, provider, label, note } = (row ?? {}) as Record<string, unknown>

      return text(model) ? [{ model: text(model), provider: text(provider), label: text(label) || text(model), note: text(note) }] : []
    }),
    credits: CREDITS[text(credits)] ?? null
  }
}

const DAY = 86_400_000

/** "Back at 2:00 pm", "Back tomorrow at 9:00 am", "Back on Mon at 9:00 am". Empty when the time is not known. */
export function resetWords(resetsAt: number | null, now: Date): string {
  if (!resetsAt) {
    return ''
  }

  const at = new Date(resetsAt)

  if (resetsAt <= now.getTime()) {
    return 'It is back now.'
  }

  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOf(at) - startOf(now)) / DAY)
  const clock = clockWords(at)

  if (days === 0) {
    return `Back at ${clock}.`
  }

  if (days === 1) {
    return `Back tomorrow at ${clock}.`
  }

  return days < 7 ? `Back on ${at.toLocaleDateString('en-GB', { weekday: 'short' })} at ${clock}.` : `Back on ${at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.`
}

/** What the credits way offers, in words. Null when the phone has no button for it. */
export function creditsWords(way: CreditsWay | null): string | null {
  return way === 'use' ? 'Keep going on credits' : null
}

/** What to say when the account needs credits that the phone cannot add. */
export function addCreditsWords(way: CreditsWay | null): string | null {
  return way === 'add' || way === 'add_and_use' ? 'To go on before then, add credits to your Nous account.' : null
}
