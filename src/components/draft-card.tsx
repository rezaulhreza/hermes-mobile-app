import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { createContext, useContext, useState } from 'react'
import { Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { CHANNEL_LABEL, type Draft, sendRequest, sendWays } from '@/core/drafts'
import { fade, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { ChoiceSheet } from './choice'
import { IconButton } from './ui'

/** Says a line to the agent of this chat, as a message of the user. Null where no chat can take it. */
export const SayToAgent = createContext<((text: string) => void) | null>(null)

const HERMES = 'hermes'

/**
 * A message Hermes wrote for the user to send, as a card: who it goes to,
 * the subject, the words. The user can copy it, change it on the phone, and
 * send it: with Hermes, which knows the thread and the account, or in an app
 * of the phone.
 */
export function DraftCard({ draft }: { draft: Draft }) {
  const t = useTheme()
  const say = useContext(SayToAgent)
  // The draft with the changes made on the phone. Null: as Hermes wrote it.
  const [changed, setChanged] = useState<Draft | null>(null)
  const [editing, setEditing] = useState(false)
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const shown = changed ?? draft
  const email = shown.channel === 'email'
  const line = { backgroundColor: fade(t.ink, 0.12) }
  const ways = sendWays(shown)

  const copy = () => {
    void Clipboard.setStringAsync(shown.body).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const send = (id: string) => {
    setSending(false)

    if (id === HERMES) {
      return say?.(sendRequest(draft, changed))
    }

    const way = ways.find(candidate => candidate.label === id)

    if (way) {
      void Linking.openURL(way.url).catch(() => Alert.alert(`${way.label} did not open`, `Is ${way.label} on this phone? The draft is still here: copy it.`))
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: t.paper, borderColor: fade(t.ink, 0.15) }]}>
      <View style={styles.head}>
        <Text style={[styles.kind, styles.fill, { color: t.muted }]}>{CHANNEL_LABEL[shown.channel]}</Text>
        <Pressable accessibilityLabel="Change the draft" accessibilityRole="button" hitSlop={10} onPress={() => setEditing(true)}>
          <Feather color={t.ink} name="edit-2" size={19} />
        </Pressable>
        <Pressable accessibilityLabel={copied ? 'Copied' : 'Copy the draft'} accessibilityRole="button" hitSlop={10} onPress={copy}>
          <Feather color={copied ? t.green : t.ink} name={copied ? 'check' : 'copy'} size={19} />
        </Pressable>
        <Pressable
          accessibilityLabel="Send the draft"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setSending(true)}
          style={({ pressed }) => [styles.send, { backgroundColor: t.accent }, pressed && styles.dim]}
        >
          <Feather color={t.onAccent} name="send" size={18} />
        </Pressable>
      </View>

      {email || shown.to ? (
        <>
          <Text selectable style={[type.body, { color: shown.to ? t.ink : t.muted }]}>
            {shown.to ? <Text style={{ color: t.muted }}>To </Text> : null}
            {shown.to || 'Recipients'}
          </Text>
          {shown.cc ? <Party label="Cc" value={shown.cc} /> : null}
          {shown.bcc ? <Party label="Bcc" value={shown.bcc} /> : null}
          {shown.thread ? (
            <View style={styles.thread}>
              <Feather color={t.muted} name="corner-up-left" size={13} />
              <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
                {shown.thread}
              </Text>
            </View>
          ) : null}
          <View style={[styles.line, line]} />
        </>
      ) : null}
      {shown.subject ? (
        <>
          <Text selectable style={[type.body, { color: t.ink }]}>
            {shown.subject}
          </Text>
          <View style={[styles.line, line]} />
        </>
      ) : null}
      <Text selectable style={[type.body, { color: t.ink }]}>
        {shown.body}
      </Text>
      {changed ? <Text style={[type.small, { color: t.muted }]}>Changed on this phone. Hermes has the first version until you send.</Text> : null}

      {sending ? (
        <ChoiceSheet
          choices={[
            ...(say ? [{ id: HERMES, label: 'Send with Hermes', detail: shown.thread ? 'Stays in the thread, from your account.' : 'Hermes sends it from your account.' }] : []),
            ...ways.map(way => ({ id: way.label, label: `Open in ${way.label}`, detail: shown.thread && email ? 'A new email, not in the thread.' : undefined }))
          ]}
          onClose={() => setSending(false)}
          onPick={send}
          title="Send the draft"
        />
      ) : null}
      {editing ? <DraftEditor draft={shown} onClose={() => setEditing(false)} onSave={next => (setChanged(next.body === draft.body && next.subject === draft.subject ? null : next), setEditing(false))} /> : null}
    </View>
  )
}

function Party({ label, value }: { label: string; value: string }) {
  const t = useTheme()

  return (
    <Text selectable style={[type.body, { color: t.ink }]}>
      <Text style={{ color: t.muted }}>{label} </Text>
      {value}
    </Text>
  )
}

/** The words of a draft in fields the user can type in. The change stays on the phone until the draft is sent. */
function DraftEditor({ draft, onSave, onClose }: { draft: Draft; onSave: (draft: Draft) => void; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.body)

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={[styles.sheetHead, { borderBottomColor: t.line }]}>
          <IconButton icon="x" label="Close without the changes" onPress={onClose} />
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>{CHANNEL_LABEL[draft.channel]}</Text>
          <IconButton filled icon="check" label="Keep the changes" onPress={() => onSave({ ...draft, body: body.trim(), ...(draft.subject === undefined ? {} : { subject: subject.trim() }) })} />
        </View>
        <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
          {draft.subject === undefined ? null : (
            <TextInput
              accessibilityLabel="Subject"
              onChangeText={setSubject}
              placeholder="Subject"
              placeholderTextColor={t.muted}
              style={[type.body, styles.subject, { borderBottomColor: t.line, color: t.ink }]}
              value={subject}
            />
          )}
          <TextInput accessibilityLabel="The words of the draft" autoFocus multiline onChangeText={setBody} scrollEnabled={false} style={[type.body, styles.body, { color: t.ink }]} value={body} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { opacity: 0.6 },
  card: { gap: space.md, padding: 20, borderRadius: 22, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.xs },
  kind: { fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  thread: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  line: { height: 1 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
  editor: { padding: space.lg, gap: space.md },
  subject: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, fontWeight: '600' },
  body: { minHeight: 240, textAlignVertical: 'top' }
})
