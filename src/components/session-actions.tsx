import { Feather } from '@expo/vector-icons'
import { type ComponentProps, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type SessionAction, sessionActions, type SessionRow, sessionTitle } from '@/core/sessions'
import { $selectedSessions, branchSession, deleteSession, exportSession, exportSessionText, updateSession } from '@/store/sessions'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button } from './ui'

interface Props {
  /** The conversation the sheet is for. Null closes the sheet. */
  row: SessionRow | null
  onClose: () => void
  /** A branch was made. The caller opens it. */
  onBranched: (storedId: string) => void
  /** The title changed. A screen that shows the conversation has its own copy of the title. */
  onRenamed?: (title: string) => void
  /** The conversation is gone, deleted or archived. A screen that shows it must leave. */
  onRemoved?: () => void
  /** Actions of the screen that opened the sheet, above the actions of the conversation. The sheet closes first. */
  /** The sheet opened from the list: the user can mark more rows from there. */
  canSelect?: boolean
  extra?: readonly { icon: ComponentProps<typeof Feather>['name']; label: string; onPress: () => void }[]
}

/**
 * What the user can do with one conversation. It opens from a long press on a
 * row of the list and from the title of an open conversation, so the actions
 * are the same in both places.
 */
export function SessionActionsSheet({ row, onClose, onBranched, onRenamed, onRemoved, extra, canSelect }: Props) {
  if (!row) {
    return null
  }

  // A new conversation is a new sheet: no text or question from the last one stays.
  return <Sheet canSelect={canSelect} extra={extra} key={row.id} onBranched={onBranched} onClose={onClose} onRemoved={onRemoved} onRenamed={onRenamed} row={row} />
}

function Sheet({ row, onClose, onBranched, onRenamed, onRemoved, extra = [], canSelect }: Props & { row: SessionRow }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState<'list' | 'rename' | 'delete'>('list')
  const [title, setTitle] = useState(row.title?.trim() ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)

    try {
      await work()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const act = (action: SessionAction) => {
    switch (action.id) {
      case 'rename':
      case 'delete':
        return setStep(action.id)

      case 'pin':
        return run(async () => {
          await updateSession(row, { pinned: !row.pinned })
          onClose()
        })

      case 'archive':
        return run(async () => {
          await updateSession(row, { archived: !row.archived })
          onClose()
          onRemoved?.()
        })

      case 'branch':
        return run(async () => {
          const storedId = await branchSession(row)

          onClose()
          onBranched(storedId)
        })

      case 'select':
        $selectedSessions.set([row.id])

        return onClose()

      case 'export':
      case 'export-text':
        return run(async () => {
          const uri = await (action.id === 'export' ? exportSession(row) : exportSessionText(row))

          // The share sheet takes a file address on iOS only. Android gets the address as text.
          await Share.share(Platform.OS === 'ios' ? { url: uri } : { message: uri })
        })
    }
  }

  const rename = () =>
    run(async () => {
      await updateSession(row, { title: title.trim() })
      onRenamed?.(title.trim())
      onClose()
    })

  const remove = () =>
    run(async () => {
      await deleteSession(row)
      onClose()
      onRemoved?.()
    })

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable accessibilityLabel="Close the actions" onPress={onClose} style={styles.backdrop} />
        <View style={[styles.sheet, { backgroundColor: t.bg, paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <View style={[styles.grabber, { backgroundColor: t.line }]} />
          <Text numberOfLines={2} style={[type.label, styles.title, { color: t.ink }]}>
            {sessionTitle(row)}
          </Text>

          {problem ? <Text style={[type.small, styles.problem, { color: t.red, backgroundColor: t.redBg }]}>{problem}</Text> : null}

          {step === 'rename' ? (
            <View style={styles.form}>
              <TextInput
                accessibilityLabel="Title"
                autoFocus
                onChangeText={setTitle}
                onSubmitEditing={rename}
                placeholder="Title"
                placeholderTextColor={t.muted}
                returnKeyType="done"
                selectTextOnFocus
                style={[styles.field, type.body, { color: t.ink, backgroundColor: t.soft }]}
                value={title}
              />
              <View style={styles.buttons}>
                <Button label="Cancel" onPress={() => setStep('list')} style={styles.fill} />
                <Button busy={busy} disabled={!title.trim()} label="Save" onPress={rename} style={styles.fill} tone="primary" />
              </View>
            </View>
          ) : step === 'delete' ? (
            <View style={styles.form}>
              <Text style={[type.body, { color: t.ink }]}>Delete this conversation and all its messages? This cannot be undone.</Text>
              <View style={styles.buttons}>
                <Button label="Keep it" onPress={() => setStep('list')} style={styles.fill} />
                <Button busy={busy} label="Delete" onPress={remove} style={styles.fill} tone="danger" />
              </View>
            </View>
          ) : (
            <>
            {extra.map(action => (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                key={action.label}
                onPress={() => {
                  onClose()
                  action.onPress()
                }}
                style={({ pressed }) => [styles.action, pressed && { backgroundColor: t.soft }, busy && styles.dim]}
              >
                <Feather color={t.muted} name={action.icon} size={20} />
                <Text style={[type.body, styles.fill, { color: t.ink }]}>{action.label}</Text>
              </Pressable>
            ))}
            {sessionActions(row).filter(action => action.id !== 'select' || canSelect).map(action => (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                key={action.id}
                onPress={() => act(action)}
                style={({ pressed }) => [styles.action, pressed && { backgroundColor: t.soft }, busy && styles.dim]}
              >
                <Feather color={action.danger ? t.red : t.muted} name={action.icon} size={20} />
                <Text style={[type.body, styles.fill, { color: action.danger ? t.red : t.ink }]}>{action.label}</Text>
              </Pressable>
            ))}
            </>
          )}

          {busy && step === 'list' ? <ActivityIndicator color={t.muted} style={styles.spinner} /> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { opacity: 0.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: space.sm },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: space.md },
  title: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  problem: { marginHorizontal: space.lg, marginBottom: space.sm, padding: space.md, borderRadius: radius.md },
  action: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 6, paddingHorizontal: space.lg },
  form: { gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm },
  field: { minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md },
  buttons: { flexDirection: 'row', gap: space.md },
  spinner: { position: 'absolute', top: space.lg, right: space.lg }
})
