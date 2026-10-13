/** The bots (profiles) of the active workspace. */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { atom, map } from 'nanostores'

import { type Bot, BOT_META_KEY, botRows, type BotSection, botSlug, groupRooms, type Room } from '@/core/bots'
import type { ProfilesCreateResult, ProfilesGetAssetResult, ProfilesListResult } from '@/core/gateway/gateway-contract.generated'

import { readCached, writeCached } from './cache'
import { currentApi, rpc } from './link'
import { $activeWorkspace } from './workspaces'

export const $bots = atom<Bot[] | null>(null)
/** The group chats of the bots, as the desktop app keeps them on the host. Not kept on the phone: they hold message text. */
export const $rooms = atom<Room[]>([])

// What the desktop app set for each bot. A change of one field must keep the others.
const metas = new Map<string, { meta: Record<string, unknown>; revision: number | undefined }>()
/** The picture of each bot as a `data:` address. An empty text means none is there (yet). */
export const $botAvatars = map<Record<string, string>>({})

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

/** The bots whose picture this link asked for already. A stored picture shows until the host's own arrives. */
const asked = new Set<string>()
let fetching = false

export async function loadBots(): Promise<void> {
  const workspaceId = $activeWorkspace.get()?.id
  const result = await rpc<ProfilesListResult>('profiles.list', { include_sessions: true })
  const bots = botRows(result.profiles ?? [], Date.now() / 1000)

  $bots.set(bots)
  $rooms.set(groupRooms(result.profiles ?? []))
  metas.clear()

  for (const row of result.profiles ?? []) {
    const meta = (row.ui_meta as Record<string, unknown> | null | undefined)?.[BOT_META_KEY]

    metas.set(row.name, { meta: meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}, revision: row.ui_meta_revisions?.[BOT_META_KEY] })
  }

  writeCached('bots', bots, workspaceId)
  void loadAvatars(bots, workspaceId)
}

/** One picture at a time: twenty requests at once made every other request of the start wait. */
async function loadAvatars(bots: readonly Bot[], workspaceId: string | undefined): Promise<void> {
  if (fetching) {
    return
  }

  fetching = true

  try {
    let changed = false

    for (const bot of bots) {
      if (!bot.hasAvatar || asked.has(bot.name)) {
        continue
      }

      asked.add(bot.name)

      try {
        const asset = await rpc<ProfilesGetAssetResult>('profiles.get_asset', { name: bot.name, asset: 'avatar' })
        // `data` is a whole `data:` address already, not bare base64.
        const picture = asset.found && asset.data ? (asset.data.startsWith('data:') ? asset.data : `data:${asset.mime || 'image/png'};base64,${asset.data}`) : ''

        if (workspaceId !== $activeWorkspace.get()?.id) {
          return
        }

        if (picture !== ($botAvatars.get()[bot.name] ?? '')) {
          $botAvatars.setKey(bot.name, picture)
          changed = true
        }
      } catch {
        // The initials show. The next link asks again.
      }
    }

    if (changed) {
      writeCached('avatars', $botAvatars.get(), workspaceId)
    }
  } finally {
    fetching = false
  }
}

/** Show the bots of the last run until the host answers. */
export function restoreBots(): void {
  const bots = readCached<Bot[]>('bots')

  if (bots?.length && !$bots.get()) {
    $bots.set(bots)
    $botAvatars.set(readCached<Record<string, string>>('avatars') ?? {})
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

/** File a bot under a section of the Bots list, or under none with null. The desktop app shows the same filing. */
export async function setBotSection(name: string, section: BotSection | null): Promise<void> {
  const known = metas.get(name)

  await rpc('profiles.configure', {
    name,
    ui_meta: { [BOT_META_KEY]: { ...(known?.meta ?? {}), sectionId: section?.id ?? null, sectionName: section?.name ?? null } },
    // The host refuses the write when another client changed the record in the meantime.
    ...(known?.revision !== undefined ? { ui_meta_expected_revisions: { [BOT_META_KEY]: known.revision } } : {})
  })
  await loadBots()
}

/** The model this bot thinks with. The other bots and the host keep theirs. */
export async function setBotModel(name: string, provider: string, model: string): Promise<void> {
  await api().request({ path: `/api/profiles/${encodeURIComponent(name)}/model`, method: 'PUT', body: { provider, model }, timeoutMs: 60_000 })
  await loadBots()
}

const PICTURE_SIDE = 256

/** Choose a photo of the phone as the picture of a bot. Resolves with no change when the user chooses nothing. */
export async function chooseBotPicture(name: string): Promise<void> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 })
  const asset = picked.canceled ? null : picked.assets[0]

  if (!asset) {
    return
  }

  // A picture of a list row: small on the host and on every phone that reads it.
  const small = await (await ImageManipulator.manipulate(asset.uri).resize({ width: PICTURE_SIDE, height: PICTURE_SIDE }).renderAsync()).saveAsync({
    format: SaveFormat.JPEG,
    compress: 0.85,
    base64: true
  })

  if (!small.base64) {
    throw new Error('The phone could not read this picture.')
  }

  const data = `data:image/jpeg;base64,${small.base64}`

  await rpc('profiles.set_asset', { name, asset: 'avatar', data }, 60_000)
  $botAvatars.setKey(name, data)
  writeCached('avatars', $botAvatars.get())
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
  asked.clear()
  metas.clear()
  $rooms.set([])
  $bots.set(null)
  $botAvatars.set({})
}
