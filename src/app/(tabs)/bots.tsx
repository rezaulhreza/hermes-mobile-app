import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar as Avatar, BotSheet, SheetFrame } from '@/components/bot-sheet'
import { ChoiceRow, ChoiceSheet } from '@/components/choice'
import { NewRoomSheet } from '@/components/room-sheets'
import { Button, Field, IconButton, Notice } from '@/components/ui'
import { type Bot, botGroups, botNameProblem, filterBots } from '@/core/bots'
import { previewLine, relativeTime } from '@/core/format'
import { $bots, $rooms, createBot, loadBots } from '@/store/bots'
import { createConversation } from '@/store/chat'
import { $linkState } from '@/store/link'
import { $roomsWritable, checkRoomsWritable } from '@/store/rooms'
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
  // The headings of the desktop app's Bots list: pinned, the user's sections, no section, put away.
  const groups = useMemo(() => botGroups(filterBots(bots ?? [], query)).map(group => ({ ...group, data: group.bots })), [bots, query])
  const open = bots?.find(bot => bot.name === detail)

  const pull = usePull(loadBots)
  const load = () => loadBots().then(() => setFailure(null), error => setFailure(error instanceof Error ? error.message : String(error)))

  useEffect(() => {
    if (linkState === 'open') {
      void load()
      void checkRoomsWritable()
    }
  }, [linkState])

  const talk = async (bot: Bot) => {
    setOpening(bot.name)

    try {
      if (bot.chatId) {
        router.push({ pathname: '/chat/[id]', params: { id: bot.chatId, title: bot.title, profile: bot.name } })
      } else {
        // Nobody has talked to this bot yet: its conversation starts now.
        const { storedId } = await createConversation(bot.name)

        router.push({ pathname: '/chat/[id]', params: { id: storedId, live: '1', profile: bot.name } })
      }
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
          keyExtractor={bot => bot.name}
          ListHeaderComponent={
            <>
              {bots.length > 6 ? (
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
              ) : null}
              {rooms.length && !query.trim() ? (
                <View style={styles.rooms}>
                  <Text style={[type.small, styles.heading, { color: t.muted }]}>Group chats</Text>
                  {rooms.map(room => (
                    <Pressable
                      accessibilityHint="Opens the group chat"
                      accessibilityLabel={`Group chat: ${room.name}`}
                      accessibilityRole="button"
                      key={room.id}
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
                          {room.messages.length ? <Text style={[type.small, { color: t.muted }]}>{relativeTime(room.messages[room.messages.length - 1].at / 1000)}</Text> : null}
                        </View>
                        <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
                          {room.messages.length ? previewLine(room.messages[room.messages.length - 1].text) : `${room.members.length} bots`}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          }
          refreshControl={<RefreshControl onRefresh={pull.onRefresh} refreshing={pull.refreshing} tintColor={t.muted} />}
          renderSectionHeader={({ section }) => (section.title ? <Text style={[type.small, styles.heading, { color: t.muted }]}>{section.title}</Text> : null)}
          sections={groups}
          stickySectionHeadersEnabled={false}
          renderItem={({ item }) => (
            <Pressable
              accessibilityHint="Opens the conversation with this bot. Hold for its details."
              accessibilityLabel={item.title}
              accessibilityRole="button"
              onLongPress={() => setDetail(item.name)}
              onPress={() => void talk(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
            >
              <Avatar bot={item} size={46} t={t} />
              <View style={styles.fill}>
                <View style={styles.nameRow}>
                  <Text numberOfLines={1} style={[type.label, styles.shrink, { color: t.ink }]}>
                    {item.title}
                  </Text>
                  {item.working ? <Text style={[type.small, styles.badge, { color: t.accent, backgroundColor: t.accentBg }]}>Working</Text> : null}
                  <View style={styles.fill} />
                  {item.lastActive ? <Text style={[type.small, { color: t.muted }]}>{relativeTime(item.lastActive)}</Text> : null}
                </View>
                <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
                  {item.preview || item.description || 'No role written yet.'}
                </Text>
              </View>
              {opening === item.name ? <ActivityIndicator color={t.muted} /> : null}
            </Pressable>
          )}
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
    </SafeAreaView>
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

  const add = () => {
    setBusy(true)
    createBot(name, description, like)
      .then(onClose, say)
      .finally(() => setBusy(false))
  }

  return (
    <SheetFrame onClose={onClose} title="Add a bot">
      <Text style={[type.small, { color: t.muted }]}>A bot is an agent of its own on your Hermes host, with its own role, memory and skills.</Text>
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

      <Button busy={busy} disabled={!name.trim() || Boolean(problem)} icon="plus" label="Add the bot" onPress={add} tone="primary" />
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  rooms: { gap: space.sm, marginBottom: space.sm },
  roomIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  heading: { fontWeight: '700', marginTop: space.sm },
  shrink: { flexShrink: 1 },
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
