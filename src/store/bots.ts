/** The bots (profiles) of the active workspace. */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { atom, map } from 'nanostores'
import { type ApprovalMode, approvalModeOf } from '@/core/approvals'

import { type Look, lookMeta } from '@/core/avatars'
import { type Bot, BOT_META_KEY, botRows, type BotSection, botSlug, type Filing, FILING_META_KEY, filingOf, groupRooms, newSectionId, NO_FILING, type ReadMarks, type Room } from '@/core/bots'
import { configReasoning, type ReasoningLevel } from '@/core/models'
import type { ProfilesCreateResult, ProfilesGetAssetResult, ProfilesListResult } from '@/core/gateway/gateway-contract.generated'

import { readCached, writeCached } from './cache'
import { currentApi, rpc } from './link'
import { $activeWorkspace } from './workspaces'

export const $bots = atom<Bot[] | null>(null)
/** The group chats of the bots, as the desktop app keeps them on the host. Not kept on the phone: they hold message text. */
export const $rooms = atom<Room[]>([])

/** The sections with no bot in them and the section of each group chat. The desktop app keeps its own on its machine; the phone keeps this on the host. */
export const $filing = atom<Filing>(NO_FILING)
/**
 * The bot that Hermes starts with when nobody names one: `hermes profile use`
 * on the host. A new chat of the phone starts with it too.
 */
export const $defaultBot = atom<string>('default')

// The profile that holds `$filing`, and the revision of that record.
let main: { name: string; revision: number | undefined } | null = null
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
  $filing.set(filingOf(result.profiles ?? []))
  metas.clear()

  const mainRow = (result.profiles ?? []).find(row => row.is_default)

  main = mainRow ? { name: mainRow.name, revision: mainRow.ui_meta_revisions?.[FILING_META_KEY] } : null
  void loadDefaultBot()

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

/** How far the user read each Bot Chat on this phone. The Bots list marks a bot with newer words. */
export const $botRead = atom<ReadMarks>({})

/**
 * The user sees this chat now. When it is the chat of a bot, it is read up to
 * the messages it has. The chat screen says it when it opens and when the user
 * leaves, so what the bot writes later is unread. Never throws.
 */
export async function markBotChatRead(chatId: string): Promise<void> {
  const ofChat = (bot: Bot) => bot.chatId === chatId || bot.chatRoot === chatId

  if (!$bots.get()?.some(ofChat)) {
    return
  }

  try {
    // How many messages the chat has now.
    await loadBots()
  } catch {
    // The count the list had is good enough.
  }

  const bot = $bots.get()?.find(ofChat)

  if (bot && bot.chatCount !== $botRead.get()[bot.name]) {
    $botRead.set({ ...$botRead.get(), [bot.name]: bot.chatCount })
    writeCached('botRead', $botRead.get())
  }
}

/** Show the bots of the last run until the host answers. */
export function restoreBots(): void {
  const bots = readCached<Bot[]>('bots')

  $botRead.set(readCached<ReadMarks>('botRead') ?? {})

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

/** What the Bots list keeps about a bot. The desktop app shows the same filing. */
export interface BotFiling {
  sectionId?: string | null
  sectionName?: string | null
  /** At the top of the list. */
  pinned?: boolean
  /** Put away, at the end of the list. */
  hidden?: boolean
}

async function writeBotFiling(name: string, change: BotFiling | ReturnType<typeof lookMeta>): Promise<void> {
  const known = metas.get(name)

  await rpc('profiles.configure', {
    name,
    ui_meta: { [BOT_META_KEY]: { ...(known?.meta ?? {}), ...change } },
    // The host refuses the write when another client changed the record in the meantime.
    ...(known?.revision !== undefined ? { ui_meta_expected_revisions: { [BOT_META_KEY]: known.revision } } : {})
  })
}

/** Change how the Bots list files a bot. The other fields of the desktop's record stay as they are. */
export async function fileBot(name: string, change: BotFiling): Promise<void> {
  await writeBotFiling(name, change)
  await loadBots()
}

async function saveFiling(next: Filing): Promise<void> {
  if (!main) {
    throw new Error('The host has no main profile to keep the sections on.')
  }

  await rpc('profiles.configure', {
    name: main.name,
    ui_meta: { [FILING_META_KEY]: next },
    ...(main.revision !== undefined ? { ui_meta_expected_revisions: { [FILING_META_KEY]: main.revision } } : {})
  })
  await loadBots()
}

/** The sections of the record with one of them added, or with its new name. */
function withSection(sections: readonly BotSection[], section: BotSection): BotSection[] {
  return [...sections.filter(known => known.id !== section.id), section]
}

/** Make a section with nothing in it. */
export async function makeSection(name: string): Promise<void> {
  const filing = $filing.get()

  await saveFiling({ ...filing, sections: withSection(filing.sections, { id: newSectionId(), name: name.trim() }) })
}

/** File a group chat under a section of the Bots list, or under none with null. */
export async function setRoomSection(roomId: string, section: BotSection | null): Promise<void> {
  const filing = $filing.get()
  const { [roomId]: _before, ...others } = filing.rooms

  await saveFiling({
    // The record keeps the name: no bot carries it when the section holds only group chats.
    sections: section ? withSection(filing.sections, section) : filing.sections,
    rooms: section ? { ...others, [roomId]: section.id } : others
  })
}

const botsOf = (section: BotSection) => ($bots.get() ?? []).filter(bot => bot.section?.id === section.id)

/** Give a section a new name. Each bot in it carries the name: the desktop app reads it there. */
export async function renameSection(section: BotSection, name: string): Promise<void> {
  const renamed = { id: section.id, name: name.trim() }

  for (const bot of botsOf(section)) {
    await writeBotFiling(bot.name, { sectionId: renamed.id, sectionName: renamed.name })
  }

  await saveFiling({ ...$filing.get(), sections: withSection($filing.get().sections, renamed) })
}

/** Remove a section. Its bots and its group chats stay: they are in no section then. */
export async function removeSection(section: BotSection): Promise<void> {
  for (const bot of botsOf(section)) {
    await writeBotFiling(bot.name, { sectionId: null, sectionName: null })
  }

  const filing = $filing.get()

  await saveFiling({
    sections: filing.sections.filter(known => known.id !== section.id),
    rooms: Object.fromEntries(Object.entries(filing.rooms).filter(([, id]) => id !== section.id))
  })
}

async function loadDefaultBot(): Promise<void> {
  try {
    $defaultBot.set((await api().request<{ active?: string }>({ path: '/api/profiles/active' })).active || 'default')
  } catch {
    // An older host has no such route: the main profile is the default then.
  }
}

/** Make a bot the one Hermes starts with: the same as `hermes profile use` on the host. */
export async function setDefaultBot(name: string): Promise<void> {
  await api().request({ path: '/api/profiles/active', method: 'POST', body: { name } })
  $defaultBot.set(name)
}

/** File a bot under a section of the Bots list, or under none with null. */
export function setBotSection(name: string, section: BotSection | null): Promise<void> {
  return fileBot(name, { sectionId: section?.id ?? null, sectionName: section?.name ?? null })
}

/** The model this bot thinks with. The other bots and the host keep theirs. */
export async function setBotModel(name: string, provider: string, model: string): Promise<void> {
  await api().request({ path: `/api/profiles/${encodeURIComponent(name)}/model`, method: 'PUT', body: { provider, model }, timeoutMs: 60_000 })
  await loadBots()
}

/** The reasoning level of this bot, as its config holds it. Empty when the config sets none. */
export async function loadBotReasoning(name: string): Promise<string> {
  return configReasoning(await api().request({ path: `/api/config?profile=${encodeURIComponent(name)}` }))
}

/** How hard this bot thinks. The host puts the level into the config of the bot: a chat that is open keeps its level until its next start. */
export async function setBotReasoning(name: string, level: ReasoningLevel): Promise<void> {
  await api().request({ path: `/api/config?profile=${encodeURIComponent(name)}`, method: 'PUT', body: { config: { agent: { reasoning_effort: level } } }, timeoutMs: 60_000 })
}

/** How this bot asks before a command that may be dangerous. */
export async function loadBotApprovals(name: string): Promise<ApprovalMode> {
  return approvalModeOf(await rpc('config.get', { key: 'approvals.mode', profile: name }))
}

/** Change how this bot asks. It applies to its chats from their next command. */
export async function setBotApprovals(name: string, mode: ApprovalMode): Promise<void> {
  await rpc('config.set', { key: 'approvals.mode', value: mode, profile: name }, 60_000)
}

const PICTURE_SIDE = 256

/**
 * Give a bot a drawn avatar: a shape and a colour. The choice goes into the
 * record of the bot, where the desktop app reads it, and the photo of the
 * bot goes away, because a photo wins over a drawn avatar on every screen.
 */
export async function setBotLook(name: string, look: Look): Promise<void> {
  await writeBotFiling(name, lookMeta(look))
  await rpc('profiles.set_asset', { name, asset: 'avatar', clear: true }, 60_000)
  // The desktop app can send a picture of the shape later: the phone must ask for it then.
  asked.delete(name)
  $botAvatars.setKey(name, '')
  writeCached('avatars', $botAvatars.get())
  await loadBots()
}

/** Choose a photo of the phone, made small, as a `data:` address. Null when the user chooses nothing. */
export async function pickBotPicture(): Promise<string | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 })
  const asset = picked.canceled ? null : picked.assets[0]

  if (!asset) {
    return null
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

  return `data:image/jpeg;base64,${small.base64}`
}

/** Make a picture the photo of a bot. */
export async function setBotPicture(name: string, data: string): Promise<void> {
  await rpc('profiles.set_asset', { name, asset: 'avatar', data }, 60_000)
  $botAvatars.setKey(name, data)
  writeCached('avatars', $botAvatars.get())
  await loadBots()
}

/** Choose a photo of the phone as the picture of a bot. Resolves with no change when the user chooses nothing. */
export async function chooseBotPicture(name: string): Promise<void> {
  const data = await pickBotPicture()

  if (data) {
    await setBotPicture(name, data)
  }
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
  main = null
  $rooms.set([])
  $filing.set(NO_FILING)
  $defaultBot.set('default')
  $bots.set(null)
  $botAvatars.set({})
}
