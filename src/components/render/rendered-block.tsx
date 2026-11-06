import { memo, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import WebView, { type WebViewMessageEvent } from 'react-native-webview'

import { MONO, radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { KATEX_CSS, KATEX_JS, PELE_JS } from './render.generated'

type Kind = 'math' | 'diagram'

// Pele colours a diagram through these properties: each one takes a colour of the theme.
const DIAGRAM_COLOURS = ['bg', 'fg', 'muted', 'line', 'surface', 'surface-alt', 'border', 'accent', 'critical'] as const

/**
 * The page in the web view. It draws one block, then says its height (and a
 * fault, if the block cannot be drawn) to the app. Math labels in a diagram
 * are typeset by KaTeX, as on the desktop.
 */
function page(kind: Kind, source: string, colours: Record<string, string>, ink: string): string {
  const vars = DIAGRAM_COLOURS.map(name => `--pele-${name}:${colours[name]}`).join(';')

  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>${KATEX_CSS}
html,body{margin:0;padding:0;background:transparent;color:${ink};font:15px -apple-system,system-ui,sans-serif;-webkit-text-size-adjust:100%}
#out{display:inline-block;min-width:100%;box-sizing:border-box;padding:8px 2px}
#out svg{display:block;max-width:none;height:auto}
.katex-display{margin:0}</style></head>
<body><div id="out"></div>
<script>${KATEX_JS}</script>
<script>${kind === 'diagram' ? PELE_JS : ''}</script>
<script>
(function () {
  var out = document.getElementById('out')
  var say = function (message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)) }
  var size = function () { say({ height: Math.ceil(out.getBoundingClientRect().height), width: Math.ceil(out.scrollWidth) }) }
  var source = ${JSON.stringify(source)}
  try {
    if (${JSON.stringify(kind)} === 'math') {
      out.innerHTML = katex.renderToString(source, { displayMode: true, throwOnError: true, strict: 'ignore', output: 'html' })
      size()
      return
    }
    var typeset = function (tex, px) {
      var html
      try { html = katex.renderToString(tex, { displayMode: true, output: 'mathml', strict: 'ignore', throwOnError: true }) } catch (e) { return null }
      var probe = document.createElement('span')
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;line-height:normal;font-size:' + px + 'px'
      probe.innerHTML = html
      document.body.appendChild(probe)
      var box = probe.getBoundingClientRect()
      probe.remove()
      return { html: html, width: Math.ceil(box.width), height: Math.ceil(box.height) }
    }
    // The global build of Pele draws at once: render, not renderAsync.
    var result = pele.render(source, { images: false, links: false, math: typeset, fontFamily: '-apple-system, system-ui, sans-serif' })
    out.innerHTML = result.svg.replace(/^<svg\\b[^>]*?\\sstyle="/, function (root) { return root + ${JSON.stringify(vars)} + ';' })
    var svg = out.querySelector('svg')
    if (svg && svg.getAttribute('style') === null) { svg.setAttribute('style', ${JSON.stringify(vars)}) }
    size()
  } catch (error) {
    say({ fault: String(error && error.message || error) })
  }
})()
</script></body></html>`
}

/**
 * A block of math or a Mermaid diagram of an answer, drawn in a web view. A
 * wide diagram scrolls sideways. A block that cannot be drawn shows its
 * source, as plain code, with no fault in the way of the answer.
 */
export const RenderedBlock = memo(function RenderedBlock({ kind, source }: { kind: Kind; source: string }) {
  const t = useTheme()
  const [box, setBox] = useState<{ height: number; width: number } | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const colours = useMemo(
    () => ({ bg: 'transparent', fg: t.ink, muted: t.muted, line: t.muted, surface: t.soft, 'surface-alt': t.paper, border: t.muted, accent: t.accent, critical: t.red }),
    [t]
  )
  const html = useMemo(() => ({ html: page(kind, source, colours, t.ink) }), [kind, source, colours, t.ink])

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { height?: number; width?: number; fault?: string }

      if (message.fault) {
        setFault(message.fault)
      } else if (typeof message.height === 'number' && message.height > 0) {
        setBox({ height: message.height, width: message.width ?? 0 })
      }
    } catch {
      // A message the page did not write: nothing to do.
    }
  }

  if (fault) {
    return (
      <View style={[styles.source, { backgroundColor: t.soft }]}>
        <Text style={[styles.note, { color: t.muted }]}>{kind === 'math' ? 'Math' : 'Diagram'} · could not be drawn{__DEV__ ? ` (${fault})` : ''}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Text selectable style={[styles.code, { color: t.ink }]}>
            {source}
          </Text>
        </ScrollView>
      </View>
    )
  }

  return (
    <ScrollView
      accessibilityLabel={kind === 'math' ? `Math: ${source}` : 'Diagram'}
      contentContainerStyle={{ minWidth: '100%' }}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.frame, kind === 'diagram' && { backgroundColor: t.paper, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth }]}
    >
      <WebView
        allowsLinkPreview={false}
        automaticallyAdjustContentInsets={false}
        bounces={false}
        // The page has no link: nothing in it can open another page.
        onShouldStartLoadWithRequest={request => request.url === 'about:blank' || request.url.startsWith('data:')}
        onMessage={onMessage}
        originWhitelist={['about:blank']}
        scrollEnabled={false}
        source={html}
        style={[styles.web, { height: box?.height ?? 48, width: box && box.width > 0 ? box.width : undefined, opacity: box ? 1 : 0 }]}
      />
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  frame: { borderRadius: radius.md },
  web: { backgroundColor: 'transparent', minWidth: 280 },
  source: { borderRadius: radius.md, overflow: 'hidden', paddingBottom: space.sm },
  note: { ...type.small, paddingHorizontal: space.md, paddingTop: space.sm },
  code: { fontFamily: MONO, fontSize: 13, padding: space.md }
})
