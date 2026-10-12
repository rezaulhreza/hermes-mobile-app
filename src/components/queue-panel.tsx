import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { type ReactNode, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { $conversations, cancelQueued, editQueued, sendQueuedNext, steerQueued } from '@/store/chat'
import { radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const ICON = 18

/**
 * The messages that wait for the running turn, over the message field. Each
 * one can go into the running turn now (the wheel), go out next, go back into
 * the message field to be changed, or be taken out.
 */
export function QueuePanel({ sessionId, onEdit }: { sessionId: string; onEdit: (text: string) => void }) {
  const t = useTheme()
  const conversation = useStore($conversations)[sessionId]
  const queue = conversation?.queue
  const running = conversation?.transcript.running ?? false
  const [open, setOpen] = useState<string | null>(null)
  const [closed, setClosed] = useState(false)

  if (!queue?.items.length) {
    return null
  }

  return (
    <View style={[styles.panel, { backgroundColor: t.soft }]}>
      <Pressable
        accessibilityLabel={`${queue.paused ? 'Queue paused' : 'Queued'}: ${queue.items.length}`}
        accessibilityHint={closed ? 'Shows the queued messages' : 'Hides the queued messages'}
        accessibilityRole="button"
        accessibilityState={{ expanded: !closed }}
        hitSlop={6}
        onPress={() => setClosed(!closed)}
        style={styles.head}
      >
        <Feather color={t.muted} name={queue.paused ? 'pause' : 'layers'} size={14} />
        <Text style={[type.small, { color: t.muted, fontWeight: '700' }]}>
          {queue.paused ? `Queue paused · ${queue.items.length}` : `Queued · ${queue.items.length}`}
        </Text>
        <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
          {closed ? queue.items[0].text : queue.paused ? 'You stopped the turn' : 'Runs after this turn'}
        </Text>
        <Feather color={t.muted} name={closed ? 'chevron-up' : 'chevron-down'} size={16} />
      </Pressable>

      {closed ? null : (
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.rows}>
          {queue.items.map((item, index) => (
            <View key={item.id} style={[styles.row, { borderTopColor: t.line }]}>
              <Pressable
                accessibilityHint="Shows the whole message"
                accessibilityLabel={`Queued message: ${item.text}`}
                accessibilityRole="button"
                onPress={() => setOpen(open === item.id ? null : item.id)}
                style={styles.fill}
              >
                <Text numberOfLines={open === item.id ? 6 : 1} style={[type.small, { color: t.ink }]}>
                  {item.text}
                </Text>
              </Pressable>

              {/* Every action has its own column, so the icons of all rows are in line. An action a row does not have leaves its place empty. */}
              <Slot label="Steer: send into the running turn" onPress={running ? () => void steerQueued(sessionId, item.id) : undefined}>
                <MaterialCommunityIcons color={t.accent} name="steering" size={ICON + 2} />
              </Slot>
              <Slot label={running ? 'Send next' : 'Send now'} onPress={index > 0 || queue.paused ? () => sendQueuedNext(sessionId, item.id) : undefined}>
                <Feather color={t.ink} name="corner-down-left" size={ICON} />
              </Slot>
              <Slot label="Edit the queued message" onPress={() => onEdit(editQueued(sessionId, item.id))}>
                <Feather color={t.ink} name="edit-2" size={ICON - 2} />
              </Slot>
              <Slot label="Remove the queued message" onPress={() => cancelQueued(sessionId, item.id)}>
                <Feather color={t.muted} name="x" size={ICON} />
              </Slot>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  )
}

/** One column of the actions. With no `onPress` the place stays, empty. */
function Slot({ label, onPress, children }: { label: string; onPress?: () => void; children: ReactNode }) {
  return onPress ? (
    <Pressable accessibilityLabel={label} accessibilityRole="button" hitSlop={4} onPress={onPress} style={({ pressed }) => [styles.slot, pressed && styles.dim]}>
      {children}
    </Pressable>
  ) : (
    <View style={styles.slot} />
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { opacity: 0.5 },
  panel: { marginHorizontal: space.md, marginBottom: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36 },
  // Three rows show; more scroll. The chat under the panel must stay readable.
  rows: { maxHeight: 132 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth },
  slot: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }
})
