import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar } from '@/components/bot-sheet'
import { Markdown } from '@/components/markdown'
import { MentionText } from '@/components/mention-text'
import { RoomActivity } from '@/components/room-activity'
import { RoomSettingsSheet } from '@/components/room-sheets'
import { Button, IconButton, Notice } from '@/components/ui'
import { type Bot, botsByAnyName, type RoomMessage, UNMADE_ROOM } from '@/core/bots'
import { faultWords, relativeTime } from '@/core/format'
import { roomAnswerLine, roomChoices, roomMentionParts, roomTargets, type TextPart, typedMention } from '@/core/mentions'
import { $bots, $rooms, loadBots } from '@/store/bots'
import { $linkState } from '@/store/link'
import { $roomRound, $roomsWritable, $roomWorking, checkRoomsWritable, forgetGroup, readFullMessage, sendToRoom, stopRoom, unwatchRoom, watchRoom } from '@/store/rooms'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * A group chat of bots: who is in it, what was said last, and a field to say
 * something to all of them. The host runs the round: it gives the message to
 * each member in turn and logs the answers in the record every client reads.
 * A message that names bots ("@qa") goes to those bots only: the field offers
 * the names, colours the ones the host follows and says who answers. While
 * the bots answer, a strip over the field names the bot that works now.
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
  const turns = useStore($roomRound)
  const [draft, setDraft] = useState('')
  const targets = useMemo(() => (room ? roomTargets(room, byName) : []), [room, byName])
  // One function for every row: a row is drawn again only when its text changes.
  const marked = useCallback((text: string) => roomMentionParts(text, targets), [targets])
  const typed = typedMention(draft)
  const choices = typed === null ? [] : roomChoices(targets, typed)
  const answerLine = roomAnswerLine(draft, targets)
  const [sending, setSending] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [removing, setRemoving] = useState(false)
  // The messages the host cut in the record, read in full: by the id of the message.
  const [full, setFull] = useState<Record<string, string>>({})
  const readAll = useCallback((messageId: string) => readFullMessage(id, messageId).then(text => setFull(known => ({ ...known, [messageId]: text }))), [id])

  const forget = () => {
    if (!room) {
      return
    }

    setSending(true)
    setFault(null)
    forgetGroup(room.id, room.name)
      .then(() => router.back())
      .catch(error => setFault(faultWords(error)))
      .finally(() => setSending(false))
  }

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
                action={
                  writable ? (
                    removing ? (
                      <View style={styles.confirm}>
                        <Text style={[type.small, { color: t.ink }]}>Remove “{room.name}” on every device? Its bots stay.</Text>
                        <View style={styles.sendRow}>
                          <Button label="Keep it" onPress={() => setRemoving(false)} style={styles.fill} />
                          <Button busy={sending} label="Remove it" onPress={forget} style={styles.fill} tone="danger" />
                        </View>
                      </View>
                    ) : (
                      <Button icon="trash-2" label="Remove this group" onPress={() => setRemoving(true)} tone="danger" />
                    )
                  ) : undefined
                }
                detail={fault ?? 'The desktop app has this group, and the host has no message of it yet. Write the first message in the desktop app. After that you can read and write here.'}
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
            writable === false ? (
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
          renderItem={({ item }) => <Message bot={byName.get(item.from)} full={full[item.id]} marked={marked} message={item} onReadAll={readAll} />}
          windowSize={7}
        />
      )}

      {room && writable && !room.unmade ? (
        <View style={[styles.composer, { borderTopColor: t.line }]}>
          {choices.length ? (
            <View style={[styles.choices, { backgroundColor: t.paper, borderColor: t.line }]}>
              {choices.map((target, index) => (
                <Pressable
                  accessibilityLabel={`Mention ${target.title}`}
                  accessibilityRole="button"
                  key={target.handle}
                  // The name replaces the word that is being typed.
                  onPress={() => setDraft(`${draft.slice(0, draft.length - (typed ?? '').length)}${target.handle} `)}
                  style={({ pressed }) => [styles.choice, index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
                >
                  {byName.get(target.name) ? <BotAvatar bot={byName.get(target.name)!} size={26} t={t} /> : <Feather color={t.muted} name="users" size={18} style={styles.choiceIcon} />}
                  <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                    {target.title}
                  </Text>
                  <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
                    @{target.handle}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <RoomActivity bots={byName} turns={turns} working={working} />
          {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
          {answerLine ? <Text style={[type.small, { color: t.muted }]}>{answerLine}</Text> : null}
          <View style={styles.sendRow}>
            <TextInput
              accessibilityLabel="Message to the group"
              autoCapitalize={typed === null ? 'sentences' : 'none'}
              multiline
              onChangeText={setDraft}
              placeholder="Say something to all of them, or @ one"
              placeholderTextColor={t.muted}
              style={[type.body, styles.input, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
            >
              <MentionText parts={roomMentionParts(draft, targets)} />
            </TextInput>
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

interface MessageProps {
  message: RoomMessage
  bot?: Bot
  marked: (text: string) => TextPart[]
  /** The whole message, when the host cut it in the record and the user asked for the rest. */
  full?: string
  onReadAll: (messageId: string) => Promise<void>
}

function Message({ message, bot, marked, full, onReadAll }: MessageProps) {
  const t = useTheme()
  const [reading, setReading] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const text = full ?? message.text

  // The record of the host holds the start of a long message. The rest is one request away.
  const more =
    message.cut && full === undefined ? (
      <Pressable
        accessibilityRole="button"
        disabled={reading}
        hitSlop={8}
        onPress={() => {
          setReading(true)
          setFault(null)
          onReadAll(message.id)
            // A host with an older plugin has no such route.
            .catch(error => setFault(faultWords(error) === 'Not Found' ? 'This host cannot give the rest yet. Update its group-rooms plugin.' : faultWords(error)))
            .finally(() => setReading(false))
        }}
      >
        <Text style={[type.small, { color: fault ? t.muted : t.accent, fontWeight: fault ? '400' : '600' }]}>{fault ?? (reading ? 'Reading the rest' : 'Show all')}</Text>
      </Pressable>
    ) : null

  if (message.mine) {
    return (
      <View style={[styles.mine, { backgroundColor: t.soft }]}>
        <Text style={[type.body, { color: t.ink }]}>
          <MentionText parts={marked(text)} />
        </Text>
        {more}
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
        <Markdown mentions={marked} text={text} />
        {more}
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
  composer: { gap: space.xs, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, maxWidth: 760, width: '100%', alignSelf: 'center' },
  choices: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md },
  choiceIcon: { width: 26, textAlign: 'center' },
  sendRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  input: { flex: 1, minHeight: TOUCH, maxHeight: 140, paddingHorizontal: space.md, paddingTop: 11, paddingBottom: 11, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  confirm: { gap: space.sm, alignSelf: 'stretch' },
  mine: { alignSelf: 'flex-end', maxWidth: '88%', padding: space.md, borderRadius: radius.lg, gap: space.xs },
  theirs: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  unknown: { width: 30, height: 30, borderRadius: 15 }
})
