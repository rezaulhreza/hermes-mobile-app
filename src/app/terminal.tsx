import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { TerminalPanel } from '@/components/workspace/terminal-panel'
import { $terminal, ensureTerminal } from '@/store/workspace'
import { dark, space, TOUCH, type } from '@/theme/tokens'

/** A terminal is dark in both appearances. */
const c = dark

/**
 * Terminal mode: the command line of the host on the whole screen. It opens
 * from the Workspace tab in every state, also with no folder chosen.
 */
export default function TerminalScreen() {
  const insets = useSafeAreaInsets()
  const terminal = useStore($terminal)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    ensureTerminal().catch(error => setProblem(error instanceof Error ? error.message : String(error)))
  }, [])

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: c.bg }]}>
      <View style={styles.head}>
        <Pressable accessibilityLabel="Leave terminal mode" accessibilityRole="button" hitSlop={6} onPress={() => router.back()} style={[styles.close, { backgroundColor: c.soft }]}>
          <Feather color={c.ink} name="chevron-down" size={22} />
        </Pressable>
        <Text style={[type.heading, styles.fill, { color: c.ink }]}>Terminal</Text>
      </View>
      {terminal ? (
        <TerminalPanel bottom={Math.max(insets.bottom, space.md)} />
      ) : problem ? (
        <Text style={[type.body, styles.problem, { color: c.red }]}>{problem}</Text>
      ) : (
        <ActivityIndicator color={c.muted} style={styles.problem} />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  close: { width: TOUCH, height: TOUCH, borderRadius: TOUCH / 2, alignItems: 'center', justifyContent: 'center' },
  problem: { padding: space.lg }
})
