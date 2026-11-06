import { router } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'

import { loadConnectors, wakeSignIn } from '@/store/connectors'
import { space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * Where the browser sends the person after the sign-in of a connected app
 * (hermes://connection/done?status=…&op=…). The host already holds the result,
 * so this screen only asks it again and shows the list of connected apps.
 */
export default function ConnectionDone() {
  const t = useTheme()

  useEffect(() => {
    let gone = false

    void (async () => {
      await wakeSignIn().catch(() => undefined)
      await loadConnectors().catch(() => undefined)

      if (!gone) {
        router.replace('/connectors')
      }
    })()

    return () => {
      gone = true
    }
  }, [])

  return (
    <View style={[styles.fill, { backgroundColor: t.bg }]}>
      <ActivityIndicator color={t.muted} />
      <Text style={[type.small, { color: t.muted }]}>Finishing the sign-in…</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }
})
