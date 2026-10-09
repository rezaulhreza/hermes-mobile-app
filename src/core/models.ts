/**
 * The model and reasoning choices for one conversation.
 *
 * `model.options` returns every provider Hermes knows. A phone shows the ones
 * that can answer now: signed-in providers, with their featured models first.
 */

import type { ModelOptionsResult } from './gateway/gateway-contract.generated'

export interface ModelChoice {
  provider: string
  model: string
  /** The model without its vendor prefix, for a narrow screen. */
  label: string
  current: boolean
}

export interface ModelSection {
  provider: string
  name: string
  choices: ModelChoice[]
}

export const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
export type ReasoningLevel = (typeof REASONING_LEVELS)[number]

export function modelLabel(model: string): string {
  return model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model
}

export function modelSections(result: ModelOptionsResult): ModelSection[] {
  const sections: ModelSection[] = []

  for (const provider of result.providers ?? []) {
    if (provider.authenticated === false) {
      continue
    }

    const unavailable = new Set(provider.unavailable_models ?? [])
    const featured = provider.featured_models ?? []
    // Featured models first, then the rest, each once.
    const ordered = [...new Set([...featured, ...(provider.models ?? [])])].filter(model => !unavailable.has(model))

    if (!ordered.length) {
      continue
    }

    sections.push({
      provider: provider.slug,
      name: provider.name || provider.slug,
      choices: ordered.map(model => ({
        provider: provider.slug,
        model,
        label: modelLabel(model),
        current: provider.slug === result.provider && model === result.model
      }))
    })
  }

  // The provider in use goes first: the likely next pick is its neighbour.
  return sections.sort((a, b) => Number(b.provider === result.provider) - Number(a.provider === result.provider))
}

/** Narrow the sections to the models that match what the user typed. */
export function filterSections(sections: ModelSection[], query: string): ModelSection[] {
  const needle = query.trim().toLowerCase()

  if (!needle) {
    return sections
  }

  return sections
    .map(section => ({
      ...section,
      choices: section.name.toLowerCase().includes(needle)
        ? section.choices
        : section.choices.filter(choice => choice.model.toLowerCase().includes(needle))
    }))
    .filter(section => section.choices.length)
}

/**
 * The `config.set key=model` value for a switch that applies to this
 * conversation only. A phone never rewrites the profile default: the desktop
 * owns that, and a pick made in passing must not change every later session.
 */
export function sessionModelValue(choice: Pick<ModelChoice, 'model' | 'provider'>): string {
  return `${choice.model} --provider ${choice.provider} --session`
}

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === 'string' && (REASONING_LEVELS as readonly string[]).includes(value)
}
