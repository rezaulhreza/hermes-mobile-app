import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Card, IconButton } from '@/components/ui'
import { EngineChoices } from '@/components/voice-engines'
import { $linkState } from '@/store/link'
import { DEEPGRAM_VOICES, voiceName } from '@/core/live-voice'
import { $preferences, setPreference } from '@/store/preferences'
import { $engines, hostVoice, loadEngines } from '@/store/voice'
import { $wake, setWake, syncWake } from '@/store/wake'
import { space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/** How this phone talks with the agent: the speech engine of a call, and the wake word. */
export default function Voice() {
  const t = useTheme()
  const wake = useStore($wake)
  const linkState = useStore($linkState)
  const chosen = useStore($preferences).voice
  const engines = useStore($engines)
  const [picking, setPicking] = useState(false)
  // The voice the host is set to. The phone can take another one for its own calls.
  const ofHost = hostVoice()
  const deepgram = engines?.find(engine => engine.name === 'deepgram' && !engine.reason)

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

        <Text style={[type.small, styles.section, { color: t.muted }]}>Voice of Hermes</Text>
        <Card style={styles.card}>
          <Pressable
            accessibilityHint={deepgram ? 'Opens the list of voices' : undefined}
            accessibilityLabel={`Voice: ${chosen ? voiceName(chosen) : 'The voice of the host'}`}
            accessibilityRole="button"
            disabled={!deepgram}
            onPress={() => setPicking(true)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="volume-2" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>{chosen ? voiceName(chosen) : ofHost ? `${voiceName(ofHost)}, the voice of the host` : 'The voice of the host'}</Text>
              <Text style={[type.small, { color: t.muted }]}>
                {deepgram ? 'For calls on the Deepgram live engine, from this phone.' : 'The other engines speak with the voice set on your Hermes host.'}
              </Text>
            </View>
            {deepgram ? <Feather color={t.muted} name="chevron-right" size={18} /> : null}
          </Pressable>
        </Card>

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

      <Modal animationType="slide" onRequestClose={() => setPicking(false)} presentationStyle="pageSheet" visible={picking}>
        <View style={[styles.fill, { backgroundColor: t.bg }]}>
          <View style={[styles.header, styles.sheetHead, { borderBottomColor: t.line }]}>
            <Text style={[type.heading, styles.fill, { color: t.ink }]}>Voice of Hermes</Text>
            <IconButton icon="x" label="Close" onPress={() => setPicking(false)} />
          </View>
          <FlatList
            data={[{ id: '', name: ofHost ? `${voiceName(ofHost)}, the voice of the host` : 'The voice of the host', tone: 'What your Hermes host is set to' }, ...DEEPGRAM_VOICES]}
            keyExtractor={voice => voice.id || 'host'}
            renderItem={({ item }) => (
              <Pressable
                accessibilityLabel={`Voice: ${item.name}`}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === chosen }}
                onPress={() => (setPreference('voice', item.id), setPicking(false))}
                style={({ pressed }) => [styles.row, { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
              >
                <View style={styles.fill}>
                  <Text style={[type.label, { color: t.ink }]}>{item.name}</Text>
                  <Text style={[type.small, { color: t.muted }]}>{item.tone}</Text>
                </View>
                {item.id === chosen ? <Feather color={t.accent} name="check" size={18} /> : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { padding: space.lg, gap: space.md, maxWidth: 760, width: '100%', alignSelf: 'center' },
  section: { fontWeight: '700', marginTop: space.md },
  sheetHead: { paddingTop: space.md },
  card: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, paddingVertical: space.sm }
})
