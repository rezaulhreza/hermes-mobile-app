import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, type LayoutChangeEvent, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'

import { clampPan, clampZoom, dragPoints, fitScale, followPan, movePointer, picturePoint, SCREEN_KEYS, screenProblem, scrollSteps, type Size, tapPoint } from '@/core/screen'
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
  type ScreenTarget,
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

/** How one finger acts on the picture while the user holds the screen. */
type FingerMode = 'trackpad' | 'touch'

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
  const [mode, setMode] = useState<FingerMode>('trackpad')

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
              {frame?.app || (frame && frame.pid === null ? 'The whole screen' : 'Screen')}
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

        <Picture held={Boolean(hold)} mode={mode} onInput={act} />

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
                <Text style={[type.small, styles.fill, { color: t.muted }]}>You have the screen. Hermes waits.</Text>
                <ModeSwitch mode={mode} onChange={setMode} />
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

/**
 * The picture and the touches on it. It alone reads the picture, which changes every second.
 *
 * Two fingers make the picture larger. While the user holds the screen, one
 * finger acts in the window in one of two modes:
 * - Trackpad: the finger moves a pointer that the phone draws, a tap clicks at
 *   the pointer, a tap with two fingers is a right click and a move of two
 *   fingers scrolls. The enlarged picture follows the pointer.
 * - Touch: a tap clicks under the finger, a long press is a right click, a
 *   move is a drag, and two fingers move the enlarged picture.
 */
function Picture({ held, mode, onInput }: { held: boolean; mode: FingerMode; onInput: (input: ScreenInput) => void }) {
  const t = useTheme()
  const picture = useStore($screenPicture)
  const { frame, problem } = useStore($screen)
  const [box, setBox] = useState<Size>({ width: 0, height: 0 })
  const [zoomed, setZoomed] = useState(false)
  const scale = useSharedValue(1)
  const startScale = useSharedValue(1)
  const moveX = useSharedValue(0)
  const moveY = useSharedValue(0)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)
  // The pointer of trackpad mode, in pixels of the window. `ring` runs from 0 to 1 after a click.
  const pointerX = useSharedValue(0)
  const pointerY = useSharedValue(0)
  const ring = useSharedValue(1)
  const scrolled = useSharedValue(0)
  // The window can be acted in: the user holds the screen and the picture is one window, not the whole screen.
  const acts = held && frame !== null && frame.pid !== null
  const trackpad = acts && mode === 'trackpad'
  const frameWidth = frame?.width ?? 0
  const frameHeight = frame?.height ?? 0
  const windowKey = frame ? `${frame.pid}:${frame.window_id}` : ''

  // A new window starts with the pointer in its middle.
  useEffect(() => {
    pointerX.set(frameWidth / 2)
    pointerY.set(frameHeight / 2)
    // Only a new window moves the pointer, not a new size of the same window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey])

  const touch = (action: 'click' | 'right_click') => (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    const point = frame && tapPoint(box, frame, { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY })

    if (point) {
      onInput({ action, ...point })
    }
  }

  const drag = (fromX: number, fromY: number, toX: number, toY: number) => {
    const points = frame && dragPoints(box, frame, { x: fromX, y: fromY }, { x: toX, y: toY })

    if (points) {
      onInput({ action: 'drag', ...points })
    }
  }

  const clickAt = (action: 'click' | 'right_click', x: number, y: number) => onInput({ action, x: Math.round(x), y: Math.round(y) })

  const scrollAt = (direction: 'up' | 'down', amount: number, x: number, y: number) => onInput({ action: 'scroll', direction, amount, x: Math.round(x), y: Math.round(y) })

  const fit = () => {
    scale.set(withTiming(1))
    moveX.set(withTiming(0))
    moveY.set(withTiming(0))
    setZoomed(false)
  }

  const gestures = useMemo(() => {
    const size = { width: frameWidth, height: frameHeight }

    // In trackpad mode the enlarged picture moves so that the pointer stays on the screen.
    const follow = () => {
      'worklet'

      if (!trackpad || scale.get() <= 1.01) {
        return
      }

      const at = picturePoint(box, size, { x: pointerX.get(), y: pointerY.get() })

      moveX.set(followPan(moveX.get(), at.x, box.width, scale.get(), 48))
      moveY.set(followPan(moveY.get(), at.y, box.height, scale.get(), 48))
    }

    const pinch = Gesture.Pinch()
      .onStart(() => {
        startScale.set(scale.get())
      })
      .onUpdate(event => {
        scale.set(clampZoom(startScale.get() * event.scale))
        moveX.set(clampPan(moveX.get(), box.width, scale.get()))
        moveY.set(clampPan(moveY.get(), box.height, scale.get()))
        follow()
      })
      .onEnd(() => {
        runOnJS(setZoomed)(scale.get() > 1.01)
      })

    if (!trackpad) {
      const move = Gesture.Pan()
        .minPointers(2)
        .onStart(() => {
          startX.set(moveX.get())
          startY.set(moveY.get())
        })
        .onUpdate(event => {
          moveX.set(clampPan(startX.get() + event.translationX, box.width, scale.get()))
          moveY.set(clampPan(startY.get() + event.translationY, box.height, scale.get()))
        })

      return Gesture.Simultaneous(pinch, move)
    }

    const fitted = fitScale(box, size)

    const point = Gesture.Pan()
      .maxPointers(1)
      .minDistance(2)
      .onChange(event => {
        const next = movePointer({ x: pointerX.get(), y: pointerY.get() }, event.changeX, event.changeY, size, fitted * scale.get())

        pointerX.set(next.x)
        pointerY.set(next.y)
        follow()
      })

    const press = (action: 'click' | 'right_click', fingers: number) =>
      Gesture.Tap()
        .minPointers(fingers)
        .maxDuration(300)
        .onEnd((_event, done) => {
          if (done) {
            ring.set(0)
            ring.set(withTiming(1, { duration: 420 }))
            runOnJS(clickAt)(action, pointerX.get(), pointerY.get())
          }
        })

    const scroll = Gesture.Pan()
      .minPointers(2)
      .onStart(() => {
        scrolled.set(0)
      })
      .onChange(event => {
        const travel = scrolled.get() + event.changeY
        const step = scrollSteps(travel)

        scrolled.set(step ? step.rest : travel)

        if (step) {
          runOnJS(scrollAt)(step.direction, step.amount, pointerX.get(), pointerY.get())
        }
      })

    return Gesture.Race(Gesture.Simultaneous(pinch, scroll), point, Gesture.Exclusive(press('right_click', 2), press('click', 1)))
    // `clickAt` and `scrollAt` send through `onInput`, which only posts the input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackpad, box.width, box.height, frameWidth, frameHeight, scale, startScale, moveX, moveY, startX, startY, pointerX, pointerY, ring, scrolled])

  // Touch mode: one finger that moves is a drag in the window. It starts after a clear move, so a tap stays a tap.
  const dragging = useMemo(
    () =>
      Gesture.Pan()
        .enabled(acts && !trackpad)
        .maxPointers(1)
        .minDistance(14)
        .onEnd((event, done) => {
          if (done) {
            runOnJS(drag)(event.x - event.translationX, event.y - event.translationY, event.x, event.y)
          }
        }),
    // `drag` reads the box and the frame of this draw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acts, trackpad, box.width, box.height, frame?.width, frame?.height]
  )

  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: moveX.get() }, { translateY: moveY.get() }, { scale: scale.get() }] }))

  // The pointer keeps its size at any zoom: it is drawn inside the enlarged picture and made smaller by the same amount.
  const pointerStyle = useAnimatedStyle(() => {
    const at = picturePoint(box, { width: frameWidth, height: frameHeight }, { x: pointerX.get(), y: pointerY.get() })

    return { left: at.x, top: at.y, transform: [{ scale: 1 / scale.get() }] }
  }, [box.width, box.height, frameWidth, frameHeight])

  // The ring is inside the pointer, which already keeps its size at any zoom.
  const ringStyle = useAnimatedStyle(() => ({ opacity: 1 - ring.get(), transform: [{ scale: 0.4 + ring.get() }] }))

  return (
    // A gesture inside a Modal needs a root of its own on iOS.
    <GestureHandlerRootView style={[styles.fill, styles.clip, { backgroundColor: t.soft }]}>
      {picture ? (
        <GestureDetector gesture={gestures}>
          <View onLayout={(event: LayoutChangeEvent) => setBox(event.nativeEvent.layout)} style={styles.fill}>
            <GestureDetector gesture={dragging}>
              <Animated.View style={[styles.fill, moved]}>
                <Pressable
                  accessibilityHint={
                    trackpad ? 'Move one finger to move the pointer. Tap to click at the pointer.' : acts ? 'Tap to click in the window. Hold for a right click. Move one finger to drag.' : 'Use two fingers to make it larger.'
                  }
                  accessibilityLabel="The window on the host"
                  delayLongPress={450}
                  disabled={!acts || trackpad}
                  onLongPress={touch('right_click')}
                  onPress={touch('click')}
                  style={styles.fill}
                >
                  <Image fadeDuration={0} resizeMode="contain" source={{ uri: picture }} style={styles.fill} />
                </Pressable>
                {trackpad ? (
                  <Animated.View pointerEvents="none" style={[styles.pointer, pointerStyle]}>
                    <Animated.View style={[styles.ring, { borderColor: t.accentFill }, ringStyle]} />
                    <Svg height={26} viewBox="0 0 22 26" width={22}>
                      <Path d="M2 2 L2 21 L7 16.5 L10.6 24 L13.6 22.7 L10.1 15.4 L17 15.4 Z" fill="#ffffff" stroke="#14171c" strokeLinejoin="round" strokeWidth={1.6} />
                    </Svg>
                  </Animated.View>
                ) : null}
              </Animated.View>
            </GestureDetector>
          </View>
        </GestureDetector>
      ) : (
        <View style={styles.empty}>
          {problem ? <Feather color={t.muted} name="monitor" size={28} /> : <ActivityIndicator color={t.muted} />}
          {problem ? <Text style={[type.body, { color: t.muted, textAlign: 'center' }]}>{problem}</Text> : null}
        </View>
      )}
      {zoomed ? (
        <View style={styles.fit}>
          <IconButton icon="minimize-2" label="Show the whole picture" onPress={fit} soft />
        </View>
      ) : null}
    </GestureHandlerRootView>
  )
}

/** Trackpad or touch: how one finger acts on the picture. */
function ModeSwitch({ mode, onChange }: { mode: FingerMode; onChange: (mode: FingerMode) => void }) {
  const t = useTheme()
  const options: { value: FingerMode; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
    { value: 'trackpad', label: 'Trackpad', icon: 'mouse-pointer' },
    { value: 'touch', label: 'Touch', icon: 'crosshair' }
  ]

  return (
    <View accessibilityRole="radiogroup" style={[styles.modes, { backgroundColor: t.soft }]}>
      {options.map(option => {
        const on = option.value === mode

        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            hitSlop={6}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.mode, on && { backgroundColor: t.accentFill }]}
          >
            <Feather color={on ? t.onAccent : t.muted} name={option.icon} size={14} />
            <Text style={[type.small, styles.strong, { color: on ? t.onAccent : t.muted }]}>{option.label}</Text>
          </Pressable>
        )
      })}
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

function WindowSheet({ visible, onPick, onClose }: { visible: boolean; onPick: (target: ScreenTarget) => void; onClose: () => void }) {
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
          ListHeaderComponent={
            <>
              <WindowRow label="The window Hermes works in" onPress={() => onPick(null)} title="Follows the agent of this chat" />
              <WindowRow label="The whole screen" onPress={() => onPick('whole')} title="Every window, to look at. Choose one window to act in it." />
            </>
          }
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
  clip: { overflow: 'hidden' },
  fit: { position: 'absolute', right: space.md, bottom: space.md },
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
  hide: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  // The tip of the arrow is at (2, 2) of its drawing, and the scale for the zoom works from the tip.
  pointer: { position: 'absolute', width: 22, height: 26, marginLeft: -2, marginTop: -2, transformOrigin: '2px 2px' },
  ring: { position: 'absolute', left: -15, top: -15, width: 34, height: 34, borderRadius: 17, borderWidth: 2 },
  modes: { flexDirection: 'row', gap: 2, padding: 2, borderRadius: radius.pill },
  mode: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32, paddingHorizontal: space.md, borderRadius: radius.pill }
})
