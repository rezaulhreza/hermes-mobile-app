import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, type LayoutChangeEvent, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SCREEN_KEYS, screenProblem, type Size, tapPoint } from '@/core/screen'
import {
  $screen,
  $screenHold,
  $screenPicture,
  $screenWindows,
  closeScreen,
  handScreenBack,
  loadScreenWindows,
  openScreen,
  type ScreenInput,
  sendScreenInput,
  showScreenWindow,
  takeScreen
} from '@/store/screen'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button, IconButton } from './ui'

interface Props {
  /** The live session: a stop goes to its running turn. */
  sessionId: string
  /** The stored id: the host finds the window that this chat's agent works in. */
  storedId: string
  visible: boolean
  onClose: () => void
}

/**
 * The agent's screen work, live: the window it works in, on the host. The
 * user can stop the agent with a reason and take the screen; taps, text and
 * keys then go to that window. "Hand back" lets the agent go on.
 */
export function ScreenView({ sessionId, storedId, visible, onClose }: Props) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { frame, problem } = useStore($screen)
  const hold = useStore($screenHold)
  const [reason, setReason] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  // The picture is asked for only while the view is open.
  useEffect(() => {
    if (!visible) {
      return
    }

    openScreen(storedId)

    return closeScreen
  }, [visible, storedId])

  const run = (work: () => Promise<string | null | void>) => {
    setBusy(true)
    setFault(null)
    work()
      .then(result => setFault(result ?? null))
      .catch(error => setFault(screenProblem(error)))
      .finally(() => setBusy(false))
  }

  const act = (input: ScreenInput) => run(() => sendScreenInput(input))

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen" visible={visible}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.fill, { backgroundColor: t.bg, paddingTop: insets.top }]}>
        <View style={styles.head}>
          <View style={styles.fill}>
            <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
              {frame?.app || 'Screen'}
            </Text>
            <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
              {frame?.title || (problem ? ' ' : 'Looking for the window…')}
            </Text>
          </View>
          <IconButton
            icon="layers"
            label="Choose a window"
            onPress={() => {
              setPicking(true)
              void loadScreenWindows().catch(error => setFault(screenProblem(error)))
            }}
          />
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <Picture held={Boolean(hold)} onInput={act} />

        {fault ? (
          <Text accessibilityRole="alert" style={[type.small, styles.fault, { color: t.red }]}>
            {fault}
          </Text>
        ) : null}

        <View style={[styles.foot, { borderTopColor: t.line, paddingBottom: Math.max(insets.bottom, space.md) }]}>
          {hold ? (
            <>
              <View style={styles.line}>
                <View style={[styles.dot, { backgroundColor: t.accent }]} />
                <Text style={[type.small, styles.fill, { color: t.muted }]}>You have the screen. Hermes waits. Tap the picture to click; hold for a right click.</Text>
              </View>
              <View style={styles.line}>
                <TextInput
                  accessibilityLabel="Text to type"
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setText}
                  onSubmitEditing={() => text && (act({ action: 'type', text }), setText(''))}
                  placeholder="Type on the host"
                  placeholderTextColor={t.muted}
                  returnKeyType="send"
                  style={[styles.input, type.body, { color: t.ink, backgroundColor: t.soft }]}
                  value={text}
                />
                <IconButton disabled={!text || busy} icon="send" label="Type the text" onPress={() => (act({ action: 'type', text }), setText(''))} />
              </View>
              <View style={styles.keys}>
                {SCREEN_KEYS.map(key => (
                  <KeyButton icon={key.icon} key={key.keys} label={key.label} onPress={() => act({ action: 'key', keys: key.keys })} />
                ))}
                <KeyButton icon="chevrons-up" label="Scroll up" onPress={() => act({ action: 'scroll', direction: 'up' })} />
                <KeyButton icon="chevrons-down" label="Scroll down" onPress={() => act({ action: 'scroll', direction: 'down' })} />
              </View>
              <View style={styles.line}>
                <Button busy={busy} label="Hand back" onPress={() => run(() => handScreenBack(sessionId, false))} style={styles.fill} />
                <Button busy={busy} label="Hand back and continue" onPress={() => run(() => handScreenBack(sessionId, true))} style={styles.fill} tone="primary" />
              </View>
            </>
          ) : (
            <>
              <TextInput
                accessibilityLabel="Reason for the stop"
                onChangeText={setReason}
                placeholder="Why do you stop it? (the agent is told)"
                placeholderTextColor={t.muted}
                style={[styles.input, styles.reason, type.body, { color: t.ink, backgroundColor: t.soft }]}
                value={reason}
              />
              <Button busy={busy} icon="pause-circle" label="Stop Hermes and take over" onPress={() => run(() => takeScreen(sessionId, reason).then(() => setReason('')))} tone="danger" />
            </>
          )}
        </View>
      </KeyboardAvoidingView>

      <WindowSheet
        onClose={() => setPicking(false)}
        onPick={target => {
          showScreenWindow(target)
          setPicking(false)
        }}
        visible={picking}
      />
    </Modal>
  )
}

/** The picture and the touches on it. It alone reads the picture, which changes every second. */
function Picture({ held, onInput }: { held: boolean; onInput: (input: ScreenInput) => void }) {
  const t = useTheme()
  const picture = useStore($screenPicture)
  const { frame, problem } = useStore($screen)
  const [box, setBox] = useState<Size>({ width: 0, height: 0 })

  const touch = (action: 'click' | 'right_click') => (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    const point = frame && tapPoint(box, frame, { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY })

    if (point) {
      onInput({ action, ...point })
    }
  }

  return (
    <View onLayout={(event: LayoutChangeEvent) => setBox(event.nativeEvent.layout)} style={[styles.fill, { backgroundColor: t.soft }]}>
      {picture ? (
        <Pressable
          accessibilityHint={held ? 'Tap to click in the window. Hold for a right click.' : undefined}
          accessibilityLabel="The window on the host"
          delayLongPress={450}
          disabled={!held}
          onLongPress={touch('right_click')}
          onPress={touch('click')}
          style={styles.fill}
        >
          <Image fadeDuration={0} resizeMode="contain" source={{ uri: picture }} style={styles.fill} />
        </Pressable>
      ) : (
        <View style={styles.empty}>
          {problem ? <Feather color={t.muted} name="monitor" size={28} /> : <ActivityIndicator color={t.muted} />}
          {problem ? <Text style={[type.body, { color: t.muted, textAlign: 'center' }]}>{problem}</Text> : null}
        </View>
      )}
    </View>
  )
}

function KeyButton({ icon, label, onPress }: { icon: React.ComponentProps<typeof Feather>['name']; label: string; onPress: () => void }) {
  const t = useTheme()

  return (
    <Pressable
      accessibilityLabel={`Key: ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.key, { backgroundColor: t.paper, borderColor: t.line }, pressed && styles.dim]}
    >
      <Feather color={t.ink} name={icon} size={18} />
    </Pressable>
  )
}

function WindowSheet({ visible, onPick, onClose }: { visible: boolean; onPick: (target: { pid: number; window_id: number } | null) => void; onClose: () => void }) {
  const t = useTheme()
  const windows = useStore($screenWindows)

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Windows on the host</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <FlatList
          ListHeaderComponent={<WindowRow label="The window Hermes works in" onPress={() => onPick(null)} title="Follows the agent of this chat" />}
          data={windows}
          keyExtractor={item => `${item.pid}:${item.window_id}`}
          renderItem={({ item }) => <WindowRow label={item.app} onPress={() => onPick(item)} title={item.title} />}
        />
      </View>
    </Modal>
  )
}

function WindowRow({ label, title, onPress }: { label: string; title: string; onPress: () => void }) {
  const t = useTheme()

  return (
    <Pressable
      accessibilityLabel={`Window: ${label} ${title}`.trim()}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.window, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
    >
      <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
        {label}
      </Text>
      {title ? (
        <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
          {title}
        </Text>
      ) : null}
    </Pressable>
  )
}

/** The row above the composer that says the agent used the screen, or that the user holds it, and opens the view. */
/** The strip over the message field. It shows while something happens on the screen; `onHide` puts it away, and the chat's menu still opens the view. */
export function ScreenPill({ working, onOpen, onHide }: { working: boolean; onOpen: () => void; onHide: () => void }) {
  const t = useTheme()
  const hold = useStore($screenHold)

  return (
    <View style={[styles.pill, { backgroundColor: hold ? t.accentBg : t.soft }]}>
      <Feather color={hold ? t.accent : working ? t.green : t.muted} name="monitor" size={16} />
      <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.ink }]}>
        <Text style={styles.strong}>Screen</Text>
        {hold ? '  You have it. Hermes waits.' : working ? '  Hermes works on the screen now.' : '  Hermes worked on the screen.'}
      </Text>
      <Button label={hold ? 'Open' : 'Watch'} onPress={onOpen} style={styles.open} />
      <Pressable accessibilityLabel="Hide the screen strip" accessibilityRole="button" hitSlop={10} onPress={onHide} style={styles.hide}>
        <Feather color={t.muted} name="x" size={16} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strong: { fontWeight: '700' },
  dim: { opacity: 0.6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  fault: { paddingHorizontal: space.lg, paddingTop: space.sm },
  foot: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  input: { flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md },
  reason: { flex: 0 },
  keys: { flexDirection: 'row', gap: space.xs },
  key: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  window: { minHeight: TOUCH + space.md, justifyContent: 'center', paddingHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginHorizontal: space.md, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs, borderRadius: radius.md },
  open: { minHeight: 36, paddingHorizontal: space.md },
  hide: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' }
})
