import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { answerForMessage, type SideTurn } from '@/core/side-chat'
import { tap } from '@/native/haptics'
import { $sideChat, askSide } from '@/store/side-chat'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Markdown } from './markdown'
import { IconButton } from './ui'

const NO_TURNS: SideTurn[] = []

/**
 * A side chat, as in the desktop app: a question to a side agent that reads
 * the conversation so far. The bot goes on with its turn, and nothing here
 * goes into the conversation until the user adds an answer to the message.
 */
export function SideChatSheet({ sessionId, profile, botName, onAddToMessage, onClose }: { sessionId: string; profile?: string; botName: string; onAddToMessage: (text: string) => void; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const turns = useStore($sideChat)[sessionId] ?? NO_TURNS
  const [text, setText] = useState('')
  const [copied, setCopied] = useState<number | null>(null)

  const send = () => {
    if (text.trim()) {
      tap()
      void askSide(sessionId, text, profile)
      setText('')
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <View style={styles.fill}>
            <Text style={[type.heading, { color: t.ink }]}>Side chat</Text>
            <Text style={[type.small, { color: t.muted }]}>{`${botName} keeps working. This chat reads the conversation, but stays out of it.`}</Text>
          </View>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardDismissMode="interactive">
          {turns.length ? null : <Text style={[type.body, { color: t.muted }]}>Ask a question about this conversation. The answer shows here only.</Text>}
          {turns.map(turn => (
            <View key={turn.key} style={styles.turn}>
              <View style={[styles.question, { backgroundColor: t.ink }]}>
                <Text style={[type.body, { color: t.bg }]}>{turn.question}</Text>
              </View>
              {turn.failure ? (
                <Text style={[type.small, { color: t.red }]}>{turn.failure}</Text>
              ) : turn.answer === null ? (
                <ActivityIndicator accessibilityLabel="The side agent is working" color={t.muted} style={styles.waiting} />
              ) : (
                <>
                  <Markdown text={turn.answer} />
                  <View style={styles.actions}>
                    <Pressable
                      accessibilityHint="Puts the question and the answer in the message field of the conversation"
                      accessibilityRole="button"
                      onPress={() => (tap(), onAddToMessage(answerForMessage(turn)), onClose())}
                      style={({ pressed }) => [styles.action, { borderColor: t.line, backgroundColor: pressed ? t.soft : t.paper }]}
                    >
                      <Feather color={t.ink} name="corner-up-left" size={14} />
                      <Text style={[type.small, { color: t.ink, fontWeight: '600' }]}>Add to message</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void Clipboard.setStringAsync(turn.answer ?? '').then(() => setCopied(turn.key))}
                      style={({ pressed }) => [styles.action, { borderColor: t.line, backgroundColor: pressed ? t.soft : t.paper }]}
                    >
                      <Feather color={t.ink} name={copied === turn.key ? 'check' : 'copy'} size={14} />
                      <Text style={[type.small, { color: t.ink, fontWeight: '600' }]}>{copied === turn.key ? 'Copied' : 'Copy'}</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          ))}
        </ScrollView>

        <View style={[styles.composer, { borderTopColor: t.line, paddingBottom: Math.max(insets.bottom, space.md) }]}>
          <TextInput
            accessibilityLabel="Ask on the side"
            multiline
            onChangeText={setText}
            placeholder="Ask on the side"
            placeholderTextColor={t.muted}
            style={[type.body, styles.input, { color: t.ink, backgroundColor: t.soft }]}
            value={text}
          />
          <IconButton disabled={!text.trim()} filled icon="arrow-up" label="Ask" onPress={send} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { padding: space.lg, gap: space.xl },
  turn: { gap: space.md },
  question: { alignSelf: 'flex-end', maxWidth: '85%', paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, borderBottomRightRadius: 4 },
  waiting: { alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: TOUCH, maxHeight: 140, paddingHorizontal: space.md, paddingTop: 11, paddingBottom: 11, borderRadius: radius.lg }
})
