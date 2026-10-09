import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { RequestCard } from '@/components/request-card'
import { IconButton, Notice } from '@/components/ui'
import { duration } from '@/core/format'
import type { TranscriptItem } from '@/core/transcript'
import { $conversations, resumeConversation, sendMessage, stopTurn } from '@/store/chat'
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

  const send = () => {
    if (!sessionId || !canSend) {
      return
    }

    void sendMessage(sessionId, draft)
    setDraft('')
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
            {transcript?.status ?? (running ? 'Working…' : (conversation?.info.model ?? ''))}
          </Text>
        </View>
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

        <View style={[styles.composer, { backgroundColor: t.paper, borderColor: t.line }]}>
          <TextInput
            accessibilityLabel="Message"
            multiline
            onChangeText={setDraft}
            placeholder={running ? 'Add to the queue…' : 'Message Hermes'}
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
        <Text selectable style={[type.body, { color: t.ink }]}>
          {item.text}
          {item.streaming ? ' ▍' : ''}
        </Text>
      )

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

    case 'notice':
      return (
        <Text style={[type.small, { color: item.tone === 'error' ? t.red : t.muted, textAlign: 'center' }]}>
          {item.text}
        </Text>
      )
  }
}

const styles = StyleSheet.create({
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
  transcript: { padding: space.lg, gap: space.lg, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  bubble: { alignSelf: 'flex-end', maxWidth: '88%', padding: space.md, borderRadius: radius.lg },
  tool: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  request: { paddingHorizontal: space.md, paddingBottom: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center' },
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
