import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { createContext, useContext, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'

import { CHANNEL_LABEL, type Draft, sendRequest, sendWays } from '@/core/drafts'
import { fade, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { ChoiceSheet } from './choice'

/** Says a line to the agent of this chat, as a message of the user. Null where no chat can take it. */
export const SayToAgent = createContext<((text: string) => void) | null>(null)

const HERMES = 'hermes'

/**
 * A message Hermes wrote for the user to send, as a card: who it goes to,
 * the subject, the words. The user can copy it, change every field in the
 * card itself, and send it: with Hermes, which knows the thread and the account, or in an app
 * of the phone.
 */
export function DraftCard({ draft }: { draft: Draft }) {
  const t = useTheme()
  const say = useContext(SayToAgent)
  // The draft with the changes made on the phone. Null: as Hermes wrote it.
  const [changed, setChanged] = useState<Draft | null>(null)
  // The fields as the user types in them, while the card is open for a change. Null: the card is closed.
  const [form, setForm] = useState<Draft | null>(null)
  const [sending, setSending] = useState(false)
  const [copied, setCopied] = useState(false)
  const shown = form ?? changed ?? draft
  const email = shown.channel === 'email'
  const line = { backgroundColor: fade(t.ink, 0.12) }
  const ways = sendWays(shown)

  const copy = () => {
    void Clipboard.setStringAsync(shown.body).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const keep = () => {
    if (form) {
      const next = tidy(form)

      setChanged(FIELDS.every(field => (next[field] ?? '') === (draft[field] ?? '')) ? null : next)
      setForm(null)
    }
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
        <Pressable accessibilityLabel={form ? 'Keep the changes' : 'Change the draft'} accessibilityRole="button" hitSlop={10} onPress={() => (form ? keep() : setForm(shown))}>
          <Feather color={form ? t.green : t.ink} name={form ? 'check' : 'edit-2'} size={19} />
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

      {form ? (
        <>
          <Field label="To" onChange={to => setForm({ ...form, to })} placeholder={email ? 'Name <address>' : 'Name or number'} value={form.to} />
          {email ? <Field label="Cc" onChange={cc => setForm({ ...form, cc })} value={form.cc} /> : null}
          {email ? <Field label="Bcc" onChange={bcc => setForm({ ...form, bcc })} value={form.bcc} /> : null}
          <View style={[styles.line, line]} />
          {email ? (
            <>
              <TextInput
                accessibilityLabel="Subject"
                onChangeText={subject => setForm({ ...form, subject })}
                placeholder="Subject"
                placeholderTextColor={t.muted}
                style={[type.body, styles.input, { color: t.ink }]}
                value={form.subject ?? ''}
              />
              <View style={[styles.line, line]} />
            </>
          ) : null}
          <TextInput
            accessibilityLabel="The words of the draft"
            multiline
            onChangeText={body => setForm({ ...form, body })}
            scrollEnabled={false}
            style={[type.body, styles.input, styles.words, { color: t.ink }]}
            value={form.body}
          />
        </>
      ) : (
        <Pressable accessibilityHint="Opens the fields for a change" accessibilityLabel="The draft" onPress={() => setForm(shown)} style={styles.rows}>
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
        </Pressable>
      )}
      {changed && !form ? <Text style={[type.small, { color: t.muted }]}>Changed on this phone. Hermes has the first version until you send.</Text> : null}

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

const FIELDS = ['to', 'cc', 'bcc', 'subject', 'body'] as const

/** A draft with no empty field: a field the user cleared is a field the draft does not have. */
function tidy(draft: Draft): Draft {
  const next: Draft = { channel: draft.channel, body: draft.body.trim(), ...(draft.thread ? { thread: draft.thread } : {}) }

  for (const field of ['to', 'cc', 'bcc', 'subject'] as const) {
    const value = draft[field]?.trim()

    if (value) {
      next[field] = value
    }
  }

  return next
}

/** One line of the card to type in: who the draft goes to. */
function Field({ label, value, placeholder, onChange }: { label: string; value?: string; placeholder?: string; onChange: (value: string) => void }) {
  const t = useTheme()

  return (
    <View style={styles.field}>
      <Text style={[type.body, styles.fieldLabel, { color: t.muted }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={fade(t.muted, 0.6)}
        style={[type.body, styles.input, styles.fill, { color: t.ink }]}
        value={value ?? ''}
      />
    </View>
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
  rows: { gap: space.md },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fieldLabel: { width: 34 },
  // A field in the card looks like the text it takes the place of: no box, the same line height.
  input: { padding: 0, margin: 0 },
  words: { minHeight: 96, textAlignVertical: 'top' }
})
