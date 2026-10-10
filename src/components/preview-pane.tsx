import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Linking, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

import { isLoopbackUrl, paneMessage, previewAddress, shortAddress } from '@/core/preview/browser'
import { $agentDriving, $humanControl, $previews, type Pane, registerPane, setHumanControl } from '@/store/browser'
import { currentApi } from '@/store/link'
import { radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button, IconButton } from './ui'

// A script that gets no answer in this time ran in a page that went away (a navigation).
const ANSWER_TIMEOUT_MS = 8000

interface Props {
  sessionId: string
  /** The pane covers the screen. When false it is off the screen, and the page stays alive for the agent. */
  open: boolean
  onClose: () => void
}

/**
 * The page the agent opened, in a WebView. The WebView stays mounted while the
 * conversation is on screen, also when the pane is closed: the agent reads and
 * drives the page through it, and a closed pane must not stop that work.
 *
 * "Take control" is for the moment the user wants to do a step by hand (type a
 * password, solve a puzzle). While the user holds the page the agent is told
 * to wait; "Hand back" lets it go on.
 */
export function PreviewPane({ sessionId, open, onClose }: Props) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const preview = useStore($previews)[sessionId]
  const human = useStore($humanControl)[sessionId] ?? false
  const driving = useStore($agentDriving)[sessionId] ?? false
  const web = useRef<WebView>(null)
  const waiting = useRef(new Map<string, (result: unknown) => void>())
  const [title, setTitle] = useState('')
  // Where the page is now. The agent or the user can leave the address the preview opened with.
  const [address, setAddress] = useState('')
  const [progress, setProgress] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    const pane: Pane = {
      run: (id, script) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            waiting.current.delete(id)
            reject(new Error('The page gave no answer.'))
          }, ANSWER_TIMEOUT_MS)

          waiting.current.set(id, result => {
            clearTimeout(timer)
            resolve(result)
          })
          web.current?.injectJavaScript(script)
        }),
      navigate: kind => (kind === 'back' ? web.current?.goBack() : kind === 'forward' ? web.current?.goForward() : web.current?.reload())
    }

    return registerPane(sessionId, pane)
  }, [sessionId])

  const source = useMemo(() => {
    const api = currentApi()

    if (!preview || !api) {
      return null
    }

    const uri = previewAddress(api.workspace.baseUrl, preview.url)

    // The access proxy in front of the host needs its headers on the first request. Another site must not get them.
    return uri.startsWith(api.workspace.baseUrl) ? { uri, headers: api.workspace.headers } : { uri }
  }, [preview])

  if (!preview || !source) {
    return null
  }

  return (
    <View
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      pointerEvents={open ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, { backgroundColor: t.bg, paddingTop: insets.top }, !open && { transform: [{ translateY: height }] }]}
    >
      <View style={[styles.bar, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-down" label="Close the preview" onPress={onClose} />
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {title || preview.label || 'Preview'}
          </Text>
          <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
            {shortAddress(isLoopbackUrl(preview.url) || !address ? preview.url : address)}
          </Text>
        </View>
        <IconButton icon="rotate-cw" label="Load the page again" onPress={() => web.current?.reload()} />
        {isLoopbackUrl(preview.url) ? null : (
          <IconButton icon="external-link" label="Open in the browser" onPress={() => void Linking.openURL(address || preview.url)} />
        )}
      </View>

      {progress > 0 && progress < 1 ? <View style={[styles.progress, { backgroundColor: t.accent, width: `${progress * 100}%` }]} /> : null}

      <View style={styles.fill}>
        <WebView
          allowsBackForwardNavigationGestures
          onError={event => setFailure(event.nativeEvent.description)}
          onLoadProgress={event => setProgress(event.nativeEvent.progress)}
          onLoadStart={() => setFailure(null)}
          onMessage={event => {
            const message = paneMessage(event.nativeEvent.data)

            if (message) {
              waiting.current.get(message.id)?.(message.result)
              waiting.current.delete(message.id)
            }
          }}
          onNavigationStateChange={state => {
            setTitle(state.title ?? '')
            setAddress(state.url ?? '')
          }}
          ref={web}
          // The session cookie of the app must reach the preview proxy.
          sharedCookiesEnabled
          source={source}
          style={{ backgroundColor: t.bg }}
        />
        {failure ? (
          <View style={[styles.failure, { backgroundColor: t.bg }]}>
            <Feather color={t.muted} name="cloud-off" size={28} />
            <Text style={[type.heading, { color: t.ink, textAlign: 'center' }]}>The page did not load</Text>
            <Text style={[type.body, { color: t.muted, textAlign: 'center' }]}>{failure}</Text>
            <Button label="Try again" onPress={() => web.current?.reload()} />
          </View>
        ) : null}
      </View>

      <View style={[styles.foot, { borderTopColor: t.line, paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <View style={[styles.dot, { backgroundColor: human ? t.accent : driving ? t.green : t.line }]} />
        <Text numberOfLines={2} style={[type.small, styles.fill, { color: t.muted }]}>
          {human ? 'You have the page. Hermes waits.' : driving ? 'Hermes is working in this page.' : 'Hermes can read and use this page.'}
        </Text>
        <Button
          label={human ? 'Hand back' : 'Take control'}
          onPress={() => setHumanControl(sessionId, !human)}
          style={styles.control}
          tone={human ? 'primary' : 'plain'}
        />
      </View>
    </View>
  )
}

/** The row above the composer that says a preview exists, and opens it. */
export function PreviewPill({ sessionId, onOpen }: { sessionId: string; onOpen: () => void }) {
  const t = useTheme()
  const preview = useStore($previews)[sessionId]
  const driving = useStore($agentDriving)[sessionId] ?? false

  if (!preview) {
    return null
  }

  return (
    <View style={[styles.pill, { backgroundColor: t.soft }]}>
      <Feather color={driving ? t.green : t.muted} name="globe" size={16} />
      <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.ink }]}>
        <Text style={styles.strong}>Preview</Text>
        {`  ${preview.label || shortAddress(preview.url)}`}
      </Text>
      <Button label="Open" onPress={onOpen} style={styles.open} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strong: { fontWeight: '700' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  progress: { height: 2 },
  failure: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  control: { minHeight: 40 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.md
  },
  open: { minHeight: 36, paddingHorizontal: space.md }
})
