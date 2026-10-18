import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { AvatarSheet } from '@/components/avatar-sheet'
import { BotFace } from '@/components/bot-face'
import { BotAvatar as Avatar, BotSheet, SectionSheet, SheetFrame } from '@/components/bot-sheet'
import { ChoiceRow, ChoiceSheet } from '@/components/choice'
import { NewRoomSheet } from '@/components/room-sheets'
import { WorkingMark } from '@/components/working-mark'
import { Button, Field, IconButton, Notice } from '@/components/ui'
import { messageWords } from '@/core/attachments'
import { defaultLook, type Look } from '@/core/avatars'
import { type Bot, botGroups, botMark, botNameProblem, botSlug, type BotSection, filterBots, knownSections, type Room } from '@/core/bots'
import { previewLine, relativeTime } from '@/core/format'
import { $botRead, $bots, $defaultBot, $filing, $rooms, createBot, pickBotPicture, setBotLook, setBotPicture, loadBots, makeSection, removeSection, renameSection, setRoomSection } from '@/store/bots'
import { openBotChat } from '@/store/chat'
import { $linkState } from '@/store/link'
import { $roomsWritable, checkRoomsWritable } from '@/store/rooms'
import { $liveSessions, refreshLiveSessions } from '@/store/sessions'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { usePull } from '@/theme/use-pull'
import { useTheme } from '@/theme/use-theme'

import { TAB_BAR_CLEARANCE } from './_layout'

const say = (error: unknown) => Alert.alert('That did not work', error instanceof Error ? error.message : String(error))

/**
 * The bots of this Hermes: each one an agent with its own role. A tap opens
 * the one long conversation with that bot. A long press opens what it is.
 */
export default function Bots() {
  const t = useTheme()
  const bots = useStore($bots)
  const linkState = useStore($linkState)
  const [query, setQuery] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const rooms = useStore($rooms)
  const roomsWritable = useStore($roomsWritable)
  const [grouping, setGrouping] = useState(false)
  const filing = useStore($filing)
  const defaultBot = useStore($defaultBot)
  const searching = Boolean(query.trim())
  // The headings of the desktop app's Bots list: pinned, the user's sections, unassigned, put away.
  // A search shows the bots it finds only: no group chat, and no section with nothing found in it.
  const groups = useMemo(
    () =>
      botGroups(filterBots(bots ?? [], query), searching ? [] : rooms, filing)
        .filter(group => group.rows.length || !searching)
        .map(group => ({ ...group, data: group.rows })),
    [bots, query, searching, rooms, filing]
  )
  const sections = useMemo(() => knownSections(bots ?? [], filing.sections), [bots, filing])
  // The section sheet: a new section, or one to rename or remove.
  const [editing, setEditing] = useState<BotSection | 'new' | null>(null)
  const [movingRoom, setMovingRoom] = useState<Room | null>(null)
  const open = bots?.find(bot => bot.name === detail)

  const pull = usePull(loadBots)
  const load = () => loadBots().then(() => setFailure(null), error => setFailure(error instanceof Error ? error.message : String(error)))

  useEffect(() => {
    if (linkState === 'open') {
      void checkRoomsWritable()
    }
  }, [linkState])

  // The marks of each row, as on the chat list: the bot works, its chat waits for the user, or it has unread words.
  const live = useStore($liveSessions)
  const read = useStore($botRead)

  // Each time the list shows: the user can come back from a chat in which a bot still works.
  useFocusEffect(
    useCallback(() => {
      if (linkState === 'open') {
        void load()
        void refreshLiveSessions()
      }
    }, [linkState])
  )

  // A bot started or stopped: its last words and their time arrive when it stops.
  const lastLive = useRef(live)

  useEffect(() => {
    if (lastLive.current !== live && linkState === 'open') {
      void load()
    }

    lastLive.current = live
  }, [live, linkState])

  const talk = async (bot: Bot) => {
    setOpening(bot.name)

    try {
      await openBotChat(bot)
    } catch (error) {
      say(error)
    } finally {
      setOpening(null)
    }
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={styles.top}>
        <Text style={[type.title, styles.fill, { color: t.ink }]}>Bots</Text>
        {roomsWritable ? <IconButton icon="users" label="New group chat" onPress={() => setGrouping(true)} /> : null}
        <IconButton icon="columns" label="Board" onPress={() => router.push('/kanban')} />
        <IconButton icon="clock" label="Schedules" onPress={() => router.push('/cron')} />
        <IconButton disabled={!bots} filled icon="plus" label="Add a bot" onPress={() => setAdding(true)} />
      </View>

      {!bots ? (
        failure ? (
          <Notice action={<Button label="Try again" onPress={() => void load()} />} detail={failure} icon="alert-triangle" title="Could not read the bots" />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        )
      ) : (
        <SectionList
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          initialNumToRender={14}
          keyboardShouldPersistTaps="handled"
          keyExtractor={row => (row.kind === 'bot' ? `bot:${row.bot.name}` : `room:${row.room.id}`)}
          ListFooterComponent={searching ? null : <Button icon="folder-plus" label="Add a section" onPress={() => setEditing('new')} style={styles.addSection} />}
          ListHeaderComponent={
            bots.length > 6 ? (
              <TextInput
                accessibilityLabel="Find a bot"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Find a bot: a name or a role"
                placeholderTextColor={t.muted}
                style={[type.body, styles.search, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
                value={query}
              />
            ) : null
          }
          refreshControl={<RefreshControl onRefresh={pull.onRefresh} refreshing={pull.refreshing} tintColor={t.muted} />}
          renderSectionFooter={({ section }) =>
            section.section && !section.data.length ? (
              <Text style={[type.small, styles.empty, { color: t.muted, borderColor: t.line }]}>Nothing here yet. Hold a bot or a group chat, then choose this section.</Text>
            ) : null
          }
          renderSectionHeader={({ section }) => {
            const own = section.section

            if (!section.title) {
              return null
            }

            return own ? (
              <Pressable
                accessibilityHint="Opens the name of this section, and the way to remove it"
                accessibilityLabel={`Section: ${section.title}`}
                accessibilityRole="button"
                hitSlop={space.sm}
                onPress={() => setEditing(own)}
                style={styles.headingRow}
              >
                <Text numberOfLines={1} style={[type.small, styles.headingText, { color: t.muted }]}>
                  {section.title}
                </Text>
                <Feather color={t.muted} name="more-horizontal" size={18} />
              </Pressable>
            ) : (
              <Text style={[type.small, styles.heading, { color: t.muted }]}>{section.title}</Text>
            )
          }}
          sections={groups}
          stickySectionHeadersEnabled={false}
          renderItem={({ item: row }) => {
            if (row.kind === 'room') {
              const { room } = row
              const last = room.messages[room.messages.length - 1]

              return (
                <Pressable
                  accessibilityHint="Opens the group chat. Hold to move it to a section."
                  accessibilityLabel={`Group chat: ${room.name}`}
                  accessibilityRole="button"
                  onLongPress={() => setMovingRoom(room)}
                  onPress={() => router.push({ pathname: '/room', params: { id: room.id } })}
                  style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
                >
                  <View style={[styles.roomIcon, { backgroundColor: t.accentBg }]}>
                    <Feather color={t.accent} name="users" size={20} />
                  </View>
                  <View style={styles.fill}>
                    <View style={styles.nameRow}>
                      <Text numberOfLines={1} style={[type.label, styles.shrink, { color: t.ink }]}>
                        {room.name}
                      </Text>
                      <View style={styles.fill} />
                      {last ? <Text style={[type.small, { color: t.muted }]}>{relativeTime(last.at / 1000)}</Text> : null}
                    </View>
                    <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
                      {last ? previewLine(messageWords(last.text)) : `${room.members.length} bots`}
                    </Text>
                  </View>
                </Pressable>
              )
            }

            const item = row.bot
            const mark = botMark(item, live, read)
            const state = mark.live === 'working' ? 'Working' : mark.live ? 'Needs you' : mark.unread ? 'Unread' : ''

            return (
              <Pressable
                accessibilityHint="Opens the conversation with this bot. Hold for its details and its section."
                accessibilityLabel={state ? `${item.title}, ${state}` : item.title}
                accessibilityRole="button"
                onLongPress={() => setDetail(item.name)}
                onPress={() => void talk(item)}
                style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
              >
                <View>
                  <Avatar bot={item} size={46} t={t} />
                  {/* On the picture, so the rows keep one left edge. The ring is the colour of the row. */}
                  {mark.unread ? <View style={[styles.unread, { backgroundColor: t.accent, borderColor: t.paper }]} /> : null}
                </View>
                <View style={styles.fill}>
                  <View style={styles.nameRow}>
                    <Text numberOfLines={1} style={[type.label, styles.shrink, { color: t.ink }]}>
                      {item.title}
                    </Text>
                    {item.name === defaultBot ? <Text style={[type.small, styles.badge, { color: t.muted, backgroundColor: t.soft }]}>Default</Text> : null}
                    <View style={styles.fill} />
                    {mark.live === 'working' ? (
                      // The bot works now: the mark of the chat screen stands where the time was.
                      <WorkingMark />
                    ) : mark.live ? (
                      <Text style={[type.small, { color: t.accent, fontWeight: '600' }]}>Needs you</Text>
                    ) : item.lastActive ? (
                      <Text style={[type.small, { color: t.muted }]}>{relativeTime(item.lastActive)}</Text>
                    ) : null}
                  </View>
                  <Text numberOfLines={2} style={[type.small, { color: mark.unread ? t.ink : t.muted }]}>
                    {item.preview || item.description || 'No role written yet.'}
                  </Text>
                </View>
                {opening === item.name ? <ActivityIndicator color={t.muted} /> : null}
              </Pressable>
            )
          }}
          windowSize={7}
        />
      )}

      {open ? <BotSheet bot={open} onClose={() => setDetail(null)} onTalk={() => void talk(open)} /> : null}
      {grouping ? (
        <NewRoomSheet
          onClose={() => setGrouping(false)}
          onMade={id => {
            setGrouping(false)
            router.push({ pathname: '/room', params: { id } })
          }}
        />
      ) : null}
      {adding && bots ? <NewBotSheet bots={bots} onClose={() => setAdding(false)} /> : null}
      {editing ? <SectionEditSheet onClose={() => setEditing(null)} section={editing === 'new' ? null : editing} taken={sections} /> : null}
      {movingRoom ? (
        <SectionSheet
          current={sections.find(section => section.id === filing.rooms[movingRoom.id])?.id ?? null}
          onClose={() => setMovingRoom(null)}
          onPick={section => {
            setMovingRoom(null)
            setRoomSection(movingRoom.id, section).catch(say)
          }}
          sections={sections}
        />
      ) : null}
    </SafeAreaView>
  )
}

/** A new section with nothing in it, or the name of a section and the way to remove it. */
function SectionEditSheet({ section, taken, onClose }: { section: BotSection | null; taken: readonly BotSection[]; onClose: () => void }) {
  const t = useTheme()
  const [name, setName] = useState(section?.name ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const typed = name.trim()
  const problem = typed && taken.some(known => known.id !== section?.id && known.name.toLowerCase() === typed.toLowerCase()) ? `A section named “${typed}” exists already.` : null

  const run = (what: string, work: () => Promise<void>) => {
    setBusy(what)
    work()
      .then(onClose, say)
      .finally(() => setBusy(null))
  }

  return (
    <SheetFrame onClose={onClose} title={section ? 'Section' : 'Add a section'}>
      {section ? null : <Text style={[type.small, { color: t.muted }]}>A section is a heading of the Bots list. File bots and group chats under it.</Text>}
      <Field autoCapitalize="sentences" autoFocus={!section} error={problem} label="Name" onChangeText={setName} placeholder="Clients" value={name} />
      {section ? (
        <>
          <Button busy={busy === 'name'} disabled={!typed || typed === section.name || Boolean(problem)} label="Save the name" onPress={() => run('name', () => renameSection(section, typed))} />
          <Text style={[type.small, { color: t.muted }]}>When you remove the section, its bots and its group chats stay. They go under “Unassigned”.</Text>
          <Button busy={busy === 'remove'} icon="trash-2" label="Remove this section" onPress={() => run('remove', () => removeSection(section))} tone="danger" />
        </>
      ) : (
        <Button busy={busy === 'add'} disabled={!typed || Boolean(problem)} icon="plus" label="Add the section" onPress={() => run('add', () => makeSection(typed))} tone="primary" />
      )}
    </SheetFrame>
  )
}

function NewBotSheet({ bots, onClose }: { bots: readonly Bot[]; onClose: () => void }) {
  const t = useTheme()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [like, setLike] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const problem = name ? botNameProblem(name, bots.map(bot => bot.name)) : null
  // The avatar of the new bot: a look the user chose, or a photo. With neither, the look that comes from its name.
  const [look, setLook] = useState<Look | null>(null)
  const [photo, setPhoto] = useState<string | null>(null)
  const [avatar, setAvatar] = useState(false)
  const shown = look ?? defaultLook(botSlug(name))

  const add = () => {
    setBusy(true)
    createBot(name, description, like)
      // The bot is there. Its avatar is a second step: a fault in it must not say that the bot was not made.
      .then(made => (photo ? setBotPicture(made, photo) : look ? setBotLook(made, look) : undefined)?.catch(say))
      .then(onClose, say)
      .finally(() => setBusy(false))
  }

  return (
    <SheetFrame onClose={onClose} title="Add a bot">
      <Text style={[type.small, { color: t.muted }]}>A bot is an agent of its own on your Hermes host, with its own role, memory and skills.</Text>
      <Pressable accessibilityHint="Opens the choice of an avatar or a photo" accessibilityLabel="Avatar" accessibilityRole="button" onPress={() => setAvatar(true)} style={[styles.avatarRow, { backgroundColor: t.paper, borderColor: t.line }]}>
        {photo ? <Image accessibilityIgnoresInvertColors source={{ uri: photo }} style={styles.avatarPhoto} /> : <BotFace look={shown} size={48} />}
        <View style={styles.fill}>
          <Text style={[type.small, { color: t.muted }]}>Avatar</Text>
          <Text style={[type.label, { color: t.ink }]}>{photo ? 'A photo' : look ? 'The one you chose' : 'From its name'}</Text>
        </View>
        <Feather color={t.muted} name="chevron-right" size={18} />
      </Pressable>
      <Field autoCapitalize="words" error={problem} label="Name" onChangeText={setName} placeholder="Researcher" value={name} />
      <Field label="Role" multiline onChangeText={setDescription} placeholder="What this bot is for, in a sentence" style={styles.role} value={description} />

      <ChoiceRow icon="copy" label="Start as a copy of" onPress={() => setChoosing(true)} value={bots.find(bot => bot.name === like)?.title ?? 'Nothing: a new bot'} />
      {choosing ? (
        <ChoiceSheet
          choices={[{ id: '', label: 'Nothing: a new bot' }, ...bots.map(bot => ({ id: bot.name, label: bot.title, detail: bot.description, lead: <Avatar bot={bot} size={32} t={t} /> }))]}
          current={like ?? ''}
          onClose={() => setChoosing(false)}
          onPick={picked => (setLike(picked || null), setChoosing(false))}
          title="Start as a copy of"
        />
      ) : null}

      {avatar ? (
        <AvatarSheet
          busy={false}
          onClose={() => setAvatar(false)}
          onPhoto={() =>
            void pickBotPicture().then(data => {
              if (data) {
                setPhoto(data)
                setAvatar(false)
              }
            }, say)
          }
          onUse={chosen => {
            setLook(chosen)
            setPhoto(null)
            setAvatar(false)
          }}
          photo={photo}
          start={shown}
        />
      ) : null}

      <Button busy={busy} disabled={!name.trim() || Boolean(problem)} icon="plus" label="Add the bot" onPress={add} tone="primary" />
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  roomIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  heading: { fontWeight: '700', marginTop: space.sm },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  headingText: { fontWeight: '700', flex: 1 },
  empty: { padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', textAlign: 'center' },
  addSection: { marginTop: space.md },
  shrink: { flexShrink: 1 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  avatarPhoto: { width: 48, height: 48, borderRadius: 24 },
  unread: { position: 'absolute', top: -3, right: -3, width: 14, height: 14, borderRadius: 7, borderWidth: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },
  content: { padding: space.lg, gap: space.sm, paddingBottom: TAB_BAR_CLEARANCE, maxWidth: 760, width: '100%', alignSelf: 'center' },
  search: { minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { paddingHorizontal: space.sm, borderRadius: radius.sm, overflow: 'hidden', fontWeight: '700' },
  initials: { alignItems: 'center', justifyContent: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  sheet: { padding: space.lg, gap: space.md },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  talk: { marginTop: space.sm },
  role: { minHeight: 72, textAlignVertical: 'top', paddingTop: space.md },
  soul: { minHeight: 180, maxHeight: 320, textAlignVertical: 'top', paddingTop: space.md },
})
