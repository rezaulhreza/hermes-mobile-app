/**
 * The browser preview: a page the agent opens for the user, reads, and drives.
 *
 * The backend sends `preview.open` / `preview.close` events. For `read_preview`
 * and `drive_preview` it sends the requests `preview.read` and `preview.act`,
 * and the client that shows the page answers them. On the phone the page is in
 * a WebView; the answer comes from a script that runs inside the page and posts
 * its result back. The engine in that script is the desktop app's own
 * (`act-engine.generated.ts`), so both apps act on a page the same way.
 */

import { ACT_ENGINE_SOURCE, WATCH_ENGINE_SOURCE } from './act-engine.generated'

export interface BrowserPreview {
  url: string
  label: string
}

const LOOPBACK = /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(:\d+)?(\/|$|\?|#)/i

// Domains that only a local resolver serves (RFC 6761): a site of the host's own development tools.
const LOCAL_DOMAIN = /^https?:\/\/[a-z0-9.-]+\.(test|localhost)(:\d+)?(\/|$|\?|#)/i

/**
 * The address names the Hermes host itself: `localhost`, or a site under a
 * local-development domain (`app.test`). The phone cannot reach or resolve
 * such an address; the host can.
 */
export function isLoopbackUrl(url: string): boolean {
  return LOOPBACK.test(url.trim()) || LOCAL_DOMAIN.test(url.trim())
}

/** The route of the host's `phone-preview` plugin (`host/phone-preview`). A host without it cannot show its own pages. */
export const PREVIEW_ROUTE = '/api/plugins/phone-preview'

/**
 * The address the WebView loads. `localhost` in a URL from the agent is the
 * Hermes host, not the phone, so such a URL goes through the backend's preview
 * proxy. Any other address loads as it is.
 */
export function previewAddress(baseUrl: string, url: string): string {
  const path = hostFilePath(url)

  if (path) {
    // A file of the host (a page the agent wrote, a picture, a PDF): the host serves it, with the app's sign-in.
    return `${baseUrl}/api/fs/download?path=${encodeURIComponent(path)}`
  }

  return isLoopbackUrl(url) ? `${baseUrl}${PREVIEW_ROUTE}/host?url=${encodeURIComponent(url.trim())}` : url.trim()
}

/**
 * The path, when a preview is a file of the host and not a web address:
 * `file:///Users/me/out/report.html`, `/Users/me/out/report.html`,
 * `C:\\Users\\me\\report.html`. Null for a web address.
 */
export function hostFilePath(url: string): string | null {
  const text = url.trim()

  if (/^file:\/\//i.test(text)) {
    try {
      // `file:///C:/x` is the path `C:/x`, `file:///Users/me` is `/Users/me`.
      return decodeURIComponent(text.replace(/^file:\/\/(localhost)?/i, '')).replace(/^\/([A-Za-z]:[\\/])/, '$1')
    } catch {
      return null
    }
  }

  return /^(\/|~\/|[A-Za-z]:[\\/])/.test(text) ? text : null
}

/** "localhost:5173/app" for a title bar. A file shows its name. */
export function shortAddress(url: string): string {
  const path = hostFilePath(url)

  if (path) {
    return path.split(/[\\/]/).pop() || path
  }

  return url
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
}

/** The pages of a conversation after the agent opened one. A page that is open already only comes to the front. */
export function withTab(tabs: readonly BrowserPreview[], preview: BrowserPreview): { tabs: BrowserPreview[]; active: number } {
  const at = tabs.findIndex(tab => tab.url === preview.url)

  return at >= 0 ? { tabs: tabs.map((tab, index) => (index === at ? preview : tab)), active: at } : { tabs: [...tabs, preview], active: tabs.length }
}

/**
 * The pages after one was closed. An empty `url` closes every page. The page
 * on screen stays on screen; when it is the one that closed, the page before
 * it shows.
 */
export function withoutTab(tabs: readonly BrowserPreview[], active: number, url: string): { tabs: BrowserPreview[]; active: number } {
  const at = url ? tabs.findIndex(tab => tab.url === url) : -1

  if (!url) {
    return { tabs: [], active: 0 }
  }

  if (at < 0) {
    return { tabs: [...tabs], active }
  }

  const rest = tabs.filter((_, index) => index !== at)

  return { tabs: rest, active: Math.max(0, Math.min(rest.length - 1, at < active || at === active ? active - 1 : active)) }
}

/** The verbs the pane does itself: a page cannot drive its own history. */
export const NAV_KINDS = ['back', 'forward', 'reload'] as const
export type NavKind = (typeof NAV_KINDS)[number]

export interface ActAction {
  kind: string
  ref?: string
  selector?: string
  text?: string
  key?: string
  submit?: boolean
  full?: boolean
  to?: string
  amount?: number
  max?: number
  allowShortcut?: boolean
}

/** The action of a `preview.act` request, with the field names the engine reads. */
export function actionFromRequest(params: Record<string, unknown>): ActAction {
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined)
  const number = (value: unknown) => (typeof value === 'number' ? value : undefined)
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined)
  const action: ActAction = {
    kind: text(params.action) ?? '',
    ref: text(params.ref),
    selector: text(params.selector),
    text: text(params.text),
    key: text(params.key),
    submit: flag(params.submit),
    full: flag(params.full),
    to: text(params.to),
    amount: number(params.amount),
    max: number(params.max),
    allowShortcut: params.allow_shortcut === true ? true : undefined
  }

  return Object.fromEntries(Object.entries(action).filter(([, value]) => value !== undefined)) as unknown as ActAction
}

export function isNavKind(kind: string): kind is NavKind {
  return (NAV_KINDS as readonly string[]).includes(kind)
}

export const NOTHING_OPEN = 'No live page is open in the in-app browser — open one with open_preview first.'
export const NOT_ON_SCREEN = 'The preview is not on the screen of the phone. The user must open the conversation first.'
export const HUMAN_HAS_CONTROL =
  'The person using this device has taken control of the browser. Ask them to hand it back before reading or driving the page.'
export const NAVIGATED = 'The page stopped answering right after — it is probably navigating. Call elements to see where you landed.'
export const PAGE_LOADING = 'The page has not finished loading — retry in a moment.'

// Time for a click or a key to land (a framework renders again) before the page is read again.
const SETTLE_MS = 220
const READ_MAX_CHARS = 24_000

/** What a script posts back, under this key, so a message of the page's own is never taken for an answer. */
const TAG = '__hermesPane'

const post = (id: string, value: string) => `window.ReactNativeWebView.postMessage(JSON.stringify({ ${TAG}: ${JSON.stringify(id)}, result: ${value} }))`

/** The actions that only draw on the page: the agent's `annotate_preview` tool and the scan of the field. */
export const ANNOTATION_KINDS = ['pin', 'unpin', 'hold', 'strobe'] as const

function isAnnotation(kind: string): boolean {
  return (ANNOTATION_KINDS as readonly string[]).includes(kind)
}

/** What every script starts with: the engine, the overlay that shows the user what the agent does, and their two helpers. */
const preamble = `    w.__hermesActHolder = w.__hermesActHolder || {};
    w.__hermesAct = ${ACT_ENGINE_SOURCE};
    w.__hermesWatch_fn = (${WATCH_ENGINE_SOURCE});
    var holder = w.__hermesActHolder;
    var act = function (a) { return w.__hermesAct(document, holder, a); };
    var watch = function (stage, label) { try { w.__hermesWatch_fn(document, holder, stage, label); } catch (err) {} };`

/** The words of the answer for the element the engine found: "pinned the Sign in button". */
const NAMED = `String(found.acted || 'it').replace(/^looking at /, '')`

/**
 * The script for a mark of the agent on the page. `pin` outlines one element
 * until it is taken down, `unpin` takes one or all down, `hold` keeps the
 * outline of every element, `strobe` runs through them. The page is not
 * touched: the marks are drawn over it.
 */
function annotationScript(action: ActAction): string {
  const locate = JSON.stringify({ kind: 'locate', ref: action.ref, selector: action.selector })

  switch (action.kind) {
    case 'pin':
      return `var found = act(${locate});
    if (!found.success) { send(found); return; }
    watch('pin', ${JSON.stringify(action.text ?? '')});
    send({ success: true, acted: 'pinned ' + ${NAMED} });`

    case 'unpin':
      return action.ref || action.selector
        ? `var found = act(${locate});
    if (!found.success) { send(found); return; }
    watch('unpin');
    send({ success: true, acted: 'unpinned ' + ${NAMED} });`
        : `holder.aimed = null;
    watch('unpin');
    send({ success: true, acted: 'cleared every pin' });`

    default:
      return `var found = act({ kind: 'elements' });
    if (!found.success) { send(found); return; }
    watch(${JSON.stringify(action.kind)});
    found.acted = ${JSON.stringify(action.kind === 'hold' ? 'held the field' : 'strobed the field')};
    send(found);`
  }
}

/**
 * The script for one action. It runs the engine, marks the element the agent
 * acted on, waits for the page to settle and reads the page again, so the
 * agent gets the new state in the same answer. It ends with `true`: the
 * WebView wants a script to end with a value.
 */
export function actScript(id: string, action: ActAction): string {
  const settle = action.kind === 'elements' ? 0 : SETTLE_MS

  if (isAnnotation(action.kind)) {
    return `(function () {
  var w = window;
  var send = function (result) { ${post(id, 'result')}; };
  try {
${preamble}
    ${annotationScript(action)}
  } catch (err) {
    send({ success: false, error: String(err) });
  }
})();
true;`
  }

  return `(function () {
  var w = window;
  var send = function (result) { ${post(id, 'result')}; };
  try {
${preamble}
    var result = act(${JSON.stringify(action)});
    if (!result.success || ${settle} <= 0) { send(result); return; }
    watch('strike');
    setTimeout(function () {
      try {
        var after = act({ kind: 'elements' });
        result.elements = after.elements;
        result.delta = after.delta;
        result.url = after.url;
        result.title = after.title;
      } catch (err) {
        result.note = 'The page changed before it could be re-read: ' + err;
      }
      send(result);
    }, ${settle});
  } catch (err) {
    send({ success: false, error: String(err) });
  }
})();
true;`
}

/** The script that reads the page: its title, its address and the text a person sees. */
export function readScript(id: string): string {
  return `(function () {
  try {
    ${post(id, "{ title: document.title || '', url: location.href, text: (document.body && document.body.innerText) || '' }")};
  } catch (err) {
    ${post(id, '{ error: String(err) }')};
  }
})();
true;`
}

/** An answer a script posted, or null for any other message of the page. */
export function paneMessage(data: string): { id: string; result: unknown } | null {
  try {
    const message = JSON.parse(data) as Record<string, unknown>

    return typeof message?.[TAG] === 'string' ? { id: message[TAG] as string, result: message.result } : null
  } catch {
    return null
  }
}

export interface PageText {
  title: string
  url: string
  text: string
}

export interface ReadAnswer {
  kind: 'url'
  title: string
  url: string
  text: string
  start: number
  end: number
  total_chars: number
  note?: string
}

/**
 * The answer to `preview.read`: one window of the page text. The agent asks
 * for the next window with `start`. With no page text (the page still loads,
 * or the user holds the page) the answer names the page and says why.
 */
export function readAnswer(
  preview: BrowserPreview,
  page: PageText | null,
  window: { start?: number | null; count?: number | null },
  note?: string
): ReadAnswer {
  const text = page?.text ?? ''
  const total = text.length
  const start = Math.max(0, Math.min(window.start ?? 0, total))
  const count = Math.min(Math.max(1, window.count ?? READ_MAX_CHARS), READ_MAX_CHARS)
  const end = Math.max(start, Math.min(start + count, total))

  return {
    kind: 'url',
    title: page?.title || preview.label || shortAddress(preview.url),
    url: page?.url || preview.url,
    text: text.slice(start, end),
    start,
    end,
    total_chars: total,
    ...(note ? { note } : {})
  }
}
