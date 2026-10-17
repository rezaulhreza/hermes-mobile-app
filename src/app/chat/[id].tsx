import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { useStore } from '@nanostores/react'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Answer } from '@/components/answer'
import { ArrivalRow } from '@/components/arrival'
import { TeachSheet } from '@/components/teach-sheet'
import { AttachmentViewer, type ViewerTarget } from '@/components/attachment-viewer'
import { SentAttachments, StagedAttachment } from '@/components/attachments'
import { BotAvatar, BotSheet } from '@/components/bot-sheet'
import { CommandsSheet } from '@/components/commands-sheet'
import { SayToAgent } from '@/components/draft-card'
import { Markdown } from '@/components/markdown'
import { MentionText } from '@/components/mention-text'
import { SourcesButton, SourcesSheet } from '@/components/sources'
import { ModelSheet } from '@/components/model-sheet'
import { PreviewPane, PreviewPill } from '@/components/preview-pane'
import { BackgroundPanel } from '@/components/background-panel'
import { QueuePanel } from '@/components/queue-panel'
import { RequestCard } from '@/components/request-card'
import { ScreenPill, ScreenView } from '@/components/screen-view'
import { SessionActionsSheet } from '@/components/session-actions'
import { ToolSheet, type ToolTarget } from '@/components/tool-sheet'
import { VoiceCallScreen, VoiceStrip } from '@/components/voice-call'
import { WorkSheet, WorkStrip } from '@/components/work-sheet'
import { WorkingMark } from '@/components/working-mark'
import { IconButton, type IconName, Notice } from '@/components/ui'
import { parseMarkdown } from '@/core/markdown'
import { botChoices, chatMentionParts, withBotChoices } from '@/core/mentions'
import { $referencePlugins, loadReferencePlugins } from '@/store/commands'
import { answerSources } from '@/core/sources'
import { type Attachment, sentAttachment, type SentAttachment } from '@/core/attachments'
import { BOT_CHAT_TITLE } from '@/core/bots'
import { teachCommand } from '@/core/teach'
import { activeTrigger, applyCompletion } from '@/core/composer'
import { duration, headLines, statusWords } from '@/core/format'
import { modelLabel } from '@/core/models'
import { screenWork } from '@/core/screen'
import { finalAnswerKeys, hasToolDetail } from '@/core/tools'
import type { Delivery, TranscriptItem } from '@/core/transcript'
import { $attachments, addAttachments, type AttachSource, clipboardHasImage, removeAttachment } from '@/store/attachments'
import {
  $conversations,
  $shownSession,
  botOfChat,
  closeConversation,
  completeDraft,
  type Completions,
  type DraftEffect,
  liveSessionId,
  loadOlderHistory,
  resumeConversation,
  sendDraft,
  setConversationTitle,
  type SendMode,
  stopTurn
} from '@/store/chat'
import { markBotChatRead, $bots, loadBots } from '@/store/bots'
import { $previews } from '@/store/browser'
import { unwatchBackground, watchBackground } from '@/store/background'
import { $linkState } from '@/store/link'
import { type AgentRequest, answerInOwnWords } from '@/core/requests'
import { $requests, answerRequest } from '@/store/requests'
import { tap } from '@/native/haptics'
import { $screenHold } from '@/store/screen'
import { $sessions, markSessionRead } from '@/store/sessions'
import { $call, $callEnded, $callMuted, $callSession, $dictation, $dictationWords, $reading, dictate, endCall, readAloud, setCallMuted, startCall } from '@/store/voice'
import { lineOf, MONO, radius, space, TOUCH, type } from '@/theme/tokens'
import { useKeyboardOpen } from '@/theme/use-keyboard'
import { useTheme } from '@/theme/use-theme'

export default function Chat() {
  const params = useLocalSearchParams<{ id: string; title?: string; live?: string; profile?: string }>()

  return <ChatScreen params={params} />
}

interface ChatParams {
  id: string
  title?: string
  live?: string
  profile?: string
}

/**
 * One conversation. As a route it fills the screen and "back" leaves it. On
 * a wide screen it is `embedded` beside the list: it has no back button, and
 * leaving it or going to another chat is the caller's work.
 */
export function ChatScreen({ params, embedded }: { params: ChatParams; embedded?: { onClose: () => void; onOpen: (id: string, profile?: string) => void } }) {
  const t = useTheme()
  const leave = embedded ? embedded.onClose : () => router.back()
  // The route carries the stored id. `live=1` means the conversation was just
  // created and is in the store already. When it is not there (the app
  // started again on this route), the stored id opens it like any other.
  const [sessionId, setSessionId] = useState<string | null>(() => (params.live ? liveSessionId(params.id) : null))
  const [failure, setFailure] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sheet, setSheet] = useState<'model' | 'commands' | null>(null)
  const [modelQuery, setModelQuery] = useState('')
  const [acting, setActing] = useState(false)
  const [tool, setTool] = useState<ToolTarget | null>(null)
  // Only whether a call is open: the words and the phase of a call must not draw this whole screen again.
  const call = useStore($callSession)
  const callMuted = useStore($callMuted)
  const dictation = useStore($dictation)

  // A call has no view outside this screen. It must not keep the microphone open after the user leaves.
  useEffect(
    () => () => {
      if (sessionId && $call.get()?.sessionId === sessionId) {
        endCall()
      }
    },
    [sessionId]
  )

  const say = (problem: unknown) => Alert.alert('Voice is not available', problem instanceof Error ? problem.message : String(problem))
  const callEnded = useStore($callEnded)

  // A call that ended by itself says why, once.
  useEffect(() => {
    if (callEnded) {
      $callEnded.set(null)
      Alert.alert('Live voice ended', callEnded)
    }
  }, [callEnded])

  // The words go into the field, after what is there. The user reads them and sends: a wrong word costs nothing.
  const speakDraft = () => {
    dictate()
      .then(words => words && setDraft(current => (current.trim() ? `${current.trimEnd()} ${words}` : words)))
      .catch(say)
  }
  const previewUrl = useStore($previews)[sessionId ?? '']?.url
  // The agent opened a page for the user: show it. The user can put it away; a new address shows again.
  const [putAway, setPutAway] = useState<string | null>(null)
  const previewOpen = Boolean(previewUrl) && putAway !== previewUrl
  // The list follows new text only while the user is at the end. A user who scrolled up is reading.
  const [awayFromEnd, setAwayFromEnd] = useState(false)
  const sessions = useStore($sessions)
  const insets = useSafeAreaInsets()
  const keyboardOpen = useKeyboardOpen()
  const { height: windowHeight } = useWindowDimensions()
  const linkState = useStore($linkState)
  const conversation = useStore($conversations)[sessionId ?? '']
  const requests = useStore($requests).filter(r => r.sessionId === sessionId)
  const list = useRef<FlatList<TranscriptItem>>(null)

  const opened = Boolean(conversation)

  // The commands this chat left running are read while the chat is on screen, and only then.
  useEffect(() => {
    if (!sessionId || linkState !== 'open') {
      return
    }

    watchBackground(sessionId)

    return () => unwatchBackground(sessionId)
  }, [sessionId, linkState])

  useFocusEffect(
    useCallback(() => {
      $shownSession.set(sessionId ?? null)

      return () => $shownSession.set(null)
    }, [sessionId])
  )

  // The user reads this chat while it is on screen: read when it opens, and read up to the moment the user leaves.
  // What a bot writes after that is unread in the lists.
  useFocusEffect(
    useCallback(() => {
      const read = () => {
        void markSessionRead(params.id, params.profile)
        void markBotChatRead(params.id)
      }

      read()

      return read
    }, [params.id, params.profile])
  )

  useEffect(() => {
    if (opened || linkState !== 'open') {
      return
    }

    let cancelled = false

    resumeConversation(params.id, params.title, params.profile)
      .then(id => !cancelled && setSessionId(id))
      .catch(error => !cancelled && setFailure(error instanceof Error ? error.message : String(error)))

    return () => {
      cancelled = true
    }
  }, [opened, linkState, params.id, params.title, params.profile])

  // The socket dropped while this chat was open: the events of that time are
  // lost, and a turn that ended in it would show as running for ever. Open
  // the conversation again from the host when the link is back.
  const dropped = useRef(false)

  useEffect(() => {
    if (linkState !== 'open') {
      dropped.current = dropped.current || opened

      return
    }

    if (!dropped.current || !sessionId) {
      return
    }

    dropped.current = false

    let cancelled = false

    resumeConversation(params.id, params.title, params.profile)
      .then(id => (cancelled ? closeConversation(id) : setSessionId(id)))
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [linkState, opened, sessionId, params.id, params.title, params.profile])

  // The rows of a closed chat must not stay in memory.
  useEffect(() => () => void (sessionId && closeConversation(sessionId)), [sessionId])

  const transcript = conversation?.transcript
  const running = transcript?.running ?? false
  // The agent used the host's screen or a browser in this chat, or the user still holds the screen: offer the view.
  const screen = useMemo(() => screenWork(transcript?.items ?? []), [transcript?.items])
  const holdsScreen = useStore($screenHold) !== null
  const [watching, setWatching] = useState(false)
  const [workOpen, setWorkOpen] = useState(false)
  // The bot this chat belongs to, when it is a chat of a bot.
  const bots = useStore($bots)
  const bot = bots?.find(known => known.name === params.profile && !known.isDefault)
  // The bot of this chat: every other bot can be named in a message ("@qa").
  const self = botOfChat(params.profile)
  const plugins = useStore($referencePlugins) ?? []

  // A message can refer to a thing of a plugin ("@issue:12"): the host says which plugins take one.
  useEffect(() => {
    if (sessionId) {
      void loadReferencePlugins(sessionId)
    }
  }, [sessionId])

  // A chat opened from a notification can come before the Bots list was read.
  useEffect(() => {
    if (linkState === 'open' && !$bots.get()) {
      void loadBots().catch(() => undefined)
    }
  }, [linkState])
  const [botOpen, setBotOpen] = useState(false)
  // The one long conversation of the bot. The host finds it by its title, so the phone must not rename or remove it.
  // "Bot Chat" is the name the host gives the chat of every bot, the main bot too: a person reads the name of the bot.
  const titled = conversation?.title === BOT_CHAT_TITLE ? bots?.find(known => (params.profile ? known.name === params.profile : known.isDefault)) : undefined
  const botChat = bot && !conversation?.title ? bot : (titled ?? null)
  // The strip is for what happens now: the agent works on the screen, or the user holds it. The user can put
  // it away; the chat's menu opens the view at any time. New screen work shows the strip again.
  const [hiddenAt, setHiddenAt] = useState<number | null>(null)
  const rowCount = transcript?.items.length ?? 0
  const stripHidden = hiddenAt !== null && !(screen.running && rowCount > hiddenAt)
  const finals = useMemo(() => finalAnswerKeys(transcript?.items ?? [], running), [transcript?.items, running])
  // The list is inverted: the newest row is its first row. It opens at the newest message with
  // only the rows on screen drawn. A list in reading order drew every row of a long chat to get there.
  const newestFirst = useMemo(() => [...(transcript?.items ?? [])].reverse(), [transcript?.items])

  // Read the position only after the user moved the list. The list also moves while its rows
  // are measured, and that must not count as "the user scrolled up".
  const onUserScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    // In an inverted list the newest message is at offset 0.
    const away = event.nativeEvent.contentOffset.y > END_SLACK

    setAwayFromEnd(away)
  }

  const toEnd = () => {
    setAwayFromEnd(false)
    list.current?.scrollToOffset({ offset: 0, animated: true })
  }
  const attachments = useStore($attachments)[sessionId ?? '']
  const staged = attachments ?? NO_ATTACHMENTS
  const [adding, setAdding] = useState(false)
  const [teaching, setTeaching] = useState(false)
  const [viewing, setViewing] = useState<ViewerTarget | null>(null)
  const [canPaste, setCanPaste] = useState(false)

  // The clipboard can change while the app is in the background, so ask each time the list opens.
  useEffect(() => {
    if (adding) {
      void clipboardHasImage().then(setCanPaste)
    }
  }, [adding])
  const hasContent = draft.trim().length > 0 || staged.some(item => item.state === 'ready')
  // An upload still running would miss the message it was picked for.
  const canSend = Boolean(sessionId) && linkState === 'open' && hasContent && !staged.some(item => item.state === 'uploading')

  const trigger = useMemo(() => activeTrigger(draft), [draft])
  const [completions, setCompletions] = useState<Completions | null>(null)

  // Ask for completions a moment after the last keystroke, and drop an answer
  // that arrives after the draft has moved on.
  useEffect(() => {
    if (!sessionId || !trigger) {
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      void completeDraft(sessionId, trigger).then(result => !cancelled && setCompletions(result))
    }, 120)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sessionId, trigger])

  // The bots come from the list the phone has, so they show at once and before the files of the host.
  const shownCompletions = trigger
    ? (trigger.kind === 'path' ? withBotChoices(botChoices(bots ?? [], trigger.word, self), completions?.items ?? [], bots ?? []) : (completions?.items ?? [])).slice(0, 8)
    : []

  const apply = (effect: DraftEffect) => {
    switch (effect.kind) {
      case 'prefill':
        return setDraft(effect.text)

      case 'open':
        // Same screen, other conversation. The route follows, so a reload opens the right one.
        setSessionId(effect.sessionId)

        return router.setParams({ id: effect.storedId, live: '1', title: '' })

      case 'sheet':
        setModelQuery(effect.query ?? '')

        return setSheet(effect.sheet)

      case 'sessions':
        return leave()
    }
  }

  const send = (mode: SendMode = 'queue') => {
    if (!sessionId || !canSend) {
      return
    }

    const text = draft
    const form = waitingForm(requests)

    // The agent waits on a form: what the user types in the message field is the answer to it. A
    // message that waited for the turn would never go, because the turn waits for the form.
    if (form && text.trim() && !staged.length && !text.trimStart().startsWith('/')) {
      setDraft('')
      setCompletions(null)
      tap()

      return answerRequest(form.id, { kind: 'clarify', answers: answerInOwnWords(form.questions, text) })
    }

    setDraft('')
    setCompletions(null)
    // The user's own message is the newest row. Show it, wherever the list was.
    setAwayFromEnd(false)
    list.current?.scrollToOffset({ offset: 0, animated: false })
    tap()
    void sendDraft(sessionId, text, mode).then(apply)
  }

  // A card in an answer sends a line for the user: "Send it." under a draft.
  const sayToAgent = useCallback(
    (text: string) => {
      if (sessionId) {
        setAwayFromEnd(false)
        void sendDraft(sessionId, text, 'queue')
      }
    },
    [sessionId]
  )

  // During a turn a plain message can wait for the turn (send) or join it (steer).
  const canSteer = running && canSend && !staged.length && !draft.trimStart().startsWith('/')

  // The bot a lesson is for: the bot of this chat, or the main bot.
  const teachName = (bots?.find(known => (params.profile ? known.name === params.profile : known.isDefault))?.title ?? 'this bot').trim()

  const teach = (request: string) => {
    setTeaching(false)

    if (sessionId) {
      tap()
      void sendDraft(sessionId, teachCommand(request)).then(apply, error => Alert.alert('Could not start the lesson', error instanceof Error ? error.message : String(error)))
    }
  }

  const attach = (source: AttachSource) => {
    setAdding(false)

    if (sessionId) {
      addAttachments(sessionId, source).catch(error => Alert.alert('Could not add this', error instanceof Error ? error.message : String(error)))
    }
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        {embedded ? null : <IconButton icon="chevron-left" label="Back" onPress={leave} />}
        <Pressable
          accessibilityHint="Opens rename, pin, branch, export, archive and delete"
          accessibilityLabel="Conversation actions"
          accessibilityRole="button"
          disabled={!conversation}
          onPress={() => setActing(true)}
          style={styles.fill}
        >
          <View style={styles.titleRow}>
            {/* The chat of a bot: its picture and its name, not the name of its chat. */}
            {bot ? <BotAvatar bot={bot} size={30} t={t} /> : null}
            <Text numberOfLines={1} style={[type.label, styles.pillText, { color: t.ink }]}>
              {botChat ? botChat.title : conversation?.title || params.title || 'New chat'}
            </Text>
            {conversation ? <Feather color={t.muted} name="chevron-down" size={14} /> : null}
          </View>
        </Pressable>
        {conversation?.info.model ? (
          <Pressable
            accessibilityHint="Changes the model and the reasoning level"
            accessibilityLabel={`Model: ${modelLabel(conversation.info.model)}`}
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => {
              setModelQuery('')
              setSheet('model')
            }}
            style={[styles.pill, { backgroundColor: t.soft }]}
          >
            <Text numberOfLines={1} style={[type.small, styles.pillText, { color: t.ink }]}>
              {modelLabel(conversation.info.model)}
            </Text>
            <Feather color={t.muted} name="chevron-down" size={14} />
          </Pressable>
        ) : null}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        {failure ? (
          <Notice detail={failure} icon="alert-triangle" title="Could not open this conversation" />
        ) : !transcript ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        ) : (
          <View style={styles.fill}>
            <SayToAgent.Provider value={sayToAgent}>
            <FlatList
              ListEmptyComponent={<Notice icon="message-circle" title="Ask, explore, or make something" />}
              // The list is upside down: its header is under the newest message. That is where the answer will come.
              ListHeaderComponent={running ? <Working status={transcript?.status ?? null} /> : null}
              contentContainerStyle={styles.transcript}
              data={newestFirst}
              initialNumToRender={12}
              inverted={newestFirst.length > 0}
              keyExtractor={item => item.key}
              keyboardDismissMode="interactive"
              // A user who reads older rows stays there while the answer grows under them.
              maintainVisibleContentPosition={awayFromEnd ? { minIndexForVisible: 0 } : undefined}
              // The list is upside down: its footer is above the oldest row on screen.
              ListFooterComponent={conversation?.history?.loading ? <ActivityIndicator color={t.muted} style={styles.older} /> : null}
              maxToRenderPerBatch={8}
              // The end of an upside-down list is its oldest row: read the page before it.
              onEndReached={() => sessionId && void loadOlderHistory(sessionId)}
              onEndReachedThreshold={1.5}
              onMomentumScrollEnd={onUserScroll}
              onScrollEndDrag={onUserScroll}
              ref={list}
              renderItem={({ item }) => <Row final={finals.has(item.key)} item={item} onOpen={setViewing} onTool={setTool} />}
              windowSize={7}
            />
            </SayToAgent.Provider>
            {awayFromEnd ? (
              <View style={styles.toEnd}>
                <IconButton icon="arrow-down" label="Go to the newest message" onPress={toEnd} />
              </View>
            ) : null}
          </View>
        )}

        {requests.length ? (
          // A long form is taller than the space over the keyboard: it scrolls in its own space, and a drag puts the keyboard away.
          <ScrollView
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            style={[styles.requests, { maxHeight: windowHeight * (keyboardOpen ? 0.3 : 0.6) }]}
          >
            {requests.map(request => (
              <View key={request.id} style={styles.request}>
                <RequestCard onAnswer={answer => answerRequest(request.id, answer)} request={request} />
              </View>
            ))}
          </ScrollView>
        ) : null}

        {sessionId ? <BackgroundPanel sessionId={sessionId} /> : null}
        {sessionId ? <QueuePanel onEdit={text => setDraft(current => (current.trim() ? `${current.trimEnd()}\n${text}` : text))} sessionId={sessionId} /> : null}
        {sessionId ? <WorkStrip sessionId={sessionId} storedId={conversation?.storedId} /> : null}
        {sessionId ? <VoiceStrip sessionId={sessionId} /> : null}
        {dictation === 'off' ? null : <DictationLine />}
        {sessionId ? <PreviewPill onOpen={() => setPutAway(null)} sessionId={sessionId} /> : null}
        {sessionId && (screen.running || holdsScreen) && !stripHidden ? (
          <ScreenPill onHide={() => setHiddenAt(rowCount)} onOpen={() => setWatching(true)} working={screen.running} />
        ) : null}

        {shownCompletions.length ? (
          <View style={[styles.completions, { backgroundColor: t.paper, borderColor: t.line }]}>
            {shownCompletions.map((item, index) => (
              <Pressable
                accessibilityRole="button"
                key={`${item.text}:${index}`}
                onPress={() => trigger && setDraft(applyCompletion(draft, trigger, item.text, completions?.replaceFrom))}
                style={({ pressed }) => [
                  styles.completion,
                  index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth },
                  pressed && { backgroundColor: t.soft }
                ]}
              >
                {'bot' in item && bots?.find(known => known.name === item.bot) ? <BotAvatar bot={bots.find(known => known.name === item.bot)!} size={26} t={t} /> : null}
                <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                  {item.display || item.text}
                </Text>
                {item.meta ? (
                  <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
                    {item.meta}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {adding ? (
          <View style={[styles.completions, { backgroundColor: t.paper, borderColor: t.line }]}>
            {ATTACH_SOURCES.filter(source => source.id !== 'clipboard' || canPaste).map((source, index) => (
              <Pressable
                accessibilityRole="button"
                key={source.id}
                onPress={() => attach(source.id)}
                style={({ pressed }) => [
                  styles.completion,
                  index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth },
                  pressed && { backgroundColor: t.soft }
                ]}
              >
                <Feather color={t.muted} name={source.icon} size={18} />
                <Text style={[type.label, { color: t.ink }]}>{source.label}</Text>
              </Pressable>
            ))}
            <Text style={[type.small, styles.limit, { color: t.muted, borderTopColor: t.line }]}>
              Files up to 100 MB.
            </Text>
            {/* Not a thing to attach: its own row under the line, in the list the user opens to give the bot something. */}
            <Pressable
              accessibilityHint="The bot writes the task down as a skill"
              accessibilityRole="button"
              onPress={() => {
                setAdding(false)
                setTeaching(true)
              }}
              style={({ pressed }) => [styles.completion, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
            >
              <Feather color={t.accent} name="book-open" size={18} />
              <Text style={[type.label, { color: t.ink }]}>Teach {teachName} a task</Text>
            </Pressable>
          </View>
        ) : null}

        <View
          style={[
            styles.composer,
            { backgroundColor: t.paper, borderColor: t.line },
            // The keyboard covers the home indicator. Without it the composer sits just above the indicator.
            !keyboardOpen && { marginBottom: Math.max(insets.bottom - 10, space.md) }
          ]}
        >
          {staged.length ? (
            <ScrollView contentContainerStyle={styles.chips} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>
              {staged.map(item => (
                <StagedAttachment
                  item={item}
                  key={item.id}
                  onOpen={() => setViewing({ items: staged.map(sentAttachment), index: staged.indexOf(item) })}
                  onRemove={() => sessionId && removeAttachment(sessionId, item.id)}
                />
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.composerRow}>
            <IconButton
              disabled={!sessionId || linkState !== 'open'}
              icon={adding ? 'x' : 'plus'}
              label={adding ? 'Close the attachment list' : 'Add a photo or a file'}
              onPress={() => setAdding(value => !value)}
            />
            <TextInput
              accessibilityLabel="Message"
              autoCapitalize={draft.startsWith('/') || draft.startsWith('@') ? 'none' : 'sentences'}
              multiline
              onChangeText={setDraft}
              placeholder={running ? 'Queue or steer' : 'Message, / or @'}
              placeholderTextColor={t.muted}
              // An empty field is one line high. iOS keeps the height of the text that was sent until the next key.
              style={[styles.input, type.body, { color: t.ink }, !draft && styles.inputEmpty]}
            >
              <MentionText parts={chatMentionParts(draft, bots ?? [], self, plugins)} typed />
            </TextInput>
            {canSteer ? (
              <Pressable
                accessibilityHint="The agent reads the message after its current step, in this turn"
                accessibilityLabel="Steer"
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => send('steer')}
                style={({ pressed }) => [styles.steer, { backgroundColor: t.soft }, pressed && styles.dim]}
              >
                <Text style={[type.label, { color: t.ink }]}>Steer</Text>
              </Pressable>
            ) : null}
            {!hasContent && sessionId && linkState === 'open' ? (
              <>
                {call ? (
                  // Live voice has the microphone: the same button turns it off and on.
                  <IconButton icon={callMuted ? 'mic-off' : 'mic'} label={callMuted ? 'Turn the microphone on' : 'Mute'} onPress={() => setCallMuted(!callMuted)} />
                ) : (
                  <IconButton
                    icon={DICTATION_BUTTON[dictation].icon}
                    label={DICTATION_BUTTON[dictation].label}
                    onPress={speakDraft}
                  />
                )}
                {call ? null : <IconButton icon="waveform" label="Start Live voice" onPress={() => startCall(sessionId).catch(say)} />}
              </>
            ) : null}
            {running && !hasContent ? (
              <IconButton icon="square" label="Stop" onPress={() => sessionId && void stopTurn(sessionId)} />
            ) : !hasContent && sessionId && linkState === 'open' ? null : (
              <IconButton
                disabled={!canSend}
                filled
                icon="arrow-up"
                label={running ? 'Queue for the next turn' : 'Send'}
                onPress={() => send()}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      {sessionId ? (
        <>
          <PreviewPane onClose={() => setPutAway(previewUrl ?? null)} open={previewOpen} sessionId={sessionId} />
          <ModelSheet
            initialQuery={modelQuery}
            // A new search text is a new sheet: the field starts from it.
            key={modelQuery}
            onClose={() => setSheet(null)}
            reasoning={conversation?.info.reasoning_effort}
            sessionId={sessionId}
            visible={sheet === 'model'}
          />
          <VoiceCallScreen items={transcript?.items ?? NO_ITEMS} sessionId={sessionId} title={botChat?.title ?? conversation?.title ?? ''} />
          <AttachmentViewer onClose={() => setViewing(null)} target={viewing} />
          {teaching ? <TeachSheet bot={teachName} hasWork={(transcript?.items.length ?? 0) > 0} onClose={() => setTeaching(false)} onTeach={teach} /> : null}
          <ToolSheet onClose={() => setTool(null)} storedId={conversation?.storedId} tool={tool} />
          {sessionId ? <ScreenView onClose={() => setWatching(false)} sessionId={sessionId} storedId={params.id} visible={watching} /> : null}
      {bot && botOpen ? <BotSheet bot={bot} onClose={() => setBotOpen(false)} /> : null}
      {sessionId && workOpen ? <WorkSheet onClose={() => setWorkOpen(false)} sessionId={sessionId} storedId={conversation?.storedId} /> : null}
      <SessionActionsSheet
            // The long conversation of a bot can be exported and branched. It cannot be renamed, archived or deleted from here.
            only={botChat ? ['branch', 'export-text', 'export'] : undefined}
            shownTitle={botChat?.title}
            extra={[
              ...(bot ? [{ icon: 'user' as const, label: `Profile and settings of ${bot.title}`, onPress: () => setBotOpen(true) }] : []),
              { icon: 'list', label: 'Plan and helpers', onPress: () => setWorkOpen(true) },
              { icon: 'monitor', label: holdsScreen ? 'Screen: you have it' : 'Screen of the host', onPress: () => setWatching(true) }
            ]}
            onBranched={storedId => (embedded ? embedded.onOpen(storedId, params.profile) : router.replace({ pathname: '/chat/[id]', params: { id: storedId, ...(params.profile ? { profile: params.profile } : {}) } }))}
            onClose={() => setActing(false)}
            onRemoved={leave}
            onRenamed={title => setConversationTitle(sessionId, title)}
            // The list row knows the flags (pinned, archived). A chat not in the list yet still has its id and title.
            row={
              acting && conversation
                ? { ...(sessions.find(row => row.id === conversation.storedId) ?? { id: conversation.storedId, profile: params.profile }), title: conversation.title }
                : null
            }
          />
          <CommandsSheet
            onClose={() => setSheet(null)}
            onPick={command => {
              setDraft(`${command} `)
              setSheet(null)
            }}
            sessionId={sessionId}
            visible={sheet === 'commands'}
          />
        </>
      ) : null}
    </SafeAreaView>
  )
}

const NO_ATTACHMENTS: Attachment[] = []
const NO_ITEMS: TranscriptItem[] = []
// Closer to the end than this still counts as the end: a streamed line must not show the button.
const END_SLACK = 160

const ATTACH_SOURCES: { id: AttachSource; label: string; icon: IconName }[] = [
  { id: 'photos', label: 'Photo library', icon: 'image' },
  { id: 'camera', label: 'Take a photo', icon: 'camera' },
  { id: 'files', label: 'Choose a file', icon: 'file' },
  { id: 'clipboard', label: 'Paste a picture', icon: 'clipboard' }
]

const DELIVERY_LABEL: Record<Delivery, string> = {
  queued: 'Queued. Runs after this turn.',
  steered: 'Steered into the running turn.',
  redirected: 'Redirected the turn.',
  dropped: 'Not sent. The turn was stopped first.'
}

/** The sign of a running turn, under the last message: the animated mark and what the agent does now. */
function Working({ status }: { status: string | null }) {
  const t = useTheme()

  return (
    <View accessibilityLabel={status ? statusWords(status) : 'Working'} accessibilityRole="progressbar" style={styles.working}>
      <WorkingMark />
      <Text numberOfLines={1} style={[type.small, styles.statusText, { color: t.muted }]}>
        {status ? statusWords(status) : 'Working…'}
      </Text>
    </View>
  )
}

/** A message of the user. A long press copies its words. */
function UserBubble({ text, attached, waiting, teach, onOpen }: { text: string; attached?: SentAttachment[]; waiting: boolean; /** The text is what the user asked the bot to learn. */ teach?: boolean; onOpen: (target: ViewerTarget) => void }) {
  const t = useTheme()
  const bots = useStore($bots)
  const plugins = useStore($referencePlugins)
  const self = botOfChat(useLocalSearchParams<{ profile?: string }>().profile)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = setTimeout(() => setCopied(false), 1500)

    return () => clearTimeout(timer)
  }, [copied])

  return (
    <>
      <Pressable
        accessibilityHint="Hold to copy the message"
        delayLongPress={350}
        disabled={!text}
        onLongPress={() => {
          tap()
          void Clipboard.setStringAsync(text).then(() => setCopied(true))
        }}
        style={[styles.bubble, { backgroundColor: t.soft }, waiting && styles.waiting]}
      >
        {attached?.length ? <SentAttachments items={attached} onOpen={index => onOpen({ items: attached, index })} /> : null}
        {teach ? (
          <View style={styles.teach}>
            <Feather color={t.accent} name="book-open" size={13} />
            <Text style={[type.small, { color: t.accent, fontWeight: '700' }]}>Teach</Text>
          </View>
        ) : null}
        {text ? (
          <Text style={[type.body, { color: t.ink }]}>
            <MentionText parts={chatMentionParts(text, bots ?? [], self, plugins ?? [])} />
          </Text>
        ) : null}
      </Pressable>
      {copied ? <Text style={[type.small, { color: t.muted }]}>Copied</Text> : null}
    </>
  )
}

interface RowProps {
  item: TranscriptItem
  /** This row is the answer that ends a turn. Copy and share sit under it. */
  final: boolean
  onOpen: (target: ViewerTarget) => void
  onTool: (tool: ToolTarget) => void
}

function Row({ item, final, onOpen, onTool }: RowProps) {
  const t = useTheme()
  const bots = useStore($bots)
  const self = botOfChat(useLocalSearchParams<{ profile?: string }>().profile)
  // The bots an answer names. One function while the bots stay the same: an answer is drawn again only when its text changes.
  const named = useCallback((text: string) => chatMentionParts(text, bots ?? [], self, null), [bots, self])

  switch (item.kind) {
    case 'user':
      return (
        <View style={styles.sent}>
          <UserBubble attached={item.attached} onOpen={onOpen} teach={item.teach} text={item.text} waiting={item.delivery === 'queued' || item.delivery === 'dropped'} />
          {item.delivery ? <Text style={[type.small, { color: t.muted }]}>{DELIVERY_LABEL[item.delivery]}</Text> : null}
        </View>
      )

    case 'arrival':
      return <ArrivalRow arrival={item.arrival} mentions={named} />

    case 'assistant':
      return final ? (
        <View style={styles.answer}>
          <Answer mentions={named} onOpen={onOpen} streaming={item.streaming} text={item.text} />
          <AnswerActions id={item.key} text={item.text} />
        </View>
      ) : (
        <Answer mentions={named} onOpen={onOpen} streaming={item.streaming} text={item.text} />
      )

    case 'thinking':
      return <Thinking streaming={item.streaming} text={item.text} />

    case 'tool': {
      const opens = hasToolDetail(item)
      // The capture of the screen that the tool took: what the agent saw.
      const capture: SentAttachment[] = item.picture ? [{ name: item.picture.split(/[\\/]/).pop() ?? 'capture', kind: 'image', path: item.picture }] : []

      return (
        <View style={styles.toolBlock}>
        <Pressable
          accessibilityHint={opens ? 'Opens the input and the output' : undefined}
          accessibilityLabel={`${item.name} ${item.detail}`.trim()}
          accessibilityRole="button"
          disabled={!opens && item.state !== 'done'}
          hitSlop={6}
          onPress={() => onTool(item)}
          style={({ pressed }) => [styles.tool, pressed && styles.dim]}
        >
          {item.state === 'running' ? (
            <ActivityIndicator color={t.muted} size="small" />
          ) : (
            <Feather color={t.green} name="check" size={15} />
          )}
          <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
            <Text style={{ color: t.ink, fontWeight: '600' }}>{item.name}</Text>
            {item.detail ? `  ${item.detail}` : ''}
          </Text>
          {item.durationS !== undefined ? (
            <Text style={[type.small, { color: t.muted }]}>{duration(item.durationS)}</Text>
          ) : null}
          {opens || item.state === 'done' ? <Feather color={t.muted} name="chevron-right" size={15} /> : null}
        </Pressable>
          {capture.length ? <SentAttachments items={capture} onOpen={index => onOpen({ items: capture, index })} /> : null}
        </View>
      )
    }

    case 'output':
      return <CommandOutput command={item.command} text={item.text} />

    case 'notice':
      return (
        <Text style={[type.small, { color: item.tone === 'error' ? t.red : t.muted, textAlign: 'center' }]}>
          {item.text}
        </Text>
      )
  }
}

/** The words of a dictation while the user talks. They go into the message field when the user stops. */
/** The form the agent waits on in this chat, when a form is the one thing it waits on. */
function waitingForm(requests: readonly AgentRequest[]): Extract<AgentRequest, { kind: 'clarify' }> | null {
  const only = requests.length === 1 ? requests[0] : null

  return only?.kind === 'clarify' ? only : null
}

const DICTATION_BUTTON = {
  off: { icon: 'mic', label: 'Dictate a message' },
  starting: { icon: 'x', label: 'Cancel dictation' },
  listening: { icon: 'check', label: 'Done talking' },
  hearing: { icon: 'check', label: 'Done talking' },
  transcribing: { icon: 'loader', label: 'Writing it down' }
} as const

const DICTATION_LINE = {
  off: '',
  starting: 'Opening the microphone…',
  listening: 'Listening. Talk now.',
  hearing: 'Hearing you…',
  transcribing: 'Writing it down…'
} as const

function DictationLine() {
  const t = useTheme()
  const words = useStore($dictationWords)
  const state = useStore($dictation)

  return (
    <View accessibilityLiveRegion="polite" style={[styles.dictation, { backgroundColor: t.greenBg }]}>
      <Feather color={t.green} name="mic" size={14} />
      <Text numberOfLines={3} style={[type.small, styles.dictationWords, { color: words ? t.ink : t.muted }]}>
        {words || DICTATION_LINE[state]}
      </Text>
    </View>
  )
}

/** Copy and share for an answer. Small and quiet: they are there when wanted, and not a toolbar. */
function AnswerActions({ id, text }: { id: string; text: string }) {
  const t = useTheme()
  const reading = useStore($reading) === id
  const [copied, setCopied] = useState(false)
  const sources = useMemo(() => answerSources(parseMarkdown(text)), [text])
  const [showSources, setShowSources] = useState(false)

  const copy = () => {
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <View style={styles.answerActions}>
      <Pressable accessibilityLabel={copied ? 'Copied' : 'Copy the answer'} accessibilityRole="button" hitSlop={10} onPress={copy} style={styles.tool}>
        <Feather color={copied ? t.green : t.muted} name={copied ? 'check' : 'copy'} size={15} />
        {copied ? <Text style={[type.small, { color: t.green }]}>Copied</Text> : null}
      </Pressable>
      <Pressable accessibilityLabel="Share the answer" accessibilityRole="button" hitSlop={10} onPress={() => void Share.share({ message: text }).catch(() => undefined)}>
        <Feather color={t.muted} name="share" size={15} />
      </Pressable>
      <Pressable
        accessibilityLabel={reading ? 'Stop reading' : 'Read the answer aloud'}
        accessibilityRole="button"
        hitSlop={10}
        onPress={() => void readAloud(id, text).catch(() => undefined)}
      >
        <Feather color={reading ? t.accent : t.muted} name={reading ? 'square' : 'volume-2'} size={15} />
      </Pressable>
      {sources.length ? <SourcesButton onPress={() => setShowSources(true)} sources={sources} /> : null}
      {showSources ? <SourcesSheet onClose={() => setShowSources(false)} sources={sources} /> : null}
    </View>
  )
}

const OUTPUT_PREVIEW_LINES = 12

/**
 * What a slash command printed. Commands format for an 80-column terminal, so
 * the text scrolls sideways instead of wrapping, and a long output starts cut.
 */
function CommandOutput({ command, text }: { command: string; text: string }) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const { head, hidden } = headLines(text, OUTPUT_PREVIEW_LINES)

  return (
    <View style={[styles.output, { backgroundColor: t.soft }]}>
      <Text style={[type.small, { color: t.muted, fontWeight: '700' }]}>{command}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[styles.outputText, { color: t.ink }]}>
          {open ? text.replace(/\s+$/, '') : head}
        </Text>
      </ScrollView>
      {hidden > 0 ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpen(value => !value)}>
          <Text style={[type.small, { color: t.accent, fontWeight: '700' }]}>
            {open ? 'Show less' : `Show ${hidden} more lines`}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** The model's reasoning. Closed by default: it is context, not the answer. */
function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  const t = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <View style={styles.thinking}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        onPress={() => setOpen(value => !value)}
        style={styles.tool}
      >
        <Feather color={t.muted} name={open ? 'chevron-down' : 'chevron-right'} size={15} />
        <Text style={[type.small, { color: t.muted, fontWeight: '600' }]}>{streaming ? 'Thinking…' : 'Thought'}</Text>
      </Pressable>
      {open ? <Markdown muted text={text} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  thinking: { gap: space.sm },
  answer: { gap: space.sm },
  dictation: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  dictationWords: { flex: 1 },
  answerActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: 24 },
  toEnd: { position: 'absolute', right: space.lg, bottom: space.sm },
  fill: { flex: 1 },
  older: { paddingVertical: space.lg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: 150,
    minHeight: 32,
    paddingHorizontal: space.md,
    borderRadius: radius.pill
  },
  pillText: { fontWeight: '600', flexShrink: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  working: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm },
  statusText: { flexShrink: 1 },
  transcript: { padding: space.lg, gap: space.lg, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  sent: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '88%', gap: space.xs },
  bubble: { padding: space.md, borderRadius: radius.lg, gap: space.sm },
  teach: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  chips: { gap: space.sm, paddingHorizontal: space.xs, paddingBottom: space.sm },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  waiting: { opacity: 0.6 },
  steer: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill },
  dim: { opacity: 0.55 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  toolBlock: { gap: space.sm, alignItems: 'flex-start' },
  requests: { flexGrow: 0, flexShrink: 0 },
  request: { paddingHorizontal: space.md, paddingBottom: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center' },
  completions: {
    marginHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  limit: { padding: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  completion: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md },
  output: { gap: space.xs, padding: space.md, borderRadius: radius.md },
  outputText: { fontFamily: MONO, fontSize: 12, lineHeight: lineOf(17) },
  composer: {
    margin: space.md,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth
  },
  inputEmpty: { height: TOUCH },
  input: { flex: 1, minHeight: TOUCH, maxHeight: 160, paddingHorizontal: space.sm, paddingTop: 10, paddingBottom: 10 }
})
