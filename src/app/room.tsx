import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar } from '@/components/bot-sheet'
import { Markdown } from '@/components/markdown'
import { MentionText } from '@/components/mention-text'
import { RoomActivity } from '@/components/room-activity'
import { RoomSettingsSheet } from '@/components/room-sheets'
import { Button, IconButton, Notice } from '@/components/ui'
import { type Bot, botsByAnyName, type RoomMessage, UNMADE_ROOM } from '@/core/bots'
import { faultWords, relativeTime } from '@/core/format'
import { currentThread, shownRows, threadFolds, type ThreadRow, threadRows, threadTitle } from '@/core/threads'
import { roomAnswerLine, roomChoices, roomMentionParts, roomTargets, type TextPart, typedMention } from '@/core/mentions'
import { $bots, $rooms, loadBots } from '@/store/bots'
import { $linkState } from '@/store/link'
import { $roomRound, $roomsWritable, $roomWorking, answerApproval, checkRoomsWritable, forgetGroup, readEarlier, readFullMessage, retryTurn, sendToRoom, stopRoom, stopTurn, unwatchRoom, watchRoom } from '@/store/rooms'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * A group chat of bots: who is in it, what was said last, and a field to say
 * something to all of them. The host runs the round: it gives the message to
 * each member in turn and logs the answers in the record every client reads.
 * A message that names bots ("@qa") goes to those bots only: the field offers
 * the names, colours the ones the host follows and says who answers. While
 * the bots answer, a strip over the field names the bot that works now.
 *
 * The messages are in threads, a topic each, as in a forum: the first
 * message of a thread is its topic, and its replies fold under it. The
 * newest thread is open, an older one opens on a tap. A message goes on with
 * the newest thread while that one is recent, and the field says so. The
 * user can start a new thread there, or reply in any older one.
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
  // The messages from before the record of the host: the user asked for them. They are whole, so none is cut.
  const [earlier, setEarlier] = useState<{ messages: RoomMessage[]; more: boolean; reading: boolean; fault: string | null }>({ messages: [], more: true, reading: false, fault: null })
  const messages = useMemo(() => {
    const recent = room?.messages ?? []
    const first = recent[0]?.at ?? Infinity
    const known = new Set(recent.map(message => message.id))

    // The record moves on while the screen is open: an earlier message that is in the record again shows once.
    return [...earlier.messages.filter(message => message.at < first && !known.has(message.id)), ...recent]
  }, [earlier.messages, room?.messages])
  const rows = useMemo(() => threadRows(messages), [messages])
  const folds = useMemo(() => threadFolds(rows), [rows])
  // A line between two threads. A room with one thread needs none.
  const several = useMemo(() => new Set(rows.map(row => row.thread)).size > 1, [rows])
  // The threads the user opened or folded by hand. The others follow the rule below.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  const writable = useStore($roomsWritable)
  const working = useStore($roomWorking) === id
  const round = useStore($roomRound)
  const [draft, setDraft] = useState('')
  const field = useRef<TextInput>(null)
  // The thread the user chose for the next message, or a new thread (null). No choice: the newest thread while it is recent.
  const [choice, setChoice] = useState<{ thread: string | null } | null>(null)
  const [now, setNow] = useState(Date.now)
  const thread = choice ? choice.thread : currentThread(messages, now)

  // The newest thread is open, and so is the thread the next message goes to. An older thread is folded to its topic.
  const newest = rows[rows.length - 1]?.thread
  const isOpen = useCallback((id: string) => toggled[id] ?? (id === newest || id === thread), [toggled, newest, thread])
  const newestFirst = useMemo(() => shownRows(rows, isOpen).reverse(), [rows, isOpen])

  // A thread stops being "recent" while the screen is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)

    return () => clearInterval(timer)
  }, [])
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

  const showEarlier = () => {
    const before = messages[0]?.at

    if (!before || earlier.reading) {
      return
    }

    setEarlier(known => ({ ...known, reading: true, fault: null }))
    readEarlier(id, before)
      .then(page => setEarlier(known => ({ messages: [...page.messages, ...known.messages], more: page.more, reading: false, fault: null })))
      // A host with an older plugin has no such route.
      .catch(error => setEarlier(known => ({ ...known, reading: false, fault: faultWords(error) === 'Not Found' ? 'This host cannot give earlier messages yet. Update its group-rooms plugin.' : faultWords(error) })))
  }

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

  /** Go on with the thread of a message. With a bot, the message starts with its name, so that bot answers. */
  const reply = useCallback(
    (row: ThreadRow, toBot = false) => {
      const handle = toBot ? targets.find(target => target.name === byName.get(row.message.from)?.name)?.handle : undefined

      setChoice({ thread: row.thread })
      setNow(Date.now())
      // The replies of the thread are the context of the answer: they must be in view.
      setToggled(known => ({ ...known, [row.thread]: true }))

      if (handle) {
        setDraft(text => (text.includes(`@${handle}`) ? text : `@${handle} ${text}`))
      }

      field.current?.focus()
    },
    [targets, byName]
  )

  const send = () => {
    const text = draft.trim()

    setSending(true)
    setFault(null)
    setDraft('')
    sendToRoom(id, text, thread)
      // The message is in its thread now, and that thread is the newest one.
      .then(() => setChoice(null))
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
            // The record of the host holds the newest messages. The ones before come from the log of its engine.
            room.omitted && writable && !room.unmade ? (
              earlier.fault || !earlier.more ? (
                <Text style={[type.small, styles.note, { color: t.muted }]}>{earlier.fault ?? 'This is the start of what the host has of this group.'}</Text>
              ) : (
                <Pressable accessibilityRole="button" disabled={earlier.reading} hitSlop={8} onPress={showEarlier} style={styles.earlier}>
                  {earlier.reading ? <ActivityIndicator color={t.muted} size="small" /> : <Feather color={t.accent} name="arrow-up" size={14} />}
                  <Text style={[type.small, { color: t.accent, fontWeight: '600' }]}>{earlier.reading ? 'Reading earlier messages' : 'Show earlier messages'}</Text>
                </Pressable>
              )
            ) : room.omitted ? (
              <Text style={[type.small, styles.note, { color: t.muted }]}>{room.omitted} earlier messages are not kept on the host.</Text>
            ) : null
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
          keyExtractor={row => row.message.id}
          renderItem={({ item }) => {
            const fold = item.first ? folds.get(item.thread) : undefined
            const open = isOpen(item.thread)

            return (
              <View style={styles.row}>
                {item.first && several ? (
                  <View style={styles.divider}>
                    <View style={[styles.line, { backgroundColor: t.line }]} />
                    <Text style={[type.small, { color: t.muted }]}>{item.message.at ? relativeTime(item.message.at / 1000) : 'Earlier'}</Text>
                    <View style={[styles.line, { backgroundColor: t.line }]} />
                  </View>
                ) : null}
                {/* A reply stands in from the topic, on a line down the side of its thread. */}
                <View style={item.first ? undefined : [styles.reply, { borderLeftColor: t.line }]}>
                  <Message
                    bot={byName.get(item.message.from)}
                    // A folded thread is its topic in a few lines. The whole message comes with the replies.
                    folded={Boolean(fold) && !open}
                    full={full[item.message.id]}
                    marked={marked}
                    message={item.message}
                    onReadAll={readAll}
                    onReply={writable && item.known ? () => reply(item, true) : undefined}
                  />
                </View>
                {fold ? (
                  <Pressable
                    accessibilityLabel={`${open ? 'Hide' : 'Show'} ${fold.replies} ${fold.replies > 1 ? 'replies' : 'reply'}`}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: open }}
                    hitSlop={6}
                    onPress={() => setToggled(known => ({ ...known, [item.thread]: !open }))}
                    style={styles.fold}
                  >
                    <Feather color={t.muted} name={open ? 'chevron-down' : 'chevron-right'} size={16} />
                    {open ? null : (
                      <View style={styles.faces}>
                        {fold.from.map(name =>
                          byName.get(name) ? <BotAvatar bot={byName.get(name)!} key={name} size={20} t={t} /> : <View key={name || 'you'} style={[styles.face, { backgroundColor: t.soft }]} />
                        )}
                      </View>
                    )}
                    <Text style={[type.small, { color: t.ink, fontWeight: '600' }]}>
                      {`${open ? 'Hide ' : ''}${fold.replies} ${fold.replies > 1 ? 'replies' : 'reply'}`}
                    </Text>
                    {open || !fold.lastAt ? null : <Text style={[type.small, { color: t.muted }]}>last {relativeTime(fold.lastAt / 1000)}</Text>}
                  </Pressable>
                ) : null}
                {item.last && item.known && writable && item.thread !== thread ? (
                  <Pressable accessibilityRole="button" hitSlop={8} onPress={() => reply(item)} style={styles.replyIn}>
                    <Feather color={t.accent} name="corner-down-right" size={14} />
                    <Text style={[type.small, { color: t.accent, fontWeight: '600' }]}>Reply in thread</Text>
                  </Pressable>
                ) : null}
              </View>
            )
          }}
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
          <RoomActivity bots={byName} marked={marked} onApproval={(action, choice) => answerApproval(id, action, choice)} onRetry={taskId => retryTurn(id, taskId)} onStop={() => stopRoom(id)} onStopTurn={taskId => stopTurn(id, taskId)} round={round} working={working} />
          {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
          {answerLine ? <Text style={[type.small, { color: t.muted }]}>{answerLine}</Text> : null}
          {thread ? (
            <View style={styles.inThread}>
              <Feather color={t.muted} name="corner-down-right" size={14} />
              <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
                In thread: <Text style={{ color: t.ink }}>{threadTitle(messages, thread) || 'earlier messages'}</Text>
              </Text>
              <Pressable accessibilityLabel="Start a new thread" accessibilityRole="button" hitSlop={10} onPress={() => setChoice({ thread: null })}>
                <Feather color={t.muted} name="x" size={16} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.sendRow}>
            <TextInput
              accessibilityLabel="Message to the group"
              autoCapitalize={typed === null ? 'sentences' : 'none'}
              multiline
              onChangeText={setDraft}
              placeholder={thread ? 'Reply in the thread, or @ one' : room.messages.length ? 'Start a new thread, or @ one' : 'Say something to all of them, or @ one'}
              placeholderTextColor={t.muted}
              ref={field}
              style={[type.body, styles.input, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
            >
              <MentionText parts={roomMentionParts(draft, targets)} typed />
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
  /** Reply to the bot of this message in its thread. Absent when the room takes no reply. */
  onReply?: () => void
  /** Show the start of the message only. */
  folded?: boolean
}

const FOLDED_LINES = 4

function Message({ message, bot, marked, full, onReadAll, onReply, folded = false }: MessageProps) {
  const t = useTheme()
  const [reading, setReading] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const text = full ?? message.text

  // The record of the host holds the start of a long message. The rest is one request away.
  const more =
    message.cut && full === undefined && !folded ? (
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
        <Text numberOfLines={folded ? FOLDED_LINES : undefined} style={[type.body, { color: t.ink }]}>
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
        <View style={styles.byline}>
          <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
            <Text style={{ color: t.ink, fontWeight: '700' }}>{bot?.title ?? message.from}</Text>
            {message.at ? `  ${relativeTime(message.at / 1000)}` : ''}
          </Text>
          {onReply ? (
            <Pressable accessibilityLabel={`Reply to ${bot?.title ?? message.from}`} accessibilityRole="button" hitSlop={10} onPress={onReply}>
              <Feather color={t.muted} name="corner-up-left" size={16} />
            </Pressable>
          ) : null}
        </View>
        {folded ? (
          <Text numberOfLines={FOLDED_LINES} style={[type.body, { color: t.ink }]}>
            <MentionText parts={marked(text.replace(/\s+/g, ' '))} />
          </Text>
        ) : (
          <Markdown mentions={marked} text={text} />
        )}
        {more}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { gap: space.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  reply: { marginLeft: space.xs, paddingLeft: space.md, borderLeftWidth: 2 },
  fold: { flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'flex-start', minHeight: 32 },
  faces: { flexDirection: 'row', gap: 4 },
  face: { width: 20, height: 20, borderRadius: 10 },
  replyIn: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start', paddingVertical: space.xs },
  inThread: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  byline: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  list: { padding: space.lg, gap: space.lg, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  note: { textAlign: 'center', paddingVertical: space.md },
  earlier: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: TOUCH },
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
