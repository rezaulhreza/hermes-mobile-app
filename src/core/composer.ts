/**
 * What the composer does with the text before it reaches the agent: complete
 * a slash command or a file reference while the user types, and decide what a
 * slash command's answer means.
 *
 * Completion looks at the END of the draft. On a phone the caret is almost
 * always there, and reading only the end keeps the rule easy to predict.
 */

export type Trigger =
  /** The whole draft is a slash command that is still being named: "/mod". */
  | { kind: 'slash'; word: string; start: number }
  /** The last word is a file reference: "look at @src/ap". */
  | { kind: 'path'; word: string; start: number }

export function activeTrigger(draft: string): Trigger | null {
  if (/^\/[^\s]*$/.test(draft)) {
    return { kind: 'slash', word: draft, start: 0 }
  }

  const match = /(^|\s)(@[^\s]*)$/.exec(draft)

  if (match) {
    return { kind: 'path', word: match[2], start: draft.length - match[2].length }
  }

  return null
}

/**
 * Put a chosen completion into the draft. The backend may say where its text
 * starts (`replaceFrom`); otherwise the completion replaces the trigger word.
 * A folder keeps the caret inside it, so the next level completes at once.
 */
export function applyCompletion(draft: string, trigger: Trigger, text: string, replaceFrom?: number | null): string {
  const start = typeof replaceFrom === 'number' && replaceFrom >= 0 && replaceFrom <= draft.length ? replaceFrom : trigger.start
  const next = draft.slice(0, start) + text

  return text.endsWith('/') ? next : `${next} `
}

export function isSlashCommand(draft: string): boolean {
  return /^\/[a-zA-Z]/.test(draft.trim())
}

/** Split "/model sonnet --session" into the name and the rest. */
export function splitSlash(command: string): { name: string; arg: string } {
  const trimmed = command.trim().replace(/^\//, '')
  const space = trimmed.search(/\s/)

  return space === -1 ? { name: trimmed, arg: '' } : { name: trimmed.slice(0, space), arg: trimmed.slice(space + 1).trim() }
}

export type SlashOutcome =
  /** Send this text to the agent as a normal message (a skill, or a command that expands to a prompt). */
  | { kind: 'submit'; text: string; notice: string }
  /** Put this text in the composer for the user to finish. */
  | { kind: 'prefill'; text: string; notice: string }
  /** The command is another name for this command: run that one. */
  | { kind: 'alias'; command: string }
  /** The command ran. Show what it printed. */
  | { kind: 'output'; text: string }

interface SlashResult {
  type?: string | null
  output?: string | null
  target?: string | null
  message?: string | null
  notice?: string | null
  warning?: string | null
}

export function slashOutcome(result: SlashResult | null | undefined, arg = ''): SlashOutcome {
  const message = result?.message?.trim() ?? ''
  const notice = result?.notice?.trim() ?? ''

  switch (result?.type) {
    case 'send':
    case 'skill':
      return message ? { kind: 'submit', text: message, notice } : { kind: 'output', text: notice || 'The command sent nothing.' }

    case 'prefill':
      return { kind: 'prefill', text: message, notice }

    case 'alias': {
      const target = result.target?.trim().replace(/^\//, '')

      return target ? { kind: 'alias', command: `/${target}${arg ? ` ${arg}` : ''}` } : { kind: 'output', text: 'Unknown command.' }
    }

    default: {
      const text = [result?.warning, result?.output].map(part => part?.trim()).filter(Boolean).join('\n\n')

      return { kind: 'output', text: text || notice || 'Done.' }
    }
  }
}
