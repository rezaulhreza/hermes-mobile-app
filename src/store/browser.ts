/**
 * The browser preview of each conversation, and the answers to the agent's
 * requests to read and drive it. The page lives in a WebView that a screen
 * mounts; that screen registers a pane here, and this store asks the pane to
 * run a script in the page.
 */

import { map } from 'nanostores'

import {
  actionFromRequest,
  actScript,
  type BrowserPreview,
  HUMAN_HAS_CONTROL,
  isNavKind,
  NAVIGATED,
  type NavKind,
  NOT_ON_SCREEN,
  PAGE_LOADING,
  type PageText,
  readAnswer,
  readScript,
  withoutTab,
  withTab
} from '@/core/preview/browser'
import type { GatewayEvent } from '@/core/gateway/gateway-events'

import { onGatewayEvent, onGatewayRequest, rpc } from './link'

/** The page on screen of each conversation: the one the agent reads and drives. */
export const $previews = map<Record<string, BrowserPreview>>({})
/** Every page the agent opened in each conversation. One WebView shows one of them. */
export const $previewTabs = map<Record<string, BrowserPreview[]>>({})
/** What the agent says while it starts the server of a page again. Absent when no restart runs. */
export const $previewRestart = map<Record<string, string>>({})

function setTabs(sessionId: string, tabs: BrowserPreview[], active: number): void {
  if (!tabs.length) {
    return closePreview(sessionId)
  }

  $previewTabs.setKey(sessionId, tabs)
  $previews.setKey(sessionId, tabs[active])
}

/** Bring another page of the conversation to the screen. */
export function showPreviewTab(sessionId: string, url: string): void {
  const tab = ($previewTabs.get()[sessionId] ?? []).find(other => other.url === url)

  if (tab) {
    $previews.setKey(sessionId, tab)
  }
}

/** Close one page. The agent can open it again. */
export function closePreviewTab(sessionId: string, url: string): void {
  const tabs = $previewTabs.get()[sessionId] ?? []
  const next = withoutTab(tabs, tabs.findIndex(tab => tab.url === $previews.get()[sessionId]?.url), url)

  setTabs(sessionId, next.tabs, next.active)
}

/**
 * Ask Hermes to start the server of this page again (a development server
 * that stopped or hangs). A helper agent does it on the host and says what it
 * does; the pane loads the page again when it is done.
 */
export async function restartPreview(sessionId: string): Promise<void> {
  const url = $previews.get()[sessionId]?.url

  if (!url || $previewRestart.get()[sessionId] !== undefined) {
    return
  }

  $previewRestart.setKey(sessionId, 'Asking Hermes to start the server again…')

  try {
    await rpc('preview.restart', { session_id: sessionId, url })
  } catch (error) {
    endRestart(sessionId)
    throw error
  }
}

function endRestart(sessionId: string): void {
  const { [sessionId]: _done, ...rest } = $previewRestart.get()

  $previewRestart.set(rest)
}
/** The conversations where the user took the page over. The agent is told to wait. */
export const $humanControl = map<Record<string, boolean>>({})
/** The conversations where the agent acted a moment ago, so the pane can say that it drives. */
export const $agentDriving = map<Record<string, boolean>>({})

/** What a mounted WebView offers. `run` resolves with what the script posted, or rejects when the page gives no answer. */
export interface Pane {
  run: (id: string, script: string) => Promise<unknown>
  navigate: (kind: NavKind) => void
}

const panes = new Map<string, Pane>()

export function registerPane(sessionId: string, pane: Pane): () => void {
  panes.set(sessionId, pane)

  return () => {
    if (panes.get(sessionId) === pane) {
      panes.delete(sessionId)
    }
  }
}

export function setHumanControl(sessionId: string, human: boolean): void {
  $humanControl.setKey(sessionId, human)
}

export function closePreview(sessionId: string): void {
  const { [sessionId]: _closed, ...rest } = $previews.get()
  const { [sessionId]: _tabs, ...restTabs } = $previewTabs.get()

  $previews.set(rest)
  $previewTabs.set(restTabs)
  $humanControl.setKey(sessionId, false)
}

export function clearPreviews(): void {
  $previews.set({})
  $previewTabs.set({})
  $previewRestart.set({})
  $humanControl.set({})
  $agentDriving.set({})
}

onGatewayEvent(event => {
  const sessionId = event.session_id

  if (!sessionId) {
    return
  }

  if (event.type === 'preview.open') {
    const payload = (event as GatewayEvent<'preview.open'>).payload

    if (payload?.url) {
      // The page the agent just opened is the one it will read: it comes to the screen.
      const next = withTab($previewTabs.get()[sessionId] ?? [], { url: payload.url, label: payload.label ?? '' })

      setTabs(sessionId, next.tabs, next.active)
    }
  } else if (event.type === 'preview.close') {
    // An empty address closes every page.
    closePreviewTab(sessionId, (event as GatewayEvent<'preview.close'>).payload?.url ?? '')
  } else if (event.type === 'preview.restart.progress') {
    const text = (event as GatewayEvent<'preview.restart.progress'>).payload?.text

    if (text && $previewRestart.get()[sessionId] !== undefined) {
      $previewRestart.setKey(sessionId, text)
    }
  } else if (event.type === 'preview.restart.complete') {
    if ($previewRestart.get()[sessionId] !== undefined) {
      endRestart(sessionId)
      panes.get(sessionId)?.navigate('reload')
    }
  }
})

const drivingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const DRIVING_SHOWN_MS = 2500
let lastId = 0

function showDriving(sessionId: string): void {
  clearTimeout(drivingTimers.get(sessionId))
  $agentDriving.setKey(sessionId, true)
  drivingTimers.set(
    sessionId,
    setTimeout(() => $agentDriving.setKey(sessionId, false), DRIVING_SHOWN_MS)
  )
}

async function read(sessionId: string, preview: BrowserPreview, params: Record<string, unknown>): Promise<unknown> {
  const window = { start: params.start as number | null | undefined, count: params.count as number | null | undefined }
  const pane = panes.get(sessionId)

  if ($humanControl.get()[sessionId]) {
    return readAnswer(preview, null, window, HUMAN_HAS_CONTROL)
  }

  if (!pane) {
    return readAnswer(preview, null, window, NOT_ON_SCREEN)
  }

  showDriving(sessionId)

  try {
    const page = (await pane.run(`r${++lastId}`, readScript(`r${lastId}`))) as Partial<PageText> & { error?: string }

    if (page.error || typeof page.text !== 'string') {
      return readAnswer(preview, null, window, PAGE_LOADING)
    }

    return readAnswer(preview, { title: page.title ?? '', url: page.url ?? preview.url, text: page.text }, window)
  } catch {
    return readAnswer(preview, null, window, PAGE_LOADING)
  }
}

async function act(sessionId: string, params: Record<string, unknown>): Promise<unknown> {
  const action = actionFromRequest(params)
  const pane = panes.get(sessionId)

  // The person's hand beats the agent's, for a click and for a navigation.
  if ($humanControl.get()[sessionId]) {
    return { success: false, error: HUMAN_HAS_CONTROL }
  }

  if (!pane) {
    return { success: false, error: NOT_ON_SCREEN }
  }

  showDriving(sessionId)

  if (isNavKind(action.kind)) {
    pane.navigate(action.kind)

    return { success: true, acted: action.kind, note: 'Page is loading — call elements to see what is on it.' }
  }

  try {
    const id = `a${++lastId}`

    return await pane.run(id, actScript(id, action))
  } catch {
    // A page that stops answering right after a click is a page that navigated.
    return { success: true, acted: action.kind, note: NAVIGATED }
  }
}

onGatewayRequest(request => {
  if (request.method !== 'preview.read' && request.method !== 'preview.act') {
    return false
  }

  const sessionId = typeof request.params.session_id === 'string' ? request.params.session_id : ''
  const preview = $previews.get()[sessionId]

  // No preview of this conversation on the phone: another client (the desktop app) may show it.
  if (!preview) {
    return false
  }

  const work = request.method === 'preview.read' ? read(sessionId, preview, request.params) : act(sessionId, request.params)

  void work.then(result => request.respond({ value: JSON.stringify(result) }))

  return true
})
