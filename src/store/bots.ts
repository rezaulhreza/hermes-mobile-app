/** The bots (profiles) of the active workspace. */

import { atom, map } from 'nanostores'

import { type Bot, botRows, botSlug } from '@/core/bots'
import type { ProfilesCreateResult, ProfilesGetAssetResult, ProfilesListResult } from '@/core/gateway/gateway-contract.generated'

import { currentApi, rpc } from './link'

export const $bots = atom<Bot[] | null>(null)
/** The picture of each bot as a `data:` address. An empty text means none is there (yet). */
export const $botAvatars = map<Record<string, string>>({})

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

export async function loadBots(): Promise<void> {
  const result = await rpc<ProfilesListResult>('profiles.list', { include_sessions: true })
  const bots = botRows(result.profiles ?? [], Date.now() / 1000)

  $bots.set(bots)

  for (const bot of bots) {
    if (bot.hasAvatar && $botAvatars.get()[bot.name] === undefined) {
      $botAvatars.setKey(bot.name, '')
      // `data` is a whole `data:` address already, not bare base64.
      void rpc<ProfilesGetAssetResult>('profiles.get_asset', { name: bot.name, asset: 'avatar' })
        .then(asset => asset.found && asset.data && $botAvatars.setKey(bot.name, asset.data.startsWith('data:') ? asset.data : `data:${asset.mime || 'image/png'};base64,${asset.data}`))
        .catch(() => undefined)
    }
  }
}

/** Make a bot. With `cloneFrom` it starts with that bot's skills and settings. Returns its name on the host. */
export async function createBot(typedName: string, description: string, cloneFrom: string | null): Promise<string> {
  const result = await rpc<ProfilesCreateResult>(
    'profiles.create',
    { name: botSlug(typedName), description: description.trim() || null, ...(cloneFrom ? { clone_from: cloneFrom } : {}) },
    120_000
  )

  await loadBots()

  return result.name
}

export async function renameBot(name: string, typedName: string): Promise<void> {
  await api().request({ path: `/api/profiles/${encodeURIComponent(name)}`, method: 'PATCH', body: { new_name: botSlug(typedName) }, timeoutMs: 60_000 })
  await loadBots()
}

export async function describeBot(name: string, description: string): Promise<void> {
  await api().request({ path: `/api/profiles/${encodeURIComponent(name)}/description`, method: 'PUT', body: { description: description.trim() } })
  await loadBots()
}

/** The bot's own instructions (its SOUL.md). */
export async function loadBotSoul(name: string): Promise<string> {
  return (await api().request<{ content?: string }>({ path: `/api/profiles/${encodeURIComponent(name)}/soul` })).content ?? ''
}

export async function saveBotSoul(name: string, content: string): Promise<void> {
  await api().request({ path: `/api/profiles/${encodeURIComponent(name)}/soul`, method: 'PUT', body: { content } })
}

export async function deleteBot(name: string): Promise<void> {
  await api().request({ path: `/api/profiles/${encodeURIComponent(name)}`, method: 'DELETE', timeoutMs: 60_000 })
  await loadBots()
}

export function clearBots(): void {
  $bots.set(null)
  $botAvatars.set({})
}
