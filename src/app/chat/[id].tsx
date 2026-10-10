import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Markdown } from '@/components/markdown'
import { ModelSheet } from '@/components/model-sheet'
import { RequestCard } from '@/components/request-card'
import { IconButton, Notice } from '@/components/ui'
import { activeTrigger, applyCompletion } from '@/core/composer'
import { duration } from '@/core/format'
import { modelLabel } from '@/core/models'
import type { TranscriptItem } from '@/core/transcript'
import { $conversations, completeDraft, type Completions, resumeConversation, sendDraft, stopTurn } from '@/store/chat'
import { $linkState } from '@/store/link'
import { $requests, answerRequest } from '@/store/requests'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export default function Chat() {
  const t = useTheme()
  const params = useLocalSearchParams<{ id: string; title?: string; live?: string }>()
  // `live=1` means the id is already a live session (a chat just created).
  // Otherwise it is a stored id and the conversation must be resumed first.
  const [sessionId, setSessionId] = useState<string | null>(params.live ? params.id : null)
  const [failure, setFailure] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [pickingModel, setPickingModel] = useState(false)
  const linkState = useStore($linkState)
  const conversation = useStore($conversations)[sessionId ?? '']
  const requests = useStore($requests).filter(r => r.sessionId === sessionId)
  const list = useRef<FlatList<TranscriptItem>>(null)

  useEffect(() => {
    if (sessionId || linkState !== 'open') {
      return
    }

    let cancelled = false

    resumeConversation(params.id, params.title)
      .then(id => !cancelled && setSessionId(id))
      .catch(error => !cancelled && setFailure(error instanceof Error ? error.message : String(error)))

    return () => {
      cancelled = true
    }
  }, [sessionId, linkState, params.id, params.title])

  const transcript = conversation?.transcript
  const running = transcript?.running ?? false
  const canSend = Boolean(sessionId) && linkState === 'open' && draft.trim().length > 0

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

  const send = () => {
    if (!sessionId || !canSend) {
      return
    }

    const text = draft

    setDraft('')
    setCompletions(null)
    // A command can hand text back for the user to finish (a prefill).
    void sendDraft(sessionId, text).then(back => back && setDraft(back))
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {conversation?.title || params.title || 'New chat'}
          </Text>
          <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
            {transcript?.status ?? (running ? 'Working…' : ' ')}
          </Text>
        </View>
        {conversation?.info.model ? (
          <Pressable
            accessibilityHint="Changes the model and the reasoning level"
            accessibilityLabel={`Model: ${modelLabel(conversation.info.model)}`}
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => setPickingModel(true)}
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
          <FlatList
            ListEmptyComponent={<Notice icon="message-circle" title="Ask, explore, or make something" />}
            contentContainerStyle={styles.transcript}
            data={transcript.items}
            keyExtractor={item => item.key}
            keyboardDismissMode="interactive"
            onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
            ref={list}
            renderItem={({ item }) => <Row item={item} />}
          />
        )}

        {requests.map(request => (
          <View key={request.id} style={styles.request}>
            <RequestCard onAnswer={answer => answerRequest(request.id, answer)} request={request} />
          </View>
        ))}

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

        <View style={[styles.composer, { backgroundColor: t.paper, borderColor: t.line }]}>
          <TextInput
            accessibilityLabel="Message"
            autoCapitalize={draft.startsWith('/') || draft.startsWith('@') ? 'none' : 'sentences'}
            multiline
            onChangeText={setDraft}
            placeholder={running ? 'Add to the queue…' : 'Message Hermes, / for commands, @ for files'}
            placeholderTextColor={t.muted}
            style={[styles.input, type.body, { color: t.ink }]}
            value={draft}
          />
          {running && !draft.trim() ? (
            <IconButton icon="square" label="Stop" onPress={() => sessionId && void stopTurn(sessionId)} />
          ) : (
            <IconButton disabled={!canSend} filled icon="arrow-up" label="Send" onPress={send} />
          )}
        </View>
      </KeyboardAvoidingView>

      {sessionId ? (
        <ModelSheet
          onClose={() => setPickingModel(false)}
          reasoning={conversation?.info.reasoning_effort}
          sessionId={sessionId}
          visible={pickingModel}
        />
      ) : null}
    </SafeAreaView>
  )
}

function Row({ item }: { item: TranscriptItem }) {
  const t = useTheme()

  switch (item.kind) {
    case 'user':
      return (
        <View style={[styles.bubble, { backgroundColor: t.soft }]}>
          <Text selectable style={[type.body, { color: t.ink }]}>
            {item.text}
          </Text>
        </View>
      )

    case 'assistant':
      return (
        <Markdown text={item.text} />
      )

    case 'thinking':
      return <Thinking streaming={item.streaming} text={item.text} />

    case 'tool':
      return (
        <View style={styles.tool}>
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
        </View>
      )

    case 'output':
      return (
        <View style={[styles.output, { backgroundColor: t.soft }]}>
          <Text style={[type.small, { color: t.muted, fontWeight: '700' }]}>{item.command}</Text>
          <Text selectable style={[styles.outputText, { color: t.ink }]}>
            {item.text}
          </Text>
        </View>
      )

    case 'notice':
      return (
        <Text style={[type.small, { color: item.tone === 'error' ? t.red : t.muted, textAlign: 'center' }]}>
          {item.text}
        </Text>
      )
  }
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
  transcript: { padding: space.lg, gap: space.lg, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  bubble: { alignSelf: 'flex-end', maxWidth: '88%', padding: space.md, borderRadius: radius.lg },
  tool: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  request: { paddingHorizontal: space.md, paddingBottom: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center' },
  completions: {
    marginHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden'
  },
  completion: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md },
  output: { gap: space.xs, padding: space.md, borderRadius: radius.md },
  outputText: { fontFamily: 'Menlo', fontSize: 13, lineHeight: 19 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    margin: space.md,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth
  },
  input: { flex: 1, minHeight: TOUCH, maxHeight: 160, paddingHorizontal: space.sm, paddingTop: 10, paddingBottom: 10 }
})
