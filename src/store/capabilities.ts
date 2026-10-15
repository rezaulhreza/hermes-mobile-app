/** The capabilities of ONE bot. Filled while the Capabilities screen is open, emptied when it closes. */

import { atom, map } from 'nanostores'

import { type Capability, type CapabilityKind, mcpRows, pluginRows, skillRows, sortedCapabilities, toolsetRows } from '@/core/capabilities'

import { currentApi, rpc } from './link'

/** The profile on screen. */
export const $capabilityProfile = atom<string>('')
export const $capabilities = map<Partial<Record<CapabilityKind, Capability[]>>>({})

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

const of = (profile: string) => `?profile=${encodeURIComponent(profile)}`

const READ: Record<CapabilityKind, (profile: string) => Promise<Capability[]>> = {
  skills: async profile => skillRows(await api().request({ path: `/api/skills${of(profile)}` })),
  toolsets: async profile => toolsetRows(await api().request({ path: `/api/tools/toolsets${of(profile)}` })),
  mcp: async profile => mcpRows(await api().request({ path: `/api/mcp/servers${of(profile)}` })),
  plugins: async profile => pluginRows(await rpc('plugins.manage', { action: 'list', profile }, 60_000))
}

const WRITE: Record<CapabilityKind, (profile: string, id: string, on: boolean) => Promise<unknown>> = {
  skills: (profile, id, on) => api().request({ path: `/api/skills/toggle${of(profile)}`, method: 'PUT', body: { name: id, enabled: on, profile } }),
  toolsets: (profile, id, on) => api().request({ path: `/api/tools/toolsets/${encodeURIComponent(id)}${of(profile)}`, method: 'PUT', body: { enabled: on, profile } }),
  mcp: (profile, id, on) => api().request({ path: `/api/mcp/servers/${encodeURIComponent(id)}/enabled${of(profile)}`, method: 'PUT', body: { enabled: on, profile } }),
  plugins: (profile, id, on) => rpc('plugins.manage', { action: 'toggle', key: id, enable: on, profile }, 60_000)
}

/** The skills of one bot, for a count outside the Capabilities screen. The lists of the screen stay as they are. */
export function readSkills(profile: string): Promise<Capability[]> {
  return READ.skills(profile)
}

/** Show the capabilities of this bot. The lists of the bot before are dropped. */
export function showCapabilitiesOf(profile: string): void {
  if (profile !== $capabilityProfile.get()) {
    $capabilityProfile.set(profile)
    $capabilities.set({})
  }
}

/** Read one kind for the bot on screen. An answer for a bot the user left is not shown. */
export async function loadCapabilities(kind: CapabilityKind): Promise<void> {
  const profile = $capabilityProfile.get()
  const items = sortedCapabilities(await READ[kind](profile))

  if (profile === $capabilityProfile.get()) {
    $capabilities.setKey(kind, items)
  }
}

const put = (kind: CapabilityKind, id: string, on: boolean) => $capabilities.setKey(kind, ($capabilities.get()[kind] ?? []).map(item => (item.id === id ? { ...item, on } : item)))

/**
 * Switch one capability of the bot on screen. The switch moves at once and
 * goes back when the host refuses. Answers true when Hermes must start again
 * before the change works.
 */
export async function setCapability(kind: CapabilityKind, id: string, on: boolean): Promise<boolean> {
  const profile = $capabilityProfile.get()

  put(kind, id, on)

  try {
    return ((await WRITE[kind](profile, id, on)) as { restart_required?: unknown } | null)?.restart_required === true
  } catch (error) {
    if (profile === $capabilityProfile.get()) {
      put(kind, id, !on)
    }

    throw error
  }
}

export function clearCapabilities(): void {
  $capabilityProfile.set('')
  $capabilities.set({})
}
