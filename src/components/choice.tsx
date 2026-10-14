import { Feather } from '@expo/vector-icons'
import type { ComponentProps, ReactNode } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton } from './ui'

type IconName = ComponentProps<typeof Feather>['name']

/** One setting as a row: what it is, what it is set to, and a tap that opens the list of choices. */
export function ChoiceRow({ icon, lead, label, value, onPress, disabled }: { icon: IconName; /** A picture in place of the icon: the bot that is set. */ lead?: ReactNode; label: string; value: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme()

  return (
    <Pressable
      accessibilityHint="Opens the list of choices"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }, disabled && styles.dim]}
    >
      {lead ?? <Feather color={t.muted} name={icon} size={20} />}
      <View style={styles.fill}>
        <Text style={[type.small, { color: t.muted }]}>{label}</Text>
        <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
          {value}
        </Text>
      </View>
      <Feather color={t.muted} name="chevron-right" size={18} />
    </Pressable>
  )
}

export interface Choice {
  id: string
  label: string
  detail?: string
  /** A picture or an icon in front of the words. */
  lead?: ReactNode
}

interface SheetProps {
  title: string
  choices: readonly Choice[]
  /** The choice that is set now. */
  current?: string | null
  onPick: (id: string) => void
  onClose: () => void
  /** Shown under the list: a line that says what the list is for, or a wait. */
  footer?: ReactNode
}

/** A list of choices as a sheet. A tap picks one; the caller closes the sheet. */
export function ChoiceSheet({ title, choices, current, onPick, onClose, footer }: SheetProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <Text numberOfLines={1} style={[type.heading, styles.fill, { color: t.ink }]}>
            {title}
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <FlatList
          ListFooterComponent={footer ? <View style={styles.footer}>{footer}</View> : null}
          data={choices}
          initialNumToRender={14}
          keyExtractor={choice => choice.id}
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`${title}: ${item.label}`}
              accessibilityRole="button"
              accessibilityState={{ selected: item.id === current }}
              onPress={() => onPick(item.id)}
              style={({ pressed }) => [styles.choice, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
            >
              {item.lead}
              <View style={styles.fill}>
                <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                  {item.label}
                </Text>
                {item.detail ? (
                  <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
                    {item.detail}
                  </Text>
                ) : null}
              </View>
              {item.id === current ? <Feather color={t.accent} name="check" size={18} /> : null}
            </Pressable>
          )}
          windowSize={7}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 12, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  choice: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 12, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  footer: { padding: space.lg }
})
