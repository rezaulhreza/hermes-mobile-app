import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
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
  View
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { AttachmentViewer, type ViewerTarget } from '@/components/attachment-viewer'
import { SentAttachments, StagedAttachment } from '@/components/attachments'
import { CommandsSheet } from '@/components/commands-sheet'
import { Markdown } from '@/components/markdown'
import { ModelSheet } from '@/components/model-sheet'
import { PreviewPane, PreviewPill } from '@/components/preview-pane'
import { RequestCard } from '@/components/request-card'
import { SessionActionsSheet } from '@/components/session-actions'
import { ToolSheet, type ToolTarget } from '@/components/tool-sheet'
import { VoiceCallScreen, VoiceStrip } from '@/components/voice-call'
import { WorkStrip } from '@/components/work-sheet'
import { IconButton, type IconName, Notice } from '@/components/ui'
import { type Attachment, sentAttachment } from '@/core/attachments'
import { activeTrigger, applyCompletion } from '@/core/composer'
import { duration, headLines } from '@/core/format'
import { modelLabel } from '@/core/models'
import { finalAnswerKeys, hasToolDetail } from '@/core/tools'
import type { Delivery, TranscriptItem } from '@/core/transcript'
import { $attachments, addAttachments, type AttachSource, clipboardHasImage, removeAttachment } from '@/store/attachments'
import {
  $conversations,
  completeDraft,
  type Completions,
  type DraftEffect,
  liveSessionId,
  resumeConversation,
  sendDraft,
  setConversationTitle,
  type SendMode,
  stopTurn
} from '@/store/chat'
import { $previews } from '@/store/browser'
import { $linkState } from '@/store/link'
import { $requests, answerRequest } from '@/store/requests'
import { $sessions } from '@/store/sessions'
import { $call, $callEnded, $dictation, $reading, dictate, endCall, readAloud, startCall } from '@/store/voice'
import { MONO, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export default function Chat() {
  const t = useTheme()
  const params = useLocalSearchParams<{ id: string; title?: string; live?: string }>()
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
  const call = useStore($call)
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
      Alert.alert('The call ended', callEnded)
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
  const atEnd = useRef(true)
  const [awayFromEnd, setAwayFromEnd] = useState(false)
  const sessions = useStore($sessions)
  const insets = useSafeAreaInsets()
  const keyboardOpen = useKeyboardOpen()
  const linkState = useStore($linkState)
  const conversation = useStore($conversations)[sessionId ?? '']
  const requests = useStore($requests).filter(r => r.sessionId === sessionId)
  const list = useRef<FlatList<TranscriptItem>>(null)

  const opened = Boolean(conversation)

  useEffect(() => {
    if (opened || linkState !== 'open') {
      return
    }

    let cancelled = false

    resumeConversation(params.id, params.title)
      .then(id => !cancelled && setSessionId(id))
      .catch(error => !cancelled && setFailure(error instanceof Error ? error.message : String(error)))

    return () => {
      cancelled = true
    }
  }, [opened, linkState, params.id, params.title])

  const transcript = conversation?.transcript
  const running = transcript?.running ?? false
  const finals = useMemo(() => finalAnswerKeys(transcript?.items ?? [], running), [transcript?.items, running])

  // Read the position only after the user moved the list. The list also moves while its rows
  // are measured, and that must not count as "the user scrolled up".
  const onUserScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
    const away = contentSize.height - layoutMeasurement.height - contentOffset.y > END_SLACK

    atEnd.current = !away
    setAwayFromEnd(away)
  }

  const toEnd = () => {
    atEnd.current = true
    setAwayFromEnd(false)
    list.current?.scrollToEnd({ animated: true })
  }
  const attachments = useStore($attachments)[sessionId ?? '']
  const staged = attachments ?? NO_ATTACHMENTS
  const [adding, setAdding] = useState(false)
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

  const shownCompletions = trigger ? (completions?.items ?? []).slice(0, 8) : []

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
        return router.back()
    }
  }

  const send = (mode: SendMode = 'queue') => {
    if (!sessionId || !canSend) {
      return
    }

    const text = draft

    setDraft('')
    setCompletions(null)
    // The user's own message is the newest row. Show it, wherever the list was.
    atEnd.current = true
    setAwayFromEnd(false)
    void sendDraft(sessionId, text, mode).then(apply)
  }

  // During a turn a plain message can wait for the turn (send) or join it (steer).
  const canSteer = running && canSend && !staged.length && !draft.trimStart().startsWith('/')

  const attach = (source: AttachSource) => {
    setAdding(false)

    if (sessionId) {
      addAttachments(sessionId, source).catch(error => Alert.alert('Could not add this', error instanceof Error ? error.message : String(error)))
    }
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Pressable
          accessibilityHint="Opens rename, pin, branch, export, archive and delete"
          accessibilityLabel="Conversation actions"
          accessibilityRole="button"
          disabled={!conversation}
          onPress={() => setActing(true)}
          style={styles.fill}
        >
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[type.label, styles.pillText, { color: t.ink }]}>
              {conversation?.title || params.title || 'New chat'}
            </Text>
            {conversation ? <Feather color={t.muted} name="chevron-down" size={14} /> : null}
          </View>
          <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
            {transcript?.status ?? (running ? 'Working…' : ' ')}
          </Text>
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
            <FlatList
              ListEmptyComponent={<Notice icon="message-circle" title="Ask, explore, or make something" />}
              contentContainerStyle={styles.transcript}
              data={transcript.items}
              keyExtractor={item => item.key}
              keyboardDismissMode="interactive"
              onContentSizeChange={() => atEnd.current && list.current?.scrollToEnd({ animated: false })}
              onMomentumScrollEnd={onUserScroll}
              onScrollEndDrag={onUserScroll}
              ref={list}
              renderItem={({ item }) => <Row final={finals.has(item.key)} item={item} onOpen={setViewing} onTool={setTool} />}
            />
            {awayFromEnd ? (
              <View style={styles.toEnd}>
                <IconButton icon="arrow-down" label="Go to the newest message" onPress={toEnd} />
              </View>
            ) : null}
          </View>
        )}

        {requests.map(request => (
          <View key={request.id} style={styles.request}>
            <RequestCard onAnswer={answer => answerRequest(request.id, answer)} request={request} />
          </View>
        ))}

        {sessionId ? <WorkStrip sessionId={sessionId} /> : null}
        {sessionId ? <VoiceStrip sessionId={sessionId} /> : null}
        {sessionId ? <PreviewPill onOpen={() => setPutAway(null)} sessionId={sessionId} /> : null}

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
              A file can be up to 12 MB. A large photo is made smaller before it is sent.
            </Text>
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
              value={draft}
            />
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
                <IconButton
                  icon={dictation === 'off' ? 'mic' : dictation === 'listening' ? 'check' : 'loader'}
                  label={dictation === 'off' ? 'Dictate a message' : dictation === 'listening' ? 'Done talking' : 'Writing it down'}
                  onPress={speakDraft}
                />
                {call ? null : <IconButton icon="phone" label="Start a voice call" onPress={() => startCall(sessionId).catch(say)} />}
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
          <VoiceCallScreen items={transcript?.items ?? NO_ITEMS} sessionId={sessionId} title={conversation?.title ?? ''} />
          <AttachmentViewer onClose={() => setViewing(null)} target={viewing} />
          <ToolSheet onClose={() => setTool(null)} storedId={conversation?.storedId} tool={tool} />
          <SessionActionsSheet
            onBranched={storedId => router.replace({ pathname: '/chat/[id]', params: { id: storedId } })}
            onClose={() => setActing(false)}
            onRemoved={() => router.back()}
            onRenamed={title => setConversationTitle(sessionId, title)}
            // The list row knows the flags (pinned, archived). A chat not in the list yet still has its id and title.
            row={
              acting && conversation
                ? { ...(sessions.find(row => row.id === conversation.storedId) ?? { id: conversation.storedId }), title: conversation.title }
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

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // iOS says "will", so the layout moves with the keyboard. Android only says "did".
    const [show, hide] = Platform.OS === 'ios' ? (['keyboardWillShow', 'keyboardWillHide'] as const) : (['keyboardDidShow', 'keyboardDidHide'] as const)
    const subscriptions = [Keyboard.addListener(show, () => setOpen(true)), Keyboard.addListener(hide, () => setOpen(false))]

    return () => subscriptions.forEach(subscription => subscription.remove())
  }, [])

  return open
}

const DELIVERY_LABEL: Record<Delivery, string> = {
  queued: 'Queued. Runs after this turn.',
  steered: 'Steered into the running turn.',
  redirected: 'Redirected the turn.',
  dropped: 'Not sent. The turn was stopped first.'
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

  switch (item.kind) {
    case 'user':
      return (
        <View style={styles.sent}>
          <View style={[styles.bubble, { backgroundColor: t.soft }, (item.delivery === 'queued' || item.delivery === 'dropped') && styles.waiting]}>
            {item.attached?.length ? <SentAttachments items={item.attached} onOpen={index => onOpen({ items: item.attached ?? [], index })} /> : null}
            {item.text ? (
              <Text selectable style={[type.body, { color: t.ink }]}>
                {item.text}
              </Text>
            ) : null}
          </View>
          {item.delivery ? <Text style={[type.small, { color: t.muted }]}>{DELIVERY_LABEL[item.delivery]}</Text> : null}
        </View>
      )

    case 'assistant':
      return final ? (
        <View style={styles.answer}>
          <Markdown text={item.text} />
          <AnswerActions id={item.key} text={item.text} />
        </View>
      ) : (
        <Markdown text={item.text} />
      )

    case 'thinking':
      return <Thinking streaming={item.streaming} text={item.text} />

    case 'tool': {
      const opens = hasToolDetail(item)

      return (
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

/** Copy and share for an answer. Small and quiet: they are there when wanted, and not a toolbar. */
function AnswerActions({ id, text }: { id: string; text: string }) {
  const t = useTheme()
  const reading = useStore($reading) === id
  const [copied, setCopied] = useState(false)

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
  answerActions: { flexDirection: 'row', alignItems: 'center', gap: space.lg, minHeight: 24 },
  toEnd: { position: 'absolute', right: space.lg, bottom: space.sm },
  fill: { flex: 1 },
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
  transcript: { padding: space.lg, gap: space.lg, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  sent: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '88%', gap: space.xs },
  bubble: { padding: space.md, borderRadius: radius.lg, gap: space.sm },
  chips: { gap: space.sm, paddingHorizontal: space.xs, paddingBottom: space.sm },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  waiting: { opacity: 0.6 },
  steer: { minHeight: TOUCH, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill },
  dim: { opacity: 0.55 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
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
  outputText: { fontFamily: MONO, fontSize: 12, lineHeight: 17 },
  composer: {
    margin: space.md,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth
  },
  inputEmpty: { height: TOUCH },
  input: { flex: 1, minHeight: TOUCH, maxHeight: 160, paddingHorizontal: space.sm, paddingTop: 10, paddingBottom: 10 }
})
