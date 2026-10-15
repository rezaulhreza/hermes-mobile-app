import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { SecretForm } from '@/components/secret-form'
import { Button, IconButton, Notice } from '@/components/ui'
import { modelLabel } from '@/core/models'
import { filterProviders, providerLine, type ProviderRow, providerRows } from '@/core/providers'
import { $linkState } from '@/store/link'
import { $providers, disconnectProvider, loadProviders, saveProviderKey, setDefaultModel } from '@/store/providers'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * What the agent thinks with. Connected providers are first. A provider with
 * no key opens to one field: paste the key and it is connected.
 */
export default function Providers() {
  const t = useTheme()
  const options = useStore($providers)
  const linkState = useStore($linkState)
  const [query, setQuery] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [openSlug, setOpenSlug] = useState<string | null>(null)
  const rows = useMemo(() => (options ? providerRows(options) : []), [options])
  const shown = useMemo(() => filterProviders(rows, query), [rows, query])
  const open = rows.find(row => row.slug === openSlug)

  useEffect(() => {
    if (linkState === 'open') {
      loadProviders().catch(error => setFailure(error instanceof Error ? error.message : String(error)))
    }
  }, [linkState])

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Providers and models</Text>
      </View>

      {!options ? (
        failure ? (
          <Notice detail={failure} icon="alert-triangle" title="Could not read the providers" />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        )
      ) : (
        <FlatList
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.content}
          data={shown}
          keyboardShouldPersistTaps="handled"
          keyExtractor={row => row.slug}
          ListHeaderComponent={
            <TextInput
              accessibilityLabel="Find a provider"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder="Find a provider"
              placeholderTextColor={t.muted}
              style={[type.body, styles.search, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
              value={query}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={item.name}
              accessibilityRole="button"
              onPress={() => setOpenSlug(item.slug)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
            >
              <Feather color={item.connected ? t.green : t.line} name={item.connected ? 'check-circle' : 'circle'} size={20} />
              <View style={styles.fill}>
                <Text style={[type.label, { color: t.ink }]}>{item.name}</Text>
                <Text numberOfLines={1} style={[type.small, { color: item.current ? t.accent : t.muted }]}>
                  {providerLine(item, options.model)}
                </Text>
              </View>
              <Feather color={t.muted} name="chevron-right" size={18} />
            </Pressable>
          )}
        />
      )}

      {open && options ? <ProviderSheet currentModel={open.current ? options.model : undefined} onClose={() => setOpenSlug(null)} row={open} /> : null}
    </SafeAreaView>
  )
}

function ProviderSheet({ row, currentModel, onClose }: { row: ProviderRow; currentModel: string | undefined; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState<string | null>(null)
  const fail = (error: unknown) => Alert.alert('That did not work', error instanceof Error ? error.message : String(error))

  const choose = (model: string) => {
    setBusy(model)
    setDefaultModel(row.slug, model)
      .catch(fail)
      .finally(() => setBusy(null))
  }

  const disconnect = () =>
    Alert.alert(`Disconnect ${row.name}?`, 'Hermes removes its key for this provider. Conversations that use it stop working until you connect it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void disconnectProvider(row.slug).then(onClose, fail) }
    ])

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.header, styles.sheetHeader, { borderBottomColor: t.line }]}>
          <Text numberOfLines={1} style={[type.heading, styles.fill, { color: t.ink }]}>
            {row.name}
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} keyboardShouldPersistTaps="handled">
          {row.warning ? <Text style={[type.small, styles.warning, { color: t.red, backgroundColor: t.redBg }]}>{row.warning}</Text> : null}

          {row.connected ? (
            <>
              <Text style={[type.small, { color: t.muted }]}>A tap makes a model the one every new conversation starts with. A conversation that is open keeps its model.</Text>
              <View style={[styles.models, { borderColor: t.line, backgroundColor: t.paper }]}>
                {row.models.map((model, index) => (
                  <Pressable
                    accessibilityLabel={model}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: model === currentModel }}
                    disabled={busy !== null}
                    key={model}
                    onPress={() => choose(model)}
                    style={({ pressed }) => [styles.model, index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
                  >
                    <Text numberOfLines={1} style={[type.body, styles.fill, { color: t.ink }, model === currentModel && styles.strong]}>
                      {modelLabel(model)}
                    </Text>
                    {busy === model ? <ActivityIndicator color={t.muted} /> : model === currentModel ? <Feather color={t.accent} name="check" size={18} /> : null}
                  </Pressable>
                ))}
                {row.models.length ? null : <Text style={[type.small, styles.none, { color: t.muted }]}>This provider lists no models now.</Text>}
              </View>
              <Button icon="log-out" label={`Disconnect ${row.name}`} onPress={disconnect} tone="danger" />
            </>
          ) : row.takesKey ? (
            <>
              <Text style={[type.small, { color: t.muted }]}>
                The key goes to your Hermes host, which keeps it in its own secrets file as {row.keyEnv}. The phone does not keep it.
              </Text>
              <SecretForm label={`${row.name} API key`} onSave={key => saveProviderKey(row.slug, key, row.keyEnv)} saveLabel="Connect" />
            </>
          ) : (
            <Notice detail={row.signInNote} icon="monitor" title="Sign in on the computer" />
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strong: { fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetHeader: { paddingTop: space.md, paddingLeft: space.lg },
  content: { padding: space.lg, gap: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center' },
  search: { minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  sheet: { padding: space.lg, gap: space.lg },
  warning: { padding: space.md, borderRadius: radius.md, overflow: 'hidden' },
  models: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  model: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, paddingHorizontal: space.lg },
  none: { padding: space.lg }
})
