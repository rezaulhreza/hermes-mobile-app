import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect } from 'react'
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Card, IconButton } from '@/components/ui'
import { EngineChoices } from '@/components/voice-engines'
import { $linkState } from '@/store/link'
import { loadEngines } from '@/store/voice'
import { $wake, setWake, syncWake } from '@/store/wake'
import { space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/** How this phone talks with the agent: the speech engine of a call, and the wake word. */
export default function Voice() {
  const t = useTheme()
  const wake = useStore($wake)
  const linkState = useStore($linkState)

  useEffect(() => {
    if (linkState === 'open') {
      void loadEngines().catch(() => undefined)
      void syncWake()
    }
  }, [linkState])

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Voice</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.small, styles.section, { color: t.muted }]}>Speech engine of a call</Text>
        <Card style={styles.card}>
          <EngineChoices />
        </Card>
        <Text style={[type.small, { color: t.muted }]}>
          Your agent is the same with every engine. The engine only hears you and speaks the answer. The speech keys stay on your Hermes host.
        </Text>

        <Text style={[type.small, styles.section, { color: t.muted }]}>Wake word</Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>Listen for “{wake.phrase}”</Text>
              <Text style={[type.small, { color: t.muted }]}>
                {wake.notice || (wake.listening ? 'Listening. Say the phrase to start a call.' : 'Say the phrase and a call starts, with no tap.')}
              </Text>
            </View>
            <Switch
              accessibilityLabel="Listen for the wake word"
              disabled={wake.pending || !wake.available || linkState !== 'open'}
              onValueChange={on => void setWake(on)}
              value={wake.listening}
            />
          </View>
        </Card>
        <Text style={[type.small, { color: t.muted }]}>
          While this is on and the app is open, the microphone goes to your Hermes host, which listens for the phrase. Nothing is recorded. The
          microphone closes when the app leaves the screen.
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { padding: space.lg, gap: space.md, maxWidth: 760, width: '100%', alignSelf: 'center' },
  section: { fontWeight: '700', marginTop: space.md },
  card: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, paddingVertical: space.sm }
})
