import { Feather } from '@expo/vector-icons'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import {
  filterSections,
  isReasoningLevel,
  type ModelChoice,
  type ModelSection,
  modelSections,
  REASONING_LABEL,
  REASONING_LEVELS
} from '@/core/models'
import { loadModelOptions, setReasoning, switchModel } from '@/store/chat'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton, Notice } from './ui'

interface Props {
  sessionId: string
  reasoning: string | undefined
  visible: boolean
  /** Text for the search field when the sheet mounts: the name the user typed after `/model`. */
  initialQuery?: string
  onClose: () => void
}

/** Pick the model and the reasoning level for one conversation. */
export function ModelSheet({ sessionId, reasoning, visible, initialQuery = '', onClose }: Props) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [sections, setSections] = useState<ModelSection[] | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    if (!visible) {
      return
    }

    let cancelled = false

    loadModelOptions(sessionId)
      .then(result => {
        if (!cancelled) {
          setSections(modelSections(result))
          setFailure(null)
        }
      })
      .catch(error => !cancelled && setFailure(error instanceof Error ? error.message : String(error)))

    return () => {
      cancelled = true
    }
  }, [visible, sessionId])

  const shown = useMemo(
    () => filterSections(sections ?? [], query).map(section => ({ ...section, data: section.choices })),
    [sections, query]
  )

  const pick = async (choice: ModelChoice, confirmed = false) => {
    setPending(`${choice.provider}/${choice.model}`)

    try {
      const result = await switchModel(sessionId, choice, confirmed)

      if (result.done) {
        onClose()
      } else {
        Alert.alert('Switch model?', result.confirmMessage, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Switch', onPress: () => void pick(choice, true) }
        ])
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(null)
    }
  }

  const level = isReasoningLevel(reasoning) ? reasoning : null

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Model</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <View style={styles.block}>
          <Text style={[type.small, { color: t.muted, fontWeight: '700' }]}>Reasoning</Text>
          <View style={[styles.levels, { backgroundColor: t.soft }]}>
            {REASONING_LEVELS.map(option => {
              const on = option === level

              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  key={option}
                  onPress={() => void setReasoning(sessionId, option).catch(e => setFailure(String(e?.message ?? e)))}
                  style={[styles.level, on && { backgroundColor: t.paper }]}
                >
                  <Text style={[type.small, { color: on ? t.ink : t.muted, fontWeight: on ? '700' : '500' }]}>
                    {REASONING_LABEL[option]}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <View style={[styles.search, { backgroundColor: t.soft }]}>
          <Feather color={t.muted} name="search" size={18} />
          <TextInput
            accessibilityLabel="Search models"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search models"
            placeholderTextColor={t.muted}
            style={[styles.fill, type.body, { color: t.ink }]}
            value={query}
          />
        </View>

        {failure ? <Text style={[type.small, styles.failure, { color: t.red }]}>{failure}</Text> : null}

        {!sections && !failure ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        ) : (
          <SectionList
            automaticallyAdjustKeyboardInsets
            ListEmptyComponent={sections ? <Notice icon="search" title="No matching models" /> : null}
            contentContainerStyle={styles.list}
            keyExtractor={choice => `${choice.provider}/${choice.model}`}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: item.current }}
                disabled={pending !== null}
                onPress={() => void pick(item)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.soft }]}
              >
                <Text numberOfLines={1} style={[type.body, styles.fill, { color: t.ink }]}>
                  {item.label}
                </Text>
                {pending === `${item.provider}/${item.model}` ? (
                  <ActivityIndicator color={t.muted} size="small" />
                ) : item.current ? (
                  <Feather color={t.accent} name="check" size={20} />
                ) : null}
              </Pressable>
            )}
            renderSectionHeader={({ section }) => (
              <Text style={[type.small, styles.section, { backgroundColor: t.bg, color: t.muted }]}>{section.name}</Text>
            )}
            sections={shown}
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
  block: { paddingHorizontal: space.lg, gap: space.sm },
  levels: { flexDirection: 'row', padding: 3, borderRadius: radius.md },
  level: { flex: 1, minHeight: TOUCH - 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md - 3 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TOUCH,
    margin: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md
  },
  failure: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  list: { paddingBottom: space.xl, flexGrow: 1 },
  section: { fontWeight: '700', paddingHorizontal: space.lg, paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 4, paddingHorizontal: space.lg }
})
