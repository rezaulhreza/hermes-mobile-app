import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { currentTodo, type Helper, helperEnded, helperStatusWord, NO_WORK, type Todo, workSummary } from '@/core/work'
import { $work, helperTail, loadHelpers, steerHelper, stopHelper } from '@/store/work'
import { MONO, type Palette, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Markdown } from './markdown'
import { Button, IconButton, type IconName } from './ui'

const TODO_ICON: Record<Todo['status'], IconName> = { pending: 'circle', in_progress: 'play-circle', completed: 'check-circle', cancelled: 'slash' }

function todoColour(status: Todo['status'], t: Palette): string {
  return status === 'completed' ? t.green : status === 'in_progress' ? t.accent : t.muted
}

/**
 * One line above the message field while the agent has a plan or helpers:
 * how far the plan is, and the step it is on. A tap opens the whole of it.
 */
export function WorkStrip({ sessionId }: { sessionId: string }) {
  const t = useTheme()
  const work = useStore($work)[sessionId] ?? NO_WORK
  const [open, setOpen] = useState(false)
  const summary = workSummary(work)

  if (!summary) {
    return null
  }

  const step = currentTodo(work)

  return (
    <>
      <Pressable accessibilityHint="Shows the plan and the helpers" accessibilityLabel="Plan and helpers" accessibilityRole="button" onPress={() => setOpen(true)} style={[styles.strip, { backgroundColor: t.soft }]}>
        <Feather color={t.accent} name="list" size={16} />
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.small, { color: t.ink, fontWeight: '700' }]}>
            {summary}
          </Text>
          {step ? (
            <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
              {step.content}
            </Text>
          ) : null}
        </View>
        <Feather color={t.muted} name="chevron-up" size={18} />
      </Pressable>
      {open ? <WorkSheet onClose={() => setOpen(false)} sessionId={sessionId} /> : null}
    </>
  )
}

function WorkSheet({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const work = useStore($work)[sessionId] ?? NO_WORK
  const [helperId, setHelperId] = useState<string | null>(null)
  const helper = work.helpers.find(known => known.id === helperId)

  // The events give most of it. The host knows which helper still takes a message.
  useEffect(() => {
    void loadHelpers(sessionId).catch(() => undefined)
  }, [sessionId])

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          {helper ? <IconButton icon="chevron-left" label="Back to the plan" onPress={() => setHelperId(null)} /> : null}
          <Text numberOfLines={1} style={[type.heading, styles.fill, { color: t.ink }]}>
            {helper ? 'Helper' : 'Plan and helpers'}
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        {helper ? (
          <HelperDetail helper={helper} sessionId={sessionId} />
        ) : (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.lg }]}>
            {work.todos.length ? (
              <View style={styles.group}>
                <Text style={[type.small, styles.groupTitle, { color: t.muted }]}>Plan</Text>
                {work.todos.map(todo => (
                  <View key={todo.id} style={styles.todo}>
                    <Feather color={todoColour(todo.status, t)} name={TODO_ICON[todo.status]} size={18} style={styles.todoIcon} />
                    <Text
                      style={[
                        type.body,
                        styles.fill,
                        { color: todo.status === 'pending' ? t.muted : t.ink },
                        todo.status === 'cancelled' && styles.struck,
                        todo.status === 'in_progress' && styles.strong
                      ]}
                    >
                      {todo.content}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {work.helpers.length ? (
              <View style={styles.group}>
                <Text style={[type.small, styles.groupTitle, { color: t.muted }]}>Helpers</Text>
                {work.helpers.map(known => (
                  <Pressable
                    accessibilityHint="Shows what this helper does"
                    accessibilityLabel={known.goal}
                    accessibilityRole="button"
                    key={known.id}
                    onPress={() => setHelperId(known.id)}
                    style={({ pressed }) => [styles.helper, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line, marginLeft: Math.min(known.depth, 3) * space.md }]}
                  >
                    <View style={styles.fill}>
                      <Text numberOfLines={2} style={[type.label, { color: t.ink }]}>
                        {known.goal}
                      </Text>
                      <Text numberOfLines={1} style={[type.small, { color: helperColour(known, t) }]}>
                        {helperLine(known)}
                      </Text>
                    </View>
                    <Feather color={t.muted} name="chevron-right" size={18} />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  )
}

function helperColour(helper: Helper, t: Palette): string {
  return helper.status === 'running' ? t.accent : helper.status === 'completed' ? t.green : helper.status === 'queued' ? t.muted : t.red
}

function helperLine(helper: Helper): string {
  const parts = [helperStatusWord(helper.status)]

  if (!helperEnded(helper) && helper.activity) {
    parts.push(helper.activity)
  } else if (helper.toolCount) {
    parts.push(`${helper.toolCount} ${helper.toolCount === 1 ? 'action' : 'actions'}`)
  }

  return parts.join(' · ')
}

/** One helper: what it was asked, what it does (its own conversation, newest lines), a message to it, and Stop. */
function HelperDetail({ sessionId, helper }: { sessionId: string; helper: Helper }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [tail, setTail] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const ended = helperEnded(helper)

  useEffect(() => {
    let cancelled = false
    const read = () => helperTail(sessionId, helper.id).then(next => !cancelled && setTail(next), () => undefined)

    void read()

    // A helper that ended has said its last line.
    const timer = ended ? null : setInterval(read, 2000)

    return () => {
      cancelled = true

      if (timer) {
        clearInterval(timer)
      }
    }
  }, [sessionId, helper.id, ended])

  const send = () => {
    const words = text.trim()

    if (!words) {
      return
    }

    setText('')
    steerHelper(sessionId, helper.id, words).then(
      taken => setNote(taken ? 'Sent. The helper reads it after its current action.' : 'The helper no longer takes a message.'),
      error => setNote(error instanceof Error ? error.message : String(error))
    )
  }

  return (
    <View style={[styles.fill, { paddingBottom: insets.bottom + space.md }]}>
      <ScrollView contentContainerStyle={styles.body} style={styles.fill}>
        <Text style={[type.body, { color: t.ink }]}>{helper.goal}</Text>
        <Text style={[type.small, { color: helperColour(helper, t) }]}>
          {[helperLine(helper), helper.model, helper.durationS ? `${Math.round(helper.durationS)} s` : ''].filter(Boolean).join(' · ')}
        </Text>

        {helper.summary ? (
          <View style={styles.group}>
            <Text style={[type.small, styles.groupTitle, { color: t.muted }]}>Report</Text>
            <Markdown text={helper.summary} />
          </View>
        ) : null}

        {/* The host drops the lines of a helper that ended. Its report is what is left. */}
        {ended && !tail ? null : (
          <View style={styles.group}>
            <Text style={[type.small, styles.groupTitle, { color: t.muted }]}>Its work, newest lines</Text>
            <Text selectable style={[styles.tail, { color: t.ink, backgroundColor: t.soft }]}>
              {tail === null ? 'The host has no lines for this helper yet.' : tail || 'Nothing yet.'}
            </Text>
          </View>
        )}
      </ScrollView>

      {ended ? null : (
        <View style={[styles.actions, { borderTopColor: t.line }]}>
          {note ? <Text style={[type.small, { color: t.muted }]}>{note}</Text> : null}
          <View style={styles.sendRow}>
            <TextInput
              accessibilityLabel="Message to the helper"
              editable={helper.acceptsSteer}
              onChangeText={setText}
              onSubmitEditing={send}
              placeholder={helper.acceptsSteer ? 'Tell this helper something' : 'This helper is past its last action'}
              placeholderTextColor={t.muted}
              returnKeyType="send"
              style={[type.body, styles.input, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
              value={text}
            />
            <IconButton disabled={!text.trim() || !helper.acceptsSteer} filled icon="arrow-up" label="Send to the helper" onPress={send} />
          </View>
          <Button
            icon="square"
            label="Stop this helper"
            onPress={() => stopHelper(sessionId, helper.id).then(found => setNote(found ? 'Stopping.' : 'The helper is gone already.'), () => undefined)}
            tone="danger"
          />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strong: { fontWeight: '700' },
  struck: { textDecorationLine: 'line-through' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.md, marginBottom: space.xs, paddingHorizontal: space.md, minHeight: TOUCH, borderRadius: radius.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { padding: space.lg, gap: space.lg },
  group: { gap: space.sm },
  groupTitle: { fontWeight: '700' },
  todo: { flexDirection: 'row', gap: space.md },
  todoIcon: { marginTop: 3 },
  helper: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  tail: { fontFamily: MONO, fontSize: 13, lineHeight: 19, padding: space.md, borderRadius: radius.md, overflow: 'hidden' },
  actions: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth }
})
