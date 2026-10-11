import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { SecretForm } from '@/components/secret-form'
import { Button, Field, IconButton, Notice } from '@/components/ui'
import { filterKeys, keyProblem, type KeyRow } from '@/core/providers'
import { $linkState } from '@/store/link'
import { $keys, loadKeys, removeKey, saveKey } from '@/store/providers'
import { MONO, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * The secrets of the Hermes host: keys for tools, providers and services. The
 * phone sees which ones are set and a masked end of each, never a value.
 */
export default function Keys() {
  const t = useTheme()
  const keys = useStore($keys)
  const linkState = useStore($linkState)
  const [query, setQuery] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [openName, setOpenName] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const shown = useMemo(() => filterKeys(keys ?? [], query), [keys, query])
  const open = keys?.find(row => row.name === openName)

  useEffect(() => {
    if (linkState === 'open') {
      loadKeys().catch(error => setFailure(error instanceof Error ? error.message : String(error)))
    }
  }, [linkState])

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>API keys</Text>
        <IconButton disabled={!keys} filled icon="plus" label="Add a key by name" onPress={() => setAdding(true)} />
      </View>

      {!keys ? (
        failure ? (
          <Notice detail={failure} icon="alert-triangle" title="Could not read the keys" />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        )
      ) : (
        <FlatList
          contentContainerStyle={styles.content}
          data={shown}
          keyboardShouldPersistTaps="handled"
          keyExtractor={row => row.name}
          ListHeaderComponent={
            <TextInput
              accessibilityLabel="Find a key"
              autoCapitalize="none"
              autoCorrect={false}
              clearButtonMode="while-editing"
              onChangeText={setQuery}
              placeholder="Find a key: a service or a name"
              placeholderTextColor={t.muted}
              style={[type.body, styles.search, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
              value={query}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={item.name}
              accessibilityRole="button"
              onPress={() => setOpenName(item.name)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
            >
              <Feather color={item.set ? t.green : t.line} name={item.set ? 'check-circle' : 'circle'} size={20} />
              <View style={styles.fill}>
                <Text numberOfLines={1} style={[styles.name, { color: t.ink }]}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                  {[item.group, item.set ? item.preview || 'Set' : 'Not set'].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Feather color={t.muted} name="chevron-right" size={18} />
            </Pressable>
          )}
        />
      )}

      {open ? <KeySheet onClose={() => setOpenName(null)} row={open} /> : null}
      {adding ? <NewKeySheet onClose={() => setAdding(false)} /> : null}
    </SafeAreaView>
  )
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.header, styles.sheetHeader, { borderBottomColor: t.line }]}>
          <Text numberOfLines={1} style={[type.heading, styles.fill, { color: t.ink }]}>
            {title}
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

function KeySheet({ row, onClose }: { row: KeyRow; onClose: () => void }) {
  const t = useTheme()

  const remove = () =>
    Alert.alert(`Remove ${row.name}?`, 'Hermes deletes the value from its secrets file. What used it stops working.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void removeKey(row.name).then(onClose, error => Alert.alert('That did not work', error instanceof Error ? error.message : String(error)))
      }
    ])

  return (
    <SheetFrame onClose={onClose} title={row.name}>
      {row.description ? <Text style={[type.body, { color: t.ink }]}>{row.description}</Text> : null}
      <Text style={[type.small, { color: t.muted }]}>
        {row.set ? `Set${row.preview ? `: ${row.preview}` : ''}. A new value replaces it.` : 'Not set.'} The value goes to your Hermes host. The phone does not keep it.
      </Text>
      <SecretForm label={row.set ? 'New value' : 'Value'} onSave={value => saveKey(row.name, value).then(onClose)} url={row.url || undefined} />
      {row.set ? <Button icon="trash-2" label="Remove this key" onPress={remove} tone="danger" /> : null}
    </SheetFrame>
  )
}

/** A key that Hermes has no row for: the user names it. */
function NewKeySheet({ onClose }: { onClose: () => void }) {
  const t = useTheme()
  const [name, setName] = useState('')

  return (
    <SheetFrame onClose={onClose} title="Add a key by name">
      <Text style={[type.small, { color: t.muted }]}>For a service that is not in the list. Your agent and its tools read the key by this name.</Text>
      <Field autoCapitalize="characters" label="Name" onChangeText={text => setName(text.toUpperCase().replace(/[\s-]+/g, '_'))} placeholder="MY_SERVICE_KEY" value={name} />
      <SecretForm
        label="Value"
        onSave={async value => {
          const problem = keyProblem(name, value)

          if (problem) {
            throw new Error(problem)
          }

          await saveKey(name, value)
          onClose()
        }}
      />
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetHeader: { paddingTop: space.md, paddingLeft: space.lg },
  content: { padding: space.lg, gap: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center' },
  search: { minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  name: { fontFamily: MONO, fontSize: 14 },
  sheet: { padding: space.lg, gap: space.lg }
})
