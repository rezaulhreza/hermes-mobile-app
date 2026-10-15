import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar } from '@/components/bot-sheet'
import { Markdown } from '@/components/markdown'
import { RoomSettingsSheet } from '@/components/room-sheets'
import { IconButton, Notice } from '@/components/ui'
import { type Bot, botsByAnyName, type RoomMessage, UNMADE_ROOM } from '@/core/bots'
import { faultWords, relativeTime } from '@/core/format'
import { $bots, $rooms, loadBots } from '@/store/bots'
import { $linkState } from '@/store/link'
import { $roomsWritable, $roomWorking, checkRoomsWritable, sendToRoom, stopRoom, unwatchRoom, watchRoom } from '@/store/rooms'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * A group chat of bots: who is in it, what was said last, and a field to say
 * something to all of them. The host runs the round: it gives the message to
 * each member in turn and logs the answers in the record every client reads.
 * A host without the `group-rooms` plugin shows the record and takes no
 * message.
 */
export default function RoomScreen() {
  const t = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const room = useStore($rooms).find(known => known.id === id)
  const bots = useStore($bots)
  const linkState = useStore($linkState)
  const byName = useMemo(() => botsByAnyName(bots ?? []), [bots])
  // The list is upside down: it opens at the newest message with only the rows on screen drawn.
  const newestFirst = useMemo(() => [...(room?.messages ?? [])].reverse(), [room?.messages])

  const writable = useStore($roomsWritable)
  const working = useStore($roomWorking) === id
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    if (linkState === 'open') {
      void loadBots().catch(() => undefined)
      // A group with no record on the host has nothing to read there.
      void checkRoomsWritable().then(() => $roomsWritable.get() && !id.startsWith(UNMADE_ROOM) && watchRoom(id))
    }

    // No timer reads the room after the screen closed.
    return unwatchRoom
  }, [linkState, id])

  const send = () => {
    const text = draft.trim()

    setSending(true)
    setFault(null)
    setDraft('')
    sendToRoom(id, text)
      .catch(error => {
        setDraft(text)
        setFault(faultWords(error))
      })
      .finally(() => setSending(false))
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.heading, { color: t.ink }]}>
            {room?.name ?? 'Group chat'}
          </Text>
          {room ? (
            <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
              {room.members.map(name => byName.get(name)?.title ?? name).join(', ')}
            </Text>
          ) : null}
        </View>
        {room && writable && !room.unmade ? <IconButton icon="sliders" label="Group chat settings" onPress={() => setSettings(true)} /> : null}
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>

      {!room ? (
        <Notice detail="It may be closed on the desktop app." icon="users" title="This group chat is not on the host" />
      ) : (
        <FlatList
          ListEmptyComponent={
            room.unmade ? (
              <Notice
                detail="The desktop app has this group, and the host has no message of it yet. Write the first message in the desktop app. After that you can read and write here."
                icon="users"
                title="Nothing of this group is on the host yet"
              />
            ) : (
              <Notice icon="message-circle" title="Nothing was said here yet" />
            )
          }
          ListFooterComponent={
            room.omitted ? <Text style={[type.small, styles.note, { color: t.muted }]}>{room.omitted} earlier messages are not kept on the host.</Text> : null
          }
          ListHeaderComponent={
            working ? (
              <View style={styles.working}>
                <ActivityIndicator color={t.muted} size="small" />
                <Text style={[type.small, styles.fill, { color: t.muted }]}>The bots answer in turn.</Text>
              </View>
            ) : writable === false ? (
              <View style={[styles.foot, { backgroundColor: t.soft }]}>
                <Feather color={t.muted} name="monitor" size={16} />
                <Text style={[type.small, styles.fill, { color: t.muted }]}>
                  This host takes no message for a group chat from a phone: it needs the group-rooms plugin. Write in the desktop app, or open one bot on the Bots tab.
                </Text>
              </View>
            ) : null
          }
          contentContainerStyle={styles.list}
          data={newestFirst}
          initialNumToRender={10}
          inverted={newestFirst.length > 0}
          keyExtractor={message => message.id}
          renderItem={({ item }) => <Message bot={byName.get(item.from)} message={item} />}
          windowSize={7}
        />
      )}

      {room && writable && !room.unmade ? (
        <View style={[styles.composer, { borderTopColor: t.line }]}>
          {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
          <View style={styles.sendRow}>
            <TextInput
              accessibilityLabel="Message to the group"
              multiline
              onChangeText={setDraft}
              placeholder="Say something to all of them"
              placeholderTextColor={t.muted}
              style={[type.body, styles.input, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
              value={draft}
            />
            {working && !draft.trim() ? (
              <IconButton icon="square" label="Stop the bots" onPress={() => void stopRoom(id).catch(error => setFault(faultWords(error)))} />
            ) : (
              <IconButton disabled={!draft.trim() || sending} filled icon="arrow-up" label="Send to the group" onPress={send} />
            )}
          </View>
        </View>
      ) : null}
      {settings && room ? <RoomSettingsSheet onClose={() => setSettings(false)} onClosed={() => router.back()} room={room} /> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Message({ message, bot }: { message: RoomMessage; bot?: Bot }) {
  const t = useTheme()

  if (message.mine) {
    return (
      <View style={[styles.mine, { backgroundColor: t.soft }]}>
        <Text style={[type.body, { color: t.ink }]}>{message.text}</Text>
      </View>
    )
  }

  return (
    <View style={styles.theirs}>
      {bot ? <BotAvatar bot={bot} size={30} t={t} /> : <View style={[styles.unknown, { backgroundColor: t.soft }]} />}
      <View style={styles.fill}>
        <Text style={[type.small, { color: t.muted }]}>
          <Text style={{ color: t.ink, fontWeight: '700' }}>{bot?.title ?? message.from}</Text>
          {message.at ? `  ${relativeTime(message.at / 1000)}` : ''}
        </Text>
        <Markdown text={message.text} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  list: { padding: space.lg, gap: space.lg, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  note: { textAlign: 'center', paddingVertical: space.md },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
  working: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  composer: { gap: space.xs, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, maxWidth: 760, width: '100%', alignSelf: 'center' },
  sendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: { flex: 1, minHeight: TOUCH, maxHeight: 140, paddingHorizontal: space.md, paddingTop: 11, paddingBottom: 11, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  mine: { alignSelf: 'flex-end', maxWidth: '88%', padding: space.md, borderRadius: radius.lg },
  theirs: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  unknown: { width: 30, height: 30, borderRadius: 15 }
})
