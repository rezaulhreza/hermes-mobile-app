import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Card, IconButton } from '@/components/ui'
import { EngineChoices } from '@/components/voice-engines'
import { DEEPGRAM_VOICES, EXPRESSIVITY, expressivityName, LANGUAGES, languageName, voiceName } from '@/core/live-voice'
import { $linkState } from '@/store/link'
import { $engines, hostExpressivity, hostKeyterms, hostLanguage, hostVoice, loadEngines, saveVoiceSettings } from '@/store/voice'
import { $wake, setWake, syncWake } from '@/store/wake'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type Change = Parameters<typeof saveVoiceSettings>[0]

/**
 * How you talk with the agent: the speech engine of a call, the voice, the words to hear right,
 * and the wake word. The voice settings live on the Hermes host, so the desktop app, Brah and
 * this phone use the same ones.
 */
export default function Voice() {
  const t = useTheme()
  const wake = useStore($wake)
  const linkState = useStore($linkState)
  const engines = useStore($engines)
  const [picking, setPicking] = useState<'voice' | 'language' | 'expressivity' | null>(null)
  const [saving, setSaving] = useState(false)
  const [newTerm, setNewTerm] = useState('')
  // Read again each time the host answers: $engines changes with every load.
  const voice = hostVoice()
  const language = hostLanguage()
  const lively = hostExpressivity()
  const terms = hostKeyterms()
  const deepgram = engines?.find(engine => engine.name === 'deepgram' && !engine.reason)
  // Only a Flux voice changes with expressivity: the row shows for one only.
  const flux = (voice ?? '').startsWith('flux-')
  const ready = Boolean(deepgram) && !saving

  useEffect(() => {
    if (linkState === 'open') {
      void loadEngines().catch(() => undefined)
      void syncWake()
    }
  }, [linkState])

  const save = (change: Change) => {
    setPicking(null)
    setSaving(true)
    saveVoiceSettings(change)
      .catch(error => Alert.alert('Not saved', error instanceof Error ? error.message : String(error)))
      .finally(() => setSaving(false))
  }

  const addTerm = () => {
    const term = newTerm.trim().replace(/\s+/g, ' ')

    setNewTerm('')

    if (term && !terms.some(known => known.toLowerCase() === term.toLowerCase())) {
      save({ keyterms: [...terms, term] })
    }
  }

  const rowLine = { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Voice</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[type.small, styles.section, { color: t.muted }]}>Speech engine of Live voice</Text>
        <Card style={styles.card}>
          <EngineChoices />
        </Card>
        <Text style={[type.small, { color: t.muted }]}>
          Your agent is the same with every engine. The engine only hears you and speaks the answer. The speech keys stay on your Hermes host.
        </Text>

        <Text style={[type.small, styles.section, { color: t.muted }]}>Voice of Hermes</Text>
        <Card style={styles.card}>
          <Pressable
            accessibilityHint="Opens the list of voices"
            accessibilityLabel={`Voice: ${voice ? voiceName(voice) : 'Not set'}`}
            accessibilityRole="button"
            disabled={!ready}
            onPress={() => setPicking('voice')}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="volume-2" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>{voice ? voiceName(voice) : 'Not set'}</Text>
              <Text style={[type.small, { color: t.muted }]}>The voice that speaks the answer.</Text>
            </View>
            {ready ? <Feather color={t.muted} name="chevron-right" size={18} /> : null}
          </Pressable>
          <Pressable
            accessibilityHint="Opens the list of languages"
            accessibilityLabel={`Language: ${language ? languageName(language) : 'Not set'}`}
            accessibilityRole="button"
            disabled={!ready}
            onPress={() => setPicking('language')}
            style={({ pressed }) => [styles.row, rowLine, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="globe" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>{language ? languageName(language) : 'Not set'}</Text>
              <Text style={[type.small, { color: t.muted }]}>The language you speak.</Text>
            </View>
            {ready ? <Feather color={t.muted} name="chevron-right" size={18} /> : null}
          </Pressable>
          {flux ? (
            <Pressable
              accessibilityHint="Opens the list of levels"
              accessibilityLabel={`Expressivity: ${expressivityName(lively)}`}
              accessibilityRole="button"
              disabled={!ready}
              onPress={() => setPicking('expressivity')}
              style={({ pressed }) => [styles.row, rowLine, pressed && { backgroundColor: t.soft }]}
            >
              <Feather color={t.muted} name="activity" size={20} />
              <View style={styles.fill}>
                <Text style={[type.label, { color: t.ink }]}>{expressivityName(lively)}</Text>
                <Text style={[type.small, { color: t.muted }]}>How lively the voice sounds.</Text>
              </View>
              {ready ? <Feather color={t.muted} name="chevron-right" size={18} /> : null}
            </Pressable>
          ) : null}
        </Card>
        <Text style={[type.small, { color: t.muted }]}>
          {deepgram ? 'These are set on your Hermes host. The desktop app and Brah use them too.' : 'Live voice on the Deepgram engine is not ready on your Hermes host.'}
        </Text>

        {deepgram ? (
          <>
            <Text style={[type.small, styles.section, { color: t.muted }]}>Words to hear right</Text>
            <Card style={styles.card}>
              <View style={styles.row}>
                <TextInput
                  accessibilityLabel="New word"
                  autoCorrect={false}
                  editable={!saving}
                  onChangeText={setNewTerm}
                  onSubmitEditing={addTerm}
                  placeholder="Add a name or a word"
                  placeholderTextColor={t.muted}
                  returnKeyType="done"
                  style={[type.body, styles.input, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
                  value={newTerm}
                />
                <IconButton disabled={saving || !newTerm.trim()} icon="plus" label="Add the word" onPress={addTerm} />
              </View>
              {terms.map(term => (
                <View key={term} style={[styles.row, rowLine]}>
                  <Text style={[type.label, styles.fill, { color: t.ink }]}>{term}</Text>
                  <IconButton disabled={saving} icon="x" label={`Remove ${term}`} onPress={() => save({ keyterms: terms.filter(known => known !== term) })} />
                </View>
              ))}
            </Card>
            <Text style={[type.small, { color: t.muted }]}>
              Names and words that Live voice often gets wrong, such as your products and people. Every app on your Hermes host uses this list.
            </Text>
          </>
        ) : null}

        <Text style={[type.small, styles.section, { color: t.muted }]}>Wake word</Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>Listen for “{wake.phrase}”</Text>
              <Text style={[type.small, { color: t.muted }]}>
                {wake.notice || (wake.listening ? 'Listening. Say the phrase to start Live voice.' : 'Say the phrase and Live voice starts, with no tap.')}
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

      <Modal animationType="slide" onRequestClose={() => setPicking(null)} presentationStyle="pageSheet" visible={picking === 'language'}>
        <View style={[styles.fill, { backgroundColor: t.bg }]}>
          <View style={[styles.header, styles.sheetHead, { borderBottomColor: t.line }]}>
            <Text style={[type.heading, styles.fill, { color: t.ink }]}>Language</Text>
            <IconButton icon="x" label="Close" onPress={() => setPicking(null)} />
          </View>
          <FlatList
            data={LANGUAGES}
            keyExtractor={item => item.code}
            renderItem={({ item }) => (
              <Pressable
                accessibilityLabel={`Language: ${item.name}`}
                accessibilityRole="button"
                accessibilityState={{ selected: item.code === language }}
                onPress={() => save({ language: item.code })}
                style={({ pressed }) => [styles.row, { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
              >
                <Text style={[type.label, styles.fill, { color: t.ink }]}>{item.name}</Text>
                {item.code === language ? <Feather color={t.accent} name="check" size={18} /> : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setPicking(null)} presentationStyle="pageSheet" visible={picking === 'expressivity'}>
        <View style={[styles.fill, { backgroundColor: t.bg }]}>
          <View style={[styles.header, styles.sheetHead, { borderBottomColor: t.line }]}>
            <Text style={[type.heading, styles.fill, { color: t.ink }]}>Expressivity</Text>
            <IconButton icon="x" label="Close" onPress={() => setPicking(null)} />
          </View>
          <FlatList
            data={EXPRESSIVITY}
            keyExtractor={item => String(item.value)}
            renderItem={({ item }) => (
              <Pressable
                accessibilityLabel={`Expressivity: ${item.name}`}
                accessibilityRole="button"
                accessibilityState={{ selected: item.value === lively }}
                onPress={() => save({ expressivity: item.value })}
                style={({ pressed }) => [styles.row, { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
              >
                <Text style={[type.label, styles.fill, { color: t.ink }]}>{item.name}</Text>
                {item.value === lively ? <Feather color={t.accent} name="check" size={18} /> : null}
              </Pressable>
            )}
          />
        </View>
      </Modal>

      <Modal animationType="slide" onRequestClose={() => setPicking(null)} presentationStyle="pageSheet" visible={picking === 'voice'}>
        <View style={[styles.fill, { backgroundColor: t.bg }]}>
          <View style={[styles.header, styles.sheetHead, { borderBottomColor: t.line }]}>
            <Text style={[type.heading, styles.fill, { color: t.ink }]}>Voice of Hermes</Text>
            <IconButton icon="x" label="Close" onPress={() => setPicking(null)} />
          </View>
          <FlatList
            data={DEEPGRAM_VOICES}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
              <Pressable
                accessibilityLabel={`Voice: ${item.name}`}
                accessibilityRole="button"
                accessibilityState={{ selected: item.id === voice }}
                onPress={() => save({ voice: item.id })}
                style={({ pressed }) => [styles.row, { borderBottomColor: t.line, borderBottomWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
              >
                <View style={styles.fill}>
                  <Text style={[type.label, { color: t.ink }]}>{item.name}</Text>
                  <Text style={[type.small, { color: t.muted }]}>{item.tone}</Text>
                </View>
                {item.id === voice ? <Feather color={t.accent} name="check" size={18} /> : null}
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
  input: { flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, paddingVertical: space.sm }
})
