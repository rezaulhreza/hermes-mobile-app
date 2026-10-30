import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import { StyleSheet } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { dark } from '@/theme/tokens'

import { FIT_JS, XTERM_CSS, XTERM_JS } from './xterm.generated'

export interface TerminalViewHandle {
  /** Output of the shell, as base64. */
  write: (base64: string) => void
  focus: () => void
  /** Start again with an empty screen, for another shell. */
  reset: () => void
}

interface Props {
  /** The terminal has its size: the shell can start with it. */
  onReady: (cols: number, rows: number) => void
  onInput: (text: string) => void
  onResize: (cols: number, rows: number) => void
}

/** A terminal is dark in both appearances. */
const c = dark

// The script of the page: xterm.js on the whole page, its input and its size sent to the app.
const GLUE = `(function () {
  var term = new Terminal({
    fontFamily: 'Menlo, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 5000,
    theme: { background: '${c.bg}', foreground: '#d7dce3', cursor: '${c.accentFill}', cursorAccent: '${c.bg}', selectionBackground: 'rgba(198, 244, 50, 0.3)' }
  });
  var fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(document.getElementById('t'));
  fit.fit();
  function send(message) { window.ReactNativeWebView.postMessage(JSON.stringify(message)); }
  term.onData(function (data) { send({ type: 'input', data: data }); });
  term.onResize(function (size) { send({ type: 'resize', cols: size.cols, rows: size.rows }); });
  window.addEventListener('resize', function () { fit.fit(); });
  window.__write = function (chunks) {
    for (var i = 0; i < chunks.length; i++) {
      var text = atob(chunks[i]);
      var bytes = new Uint8Array(text.length);
      for (var j = 0; j < text.length; j++) bytes[j] = text.charCodeAt(j);
      term.write(bytes);
    }
  };
  window.__focus = function () { term.focus(); };
  window.__reset = function () { term.reset(); };
  send({ type: 'ready', cols: term.cols, rows: term.rows });
})();`

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${XTERM_CSS}
html, body { margin: 0; height: 100%; background: ${c.bg}; overflow: hidden; }
#t { position: absolute; top: 0; right: 0; bottom: 0; left: 0; padding: 6px 4px 6px 10px; }
</style></head><body><div id="t"></div>
<script>${XTERM_JS}</script><script>${FIT_JS}</script><script>${GLUE}</script>
</body></html>`

/**
 * xterm.js in a web view: colours, the cursor, and programs that redraw the
 * screen (`top`, an editor) all work, as on a desktop terminal. The output
 * of one frame goes into the page in one call, so a fast log does not choke
 * the bridge to the page.
 */
export const TerminalView = forwardRef<TerminalViewHandle, Props>(function TerminalView({ onReady, onInput, onResize }, ref) {
  const web = useRef<WebView>(null)
  const pending = useRef<string[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const source = useMemo(() => ({ html: PAGE }), [])

  const flush = () => {
    timer.current = null
    const chunks = pending.current

    pending.current = []
    web.current?.injectJavaScript(`window.__write(${JSON.stringify(chunks)}); true;`)
  }

  useImperativeHandle(ref, () => ({
    write: base64 => {
      pending.current.push(base64)
      timer.current ??= setTimeout(flush, 16)
    },
    focus: () => web.current?.injectJavaScript('window.__focus && window.__focus(); true;'),
    reset: () => {
      pending.current = []
      web.current?.injectJavaScript('window.__reset && window.__reset(); true;')
    }
  }))

  const onMessage = (event: WebViewMessageEvent) => {
    let message: { type?: string; data?: unknown; cols?: unknown; rows?: unknown }

    try {
      message = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }

    if (message.type === 'input' && typeof message.data === 'string') {
      onInput(message.data)
    } else if ((message.type === 'ready' || message.type === 'resize') && typeof message.cols === 'number' && typeof message.rows === 'number') {
      ;(message.type === 'ready' ? onReady : onResize)(message.cols, message.rows)
    }
  }

  return (
    <WebView
      allowsLinkPreview={false}
      automaticallyAdjustContentInsets={false}
      bounces={false}
      hideKeyboardAccessoryView
      keyboardDisplayRequiresUserAction={false}
      onMessage={onMessage}
      originWhitelist={['about:blank']}
      ref={web}
      scrollEnabled={false}
      source={source}
      style={styles.web}
    />
  )
})

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: c.bg }
})
