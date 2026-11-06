/**
 * How a bot asks before it runs a command that may be dangerous. Hermes keeps
 * the mode in the config of each bot (`approvals.mode`).
 */

export type ApprovalMode = 'manual' | 'smart' | 'off'

export const APPROVAL_MODES: readonly { id: ApprovalMode; label: string; detail: string }[] = [
  { id: 'manual', label: 'Ask me', detail: 'Hermes asks you before each command that may be dangerous.' },
  { id: 'smart', label: 'Smart', detail: 'A model judges each such command. It asks you only when it is not sure, and stops a dangerous one.' },
  { id: 'off', label: 'Never ask', detail: 'Hermes runs every command without asking. Use it only for a bot you trust in a safe place.' }
]

/** The mode in the answer of `config.get`. A value Hermes does not know is the safe one: ask. */
export function approvalModeOf(result: unknown): ApprovalMode {
  const value = String((result as { value?: unknown } | null)?.value ?? '')
    .trim()
    .toLowerCase()

  return value === 'smart' || value === 'off' ? value : 'manual'
}

export const approvalModeLabel = (mode: ApprovalMode): string => APPROVAL_MODES.find(known => known.id === mode)?.label ?? 'Ask me'
