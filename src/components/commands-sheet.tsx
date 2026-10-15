import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { commandSections, filterCommandSections } from '@/core/commands'
import { $catalog, loadCatalog } from '@/store/commands'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton, Notice } from './ui'

interface Props {
  sessionId: string
  visible: boolean
  onClose: () => void
  /** The user chose a command. It goes into the composer, where an argument can follow. */
  onPick: (command: string) => void
}

/** Every command and skill that runs on a phone. This is what `/help` opens. */
export function CommandsSheet({ sessionId, visible, onClose, onPick }: Props) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const catalog = useStore($catalog)
  const [query, setQuery] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!visible) {
      return
    }

    let cancelled = false

    void loadCatalog(sessionId).then(result => !cancelled && setFailed(result === null))

    return () => {
      cancelled = true
    }
  }, [visible, sessionId])

  const sections = useMemo(() => filterCommandSections(commandSections(catalog), query), [catalog, query])

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Commands</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <View style={[styles.search, { backgroundColor: t.soft }]}>
          <Feather color={t.muted} name="search" size={18} />
          <TextInput
            accessibilityLabel="Search commands"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search commands and skills"
            placeholderTextColor={t.muted}
            style={[styles.fill, type.body, { color: t.ink }]}
            value={query}
          />
        </View>

        {!catalog && !failed ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        ) : !catalog ? (
          <Notice detail="Close this sheet and open it again." icon="alert-triangle" title="Could not load the commands" />
        ) : (
          <SectionList
            automaticallyAdjustKeyboardInsets
            ListEmptyComponent={<Notice icon="search" title="No matching commands" />}
            contentContainerStyle={styles.list}
            keyExtractor={row => row.command}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityHint="Puts the command in the message field"
                accessibilityRole="button"
                onPress={() => onPick(item.command)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.soft }]}
              >
                <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                  {item.command}
                </Text>
                {item.description ? (
                  <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
                    {item.description}
                  </Text>
                ) : null}
              </Pressable>
            )}
            renderSectionHeader={({ section }) => (
              <Text style={[type.small, styles.section, { backgroundColor: t.bg, color: t.muted }]}>{section.name}</Text>
            )}
            sections={sections}
            stickySectionHeadersEnabled
          />
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', padding: space.lg, paddingBottom: space.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TOUCH,
    marginHorizontal: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md
  },
  list: { paddingBottom: space.xl, flexGrow: 1 },
  section: { fontWeight: '700', paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: { justifyContent: 'center', gap: 2, minHeight: TOUCH + 4, paddingHorizontal: space.lg, paddingVertical: space.sm }
})
