import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { baseName } from '@/core/workspace'
import { $preferences } from '@/store/preferences'
import { $startPoints, loadStartPoints, openRoot } from '@/store/workspace'
import { MONO, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button, IconButton } from '../ui'

/** Choose the folder on the host to work in: a project, the folder Hermes runs in, a recent one, or a typed path. */
export function RootSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const points = useStore($startPoints)
  const recent = useStore($preferences).roots
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (visible) {
      void loadStartPoints().catch(() => undefined)
    }
  }, [visible])

  const pick = (path: string) => {
    openRoot(path)
    onClose()
  }

  const known = new Set(points.map(point => point.path))

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Open a folder</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.lg }]} keyboardShouldPersistTaps="handled">
          {points.map(point => (
            <FolderRow icon="folder" key={point.path} label={point.label} onPress={() => pick(point.path)} path={point.path} />
          ))}
          {recent
            .filter(path => !known.has(path))
            .map(path => (
              <FolderRow icon="clock" key={path} label={baseName(path)} onPress={() => pick(path)} path={path} />
            ))}
          <Text style={[type.small, styles.label, { color: t.muted }]}>Or a path on the host</Text>
          <TextInput
            accessibilityLabel="Folder path"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setTyped}
            onSubmitEditing={() => typed.trim() && pick(typed.trim())}
            placeholder="/home/me/project"
            placeholderTextColor={t.muted}
            returnKeyType="go"
            style={[styles.input, { color: t.ink, backgroundColor: t.soft }]}
            value={typed}
          />
          <Button disabled={!typed.trim()} label="Open this folder" onPress={() => pick(typed.trim())} tone="primary" />
        </ScrollView>
      </View>
    </Modal>
  )
}

function FolderRow({ icon, label, path, onPress }: { icon: 'folder' | 'clock'; label: string; path: string; onPress: () => void }) {
  const t = useTheme()

  return (
    <Pressable
      accessibilityLabel={`Folder: ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: t.paper, borderColor: t.line }, pressed && styles.dim]}
    >
      <Feather color={t.muted} name={icon} size={18} />
      <View style={styles.fill}>
        <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
          {label}
        </Text>
        <Text ellipsizeMode="head" numberOfLines={1} style={[type.small, { color: t.muted }]}>
          {path}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md },
  content: { paddingHorizontal: space.lg, gap: space.sm },
  label: { marginTop: space.md, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + space.md, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  input: { minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, fontFamily: MONO, fontSize: 14 }
})
