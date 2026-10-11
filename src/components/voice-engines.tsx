import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { $preferences, setPreference } from '@/store/preferences'
import { $engines, type EngineChoice } from '@/store/voice'
import { space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * The speech engines of this host, as a list with one choice. An engine the
 * host cannot run stays in the list with the reason, so the user knows it
 * exists and what it needs.
 */
export function EngineChoices({ onChoose }: { onChoose?: (choice: EngineChoice) => void }) {
  const t = useTheme()
  const engines = useStore($engines)
  const wanted = useStore($preferences).engine
  // `auto` is the first engine that works: show that one as the choice.
  const chosen = engines?.find(choice => !choice.reason && choice.name === wanted) ?? engines?.find(choice => !choice.reason)

  if (!engines) {
    return <Text style={[type.small, styles.loading, { color: t.muted }]}>Asking your Hermes host…</Text>
  }

  return (
    <View>
      {engines.map((choice, index) => {
        const checked = choice.name === chosen?.name

        return (
          <Pressable
            accessibilityLabel={choice.label}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled: Boolean(choice.reason) }}
            disabled={Boolean(choice.reason)}
            key={choice.name}
            onPress={() => {
              setPreference('engine', choice.name)
              onChoose?.(choice)
            }}
            style={({ pressed }) => [styles.row, index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={checked ? t.accent : t.line} name={checked ? 'check-circle' : 'circle'} size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: choice.reason ? t.muted : t.ink }]}>{choice.label}</Text>
              <Text style={[type.small, { color: t.muted }]}>{choice.reason ?? choice.detail}</Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { padding: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, paddingVertical: space.sm }
})
