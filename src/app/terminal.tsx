import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useFocusEffect } from 'expo-router'
import { setStatusBarStyle } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Appearance, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { TerminalView, type TerminalViewHandle } from '@/components/terminal/terminal-view'
import { newShellId, SHELL_KEYS, type ShellInfo, shellLabel, withControl } from '@/core/shell'
import { tap } from '@/native/haptics'
import { $shells, closeShell, connectShell, type ShellEnd, type ShellLink, loadShells } from '@/store/shell'
import { $root } from '@/store/workspace'
import { dark, MONO, radius, space, type } from '@/theme/tokens'
import { useKeyboardOpen } from '@/theme/use-keyboard'

/** A terminal is dark in both appearances. */
const c = dark

const END_WORDS: Record<ShellEnd, string> = {
  ended: 'The shell ended.',
  lost: 'The connection to the host was lost. The shell still runs there.',
  refused: 'The host did not open a shell. It needs the phone-shell plugin: run host/setup.sh on the host.'
}

/**
 * Terminal mode: a login shell on the host, in a real terminal. The shell
 * keeps running when this screen closes; the next visit shows what it wrote
 * meanwhile. It opens from the Workspace tab in every state.
 */
export default function TerminalScreen() {
  const insets = useSafeAreaInsets()
  const keyboardOpen = useKeyboardOpen()
  const shells = useStore($shells)
  const root = useStore($root)
  const view = useRef<TerminalViewHandle>(null)
  const link = useRef<ShellLink | null>(null)
  const size = useRef<{ cols: number; rows: number } | null>(null)
  // A shell made on this screen that the host does not list yet.
  const [fresh, setFresh] = useState<ShellInfo[]>([])
  const [current, setCurrent] = useState<string | null>(null)
  const [end, setEnd] = useState<ShellEnd | null>(null)
  const [ctrl, setCtrl] = useState(false)
  const [ending, setEnding] = useState(false)
  const [attempt, setAttempt] = useState(0)

  // Light status bar text on the dark terminal, and the app's own style again when it closes.
  // A <StatusBar> element here kept the light text on the screen under it.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light')

      // After the slide out: during it the terminal is still the top screen, and its style wins.
      // 'auto' does not undo an explicit style, so the style of the appearance is named.
      return () => setTimeout(() => setStatusBarStyle(Appearance.getColorScheme() === 'dark' ? 'light' : 'dark', true), 350)
    }, [])
  )

  const listed = [...shells, ...fresh.filter(shell => !shells.some(known => known.id === shell.id))]
  const shell = listed.find(known => known.id === current) ?? null

  const startShell = useCallback(() => {
    const made: ShellInfo = { id: newShellId(), cwd: $root.get(), started: null }

    setFresh(list => [...list, made])
    setCurrent(made.id)
  }, [])

  // The shells the host runs: the one in the open folder first, else the newest. None: a new one.
  useEffect(() => {
    loadShells()
      .then(found => {
        if (!found.length) {
          startShell()
        } else {
          setCurrent((found.find(known => known.cwd === $root.get()) ?? found[found.length - 1]).id)
        }
      })
      .catch(() => setEnd('refused'))
  }, [startShell])

  // One socket, for the shell on screen. It closes with the screen; the shell does not.
  useEffect(() => {
    if (!shell || !size.current) {
      return
    }

    let closed = false

    setEnd(null)
    view.current?.reset()
    connectShell(shell, size.current, base64 => view.current?.write(base64), why => !closed && setEnd(why))
      .then(made => {
        if (closed) {
          made.close()
        } else {
          link.current = made
          view.current?.focus()
          void loadShells().catch(() => undefined)
        }
      })
      .catch(() => !closed && setEnd('refused'))

    return () => {
      closed = true
      link.current?.close()
      link.current = null
    }
    // The shell is chosen by its id: a new list with the same shell must not reconnect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell?.id, attempt])

  const send = (text: string) => {
    link.current?.send(ctrl ? withControl(text) : text)

    if (ctrl) {
      setCtrl(false)
    }
  }

  const endShell = () => {
    const id = current

    setEnding(false)

    if (id) {
      link.current?.close()
      link.current = null
      setFresh(list => list.filter(known => known.id !== id))
      void closeShell(id)
        .catch(() => undefined)
        .finally(() => {
          const left = $shells.get().filter(known => known.id !== id)

          if (left.length) {
            setCurrent(left[left.length - 1].id)
          } else {
            startShell()
          }
        })
    }
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: c.bg }]}>
      <View style={styles.head}>
        {/* A small mark, not a button shape: the touch area is still 44 points with its slop. */}
        <Pressable accessibilityLabel="Leave terminal mode" accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.close}>
          <Feather color={c.muted} name="chevron-down" size={20} />
        </Pressable>
        <View style={styles.fill}>
          <Text style={[type.heading, { color: c.ink }]}>Terminal</Text>
          <Text ellipsizeMode="head" numberOfLines={1} style={[styles.mono, { color: c.muted }]}>
            {shell?.cwd ?? root ?? 'Home folder'}
          </Text>
        </View>
        <Pressable accessibilityLabel="New shell" accessibilityRole="button" hitSlop={8} onPress={() => (tap(), startShell())} style={styles.close}>
          <Feather color={c.ink} name="plus" size={20} />
        </Pressable>
      </View>

      {listed.length ? (
        <ScrollView contentContainerStyle={styles.tabs} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={styles.tabBar}>
          {listed.map(known => {
            const on = known.id === current

            return (
              <Pressable
                accessibilityHint={on ? 'Hold to end this shell' : undefined}
                accessibilityLabel={`Shell: ${shellLabel(known)}`}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                key={known.id}
                onLongPress={() => on && setEnding(true)}
                onPress={() => setCurrent(known.id)}
                style={[styles.tab, { backgroundColor: on ? c.soft : 'transparent' }]}
              >
                <View style={[styles.dot, { backgroundColor: on && !end ? c.accentFill : c.muted }]} />
                <Text numberOfLines={1} style={[styles.mono, { color: on ? c.ink : c.muted }]}>
                  {shellLabel(known)}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
      ) : null}

      {ending ? (
        <View style={[styles.banner, { backgroundColor: c.redBg }]}>
          <Text style={[type.small, styles.fill, { color: c.ink }]}>End this shell and every program in it?</Text>
          <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setEnding(false)}>
            <Text style={[type.small, { color: c.ink, fontWeight: '700' }]}>Keep</Text>
          </Pressable>
          <Pressable accessibilityRole="button" hitSlop={6} onPress={endShell}>
            <Text style={[type.small, { color: c.red, fontWeight: '700' }]}>End it</Text>
          </Pressable>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <View style={[styles.screen, { borderColor: c.line }]}>
          <TerminalView
            onInput={send}
            onReady={(cols, rows) => {
              size.current = { cols, rows }
              // The size is what the socket was waiting for.
              setAttempt(value => value + 1)
            }}
            onResize={(cols, rows) => {
              size.current = { cols, rows }
              link.current?.resize(cols, rows)
            }}
            ref={view}
          />
          {end ? (
            <View style={[styles.end, { backgroundColor: c.paper, borderColor: c.line }]}>
              <Text style={[type.small, styles.fill, { color: c.ink }]}>{END_WORDS[end]}</Text>
              {end === 'refused' ? null : (
                <Pressable accessibilityRole="button" hitSlop={6} onPress={() => (end === 'ended' ? startShell() : setAttempt(value => value + 1))}>
                  <Text style={[type.small, { color: c.accentFill, fontWeight: '700' }]}>{end === 'ended' ? 'New shell' : 'Reconnect'}</Text>
                </Pressable>
              )}
            </View>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={styles.keys}
          horizontal
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          style={[styles.keyBar, { paddingBottom: keyboardOpen ? space.xs : Math.max(insets.bottom, space.sm) }]}
        >
          <Pressable
            accessibilityLabel="Control"
            accessibilityRole="button"
            accessibilityState={{ selected: ctrl }}
            onPress={() => (tap(), setCtrl(value => !value))}
            style={[styles.key, { backgroundColor: ctrl ? c.accentFill : c.soft }]}
          >
            <Text style={[styles.keyText, { color: ctrl ? c.onAccent : c.ink }]}>ctrl</Text>
          </Pressable>
          {SHELL_KEYS.map(key => (
            <Pressable accessibilityLabel={key.name} accessibilityRole="button" key={key.name} onPress={() => (tap(), send(key.bytes))} style={[styles.key, { backgroundColor: c.soft }]}>
              <Text style={[styles.keyText, { color: c.ink }]}>{key.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  mono: { fontFamily: MONO, fontSize: 12 },
  tabBar: { flexGrow: 0 },
  tabs: { gap: space.xs, paddingHorizontal: space.md, paddingBottom: space.sm },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: space.md, borderRadius: radius.sm },
  dot: { width: 6, height: 6, borderRadius: 3 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginHorizontal: space.md, marginBottom: space.sm, padding: space.md, borderRadius: radius.md },
  screen: { flex: 1, marginHorizontal: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  end: { position: 'absolute', left: space.sm, right: space.sm, bottom: space.sm, flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  keyBar: { flexGrow: 0, paddingTop: space.sm },
  keys: { gap: 6, paddingHorizontal: space.sm },
  key: { minWidth: 40, height: 36, paddingHorizontal: space.sm + 2, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontFamily: MONO, fontSize: 13 }
})
