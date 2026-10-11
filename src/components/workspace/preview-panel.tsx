import { useMemo, useRef, useState } from 'react'
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native'
import { WebView } from 'react-native-webview'

import { isLoopbackUrl, previewAddress } from '@/core/preview/browser'
import { previewTarget } from '@/core/workspace'
import { currentApi } from '@/store/link'
import { MONO, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton, Notice } from '../ui'

/**
 * A page of the project, in the phone: a server on the host (a port is
 * enough) or any web address. A server on the host loads through the
 * backend's preview route, with the sign-in of the app.
 */
export function PreviewPanel({ bottom }: { bottom: number }) {
  const t = useTheme()
  const web = useRef<WebView>(null)
  const [typed, setTyped] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // Where the page is now, after the links the user followed.
  const [nav, setNav] = useState({ back: false, forward: false, address: '' })

  const source = useMemo(() => {
    const api = currentApi()

    if (!url || !api) {
      return null
    }

    const uri = previewAddress(api.workspace.baseUrl, url)

    // The access proxy in front of the host needs its headers. Another site must not get them.
    return uri.startsWith(api.workspace.baseUrl) ? { uri, headers: api.workspace.headers } : { uri }
  }, [url])

  const go = () => {
    setFailure(null)
    setUrl(previewTarget(typed))
  }

  return (
    <View style={[styles.fill, { paddingBottom: bottom }]}>
      <View style={[styles.bar, { borderBottomColor: t.line }]}>
        <TextInput
          accessibilityLabel="Address or port"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onChangeText={setTyped}
          onSubmitEditing={go}
          placeholder="A port on the host (3000) or an address"
          placeholderTextColor={t.muted}
          returnKeyType="go"
          style={[styles.input, { color: t.ink, backgroundColor: t.soft }]}
          value={typed}
        />
        <IconButton disabled={!typed.trim()} icon="arrow-right" label="Open the address" onPress={go} />
      </View>
      {source ? (
        <View style={[styles.nav, { borderBottomColor: t.line }]}>
          <IconButton disabled={!nav.back} icon="chevron-left" label="Page back" onPress={() => web.current?.goBack()} />
          <IconButton disabled={!nav.forward} icon="chevron-right" label="Page forward" onPress={() => web.current?.goForward()} />
          <IconButton icon="rotate-cw" label="Load the page again" onPress={() => (setFailure(null), web.current?.reload())} />
          <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
            {url && isLoopbackUrl(url) ? url : nav.address || url}
          </Text>
          {/* A server on the host has no address the phone's own browser can reach. */}
          {url && !isLoopbackUrl(url) ? (
            <IconButton icon="external-link" label="Open in the browser" onPress={() => void Linking.openURL(nav.address || url)} />
          ) : null}
        </View>
      ) : null}
      {source ? (
        failure ? (
          <Notice detail={failure} icon="cloud-off" title="The page did not load" />
        ) : (
          <WebView
            allowsBackForwardNavigationGestures
            onError={event => setFailure(event.nativeEvent.description)}
            onNavigationStateChange={state => setNav({ back: state.canGoBack, forward: state.canGoForward, address: state.url ?? '' })}
            onHttpError={event => event.nativeEvent.statusCode >= 500 && setFailure(`The host answered ${event.nativeEvent.statusCode}. Is the server running?`)}
            ref={web}
            // The session cookie of the app must reach the preview route.
            sharedCookiesEnabled
            source={source}
            style={{ backgroundColor: t.bg }}
          />
        )
      ) : (
        <View style={styles.fill}>
          <Notice detail="Start the server in the Terminal panel, then type its port here." icon="globe" title="Look at a page of the project" />
          <Text style={[type.small, styles.hint, { color: t.muted }]}>The page the agent opens for you shows in its chat.</Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  nav: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingBottom: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, fontFamily: MONO, fontSize: 14 },
  hint: { textAlign: 'center', padding: space.lg }
})
