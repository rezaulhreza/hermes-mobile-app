/**
 * The view of the agent's screen work: a picture of one window on the host,
 * about once a second, while the view is open. The user can hold the screen
 * (the agent's screen tools are then refused on the host) and act in the
 * window from the phone.
 *
 * Nothing here runs while the view is closed: no timer, no request, and the
 * picture is dropped.
 */

import { atom } from 'nanostores'

import { CONTINUE_MESSAGE, type ScreenFrame, type ScreenHold, screenProblem, type ScreenWindow, stopMessage } from '@/core/screen'

import { $conversations, redirectTurn, sendDraft } from './chat'
import { currentApi } from './link'

const ROUTE = '/api/plugins/screen-remote'
/** The wait after one picture before the next is asked for. A picture takes 0.3 to 1 s on the host. */
const WATCH_MS = 1000
/** While the user acts, the next picture is asked for almost at once: the capture on the host is the wait. */
const HOLD_MS = 100
/** After an input, the window on the host gets this long to draw the change before the next picture. */
const AFTER_INPUT_MS = 120
/** After a fault the view asks again, slower, so a host that is down is not flooded. */
const RETRY_MS = 4000

export interface ScreenState {
  frame: ScreenFrame | null
  /** Why there is no picture. */
  problem: string | null
}

export const $screen = atom<ScreenState>({ frame: null, problem: null })
/** The picture, as a `data:` address. Only the picture itself reads it: it changes every second. */
export const $screenPicture = atom<string | null>(null)
/** The user holds the screen. It is a fact of the host, not of one chat: it stays when the view closes. */
export const $screenHold = atom<ScreenHold | null>(null)
export const $screenWindows = atom<ScreenWindow[]>([])

interface FrameAnswer extends ScreenFrame {
  hold: ScreenHold | null
  image?: string
  unchanged?: boolean
}

interface Watch {
  /** The stored id of the chat: the host finds the window its agent works in. */
  storedId: string
  /** The window the user chose, or the whole screen (to look at, with no input). Null follows the agent. */
  target: ScreenTarget
  timer: ReturnType<typeof setTimeout> | null
  /** A picture is on its way. */
  loading: boolean
  /** An input came while a picture was on its way: that picture may be older than the input. */
  again: boolean
}

/** What the picture shows: one window, every window (`whole`), or the window of the agent (null). */
export type ScreenTarget = { pid: number; window_id: number } | 'whole' | null

let watch: Watch | null = null

function api() {
  const current = currentApi()

  if (!current) {
    throw new Error('Not connected to a Hermes workspace.')
  }

  return current
}

async function nextFrame(current: Watch): Promise<void> {
  const last = $screen.get().frame?.digest
  const query = [
    current.target === 'whole' ? 'whole=1' : current.target ? `pid=${current.target.pid}&window_id=${current.target.window_id}` : `session_id=${encodeURIComponent(current.storedId)}`,
    last ? `last=${last}` : ''
  ]
    .filter(Boolean)
    .join('&')

  let delay = RETRY_MS

  current.loading = true
  current.again = false

  try {
    const { hold, image, unchanged: _unchanged, ...frame } = await api().request<FrameAnswer>({ path: `${ROUTE}/frame?${query}` })

    if (watch !== current) {
      return
    }

    if (image) {
      $screenPicture.set(image)
    }

    // A new object every second would draw the whole view again for nothing.
    if (frame.digest !== last || $screen.get().problem) {
      $screen.set({ frame, problem: null })
    }

    $screenHold.set(hold)
    delay = hold ? HOLD_MS : WATCH_MS
  } catch (error) {
    if (watch !== current) {
      return
    }

    $screen.set({ frame: $screen.get().frame, problem: screenProblem(error) })
  }

  current.loading = false
  current.timer = setTimeout(() => void nextFrame(current), current.again ? AFTER_INPUT_MS : delay)
}

/** Ask for a picture soon after an input, so the user sees its effect without the wait of the loop. */
function pictureSoon(): void {
  const current = watch

  if (!current) {
    return
  }

  if (current.loading) {
    current.again = true

    return
  }

  if (current.timer) {
    clearTimeout(current.timer)
  }

  current.timer = setTimeout(() => void nextFrame(current), AFTER_INPUT_MS)
}

/** Start the picture. `storedId` is the chat whose agent the view follows. */
export function openScreen(storedId: string): void {
  closeScreen()
  watch = { storedId, target: null, timer: null, loading: false, again: false }
  void nextFrame(watch)
}

/** Stop the picture and free it. A hold stays: the user may work on the host itself. */
export function closeScreen(): void {
  if (watch?.timer) {
    clearTimeout(watch.timer)
  }

  watch = null
  $screen.set({ frame: null, problem: null })
  $screenPicture.set(null)
  $screenWindows.set([])
}

/** Is the picture asked for now? For the check that nothing runs after the view closes. */
export function screenWatching(): boolean {
  return watch !== null
}

export async function loadScreenWindows(): Promise<void> {
  const { windows } = await api().request<{ windows: ScreenWindow[] }>({ path: `${ROUTE}/windows` })

  $screenWindows.set(windows)
}

/** Show another window, or follow the agent again with null. */
export function showScreenWindow(target: ScreenTarget): void {
  if (watch) {
    watch.target = target
    $screen.set({ frame: null, problem: null })
    $screenPicture.set(null)
  }
}

/** Ask the host once if the user still holds the screen (a hold outlives the view and the app). */
export async function refreshScreenHold(): Promise<void> {
  try {
    $screenHold.set((await api().request<{ hold: ScreenHold | null }>({ path: `${ROUTE}/status` })).hold)
  } catch {
    // A host with no plugin has no hold.
    $screenHold.set(null)
  }
}

/**
 * Stop the agent's screen work and take the screen. The host refuses the
 * agent's screen tools from now on, and each refusal tells the agent why. A
 * turn that runs is stopped with a message that says the same, so the agent
 * knows at once and not only at its next step.
 */
export async function takeScreen(sessionId: string, reason: string): Promise<void> {
  const { hold } = await api().request<{ hold: ScreenHold }>({ path: `${ROUTE}/hold`, method: 'POST', body: { held: true, reason } })

  $screenHold.set(hold)

  if ($conversations.get()[sessionId]?.transcript.running) {
    await redirectTurn(sessionId, stopMessage(reason))
  }
}

/** Give the screen back. With `resume` the agent is told to go on. */
export async function handScreenBack(sessionId: string, resume: boolean): Promise<void> {
  await api().request({ path: `${ROUTE}/hold`, method: 'POST', body: { held: false } })
  $screenHold.set(null)

  if (resume) {
    await sendDraft(sessionId, CONTINUE_MESSAGE)
  }
}

export type ScreenInput =
  | { action: 'click' | 'double_click' | 'right_click'; x: number; y: number }
  | { action: 'type'; text: string }
  | { action: 'key'; keys: string }
  | { action: 'scroll'; direction: 'up' | 'down'; x?: number; y?: number }
  | { action: 'drag'; x: number; y: number; to_x: number; to_y: number }

/** One tap, text, key or scroll into the window of the picture. Resolves with a problem to show, or null. */
export async function sendScreenInput(input: ScreenInput): Promise<string | null> {
  const frame = $screen.get().frame

  if (!frame || frame.pid === null || frame.window_id === null) {
    return frame && watch?.target === 'whole' ? 'This is the whole screen. Choose a window to act in it.' : 'There is no window to act in yet.'
  }

  try {
    const result = await api().request<{ ok: boolean; message: string }>({
      path: `${ROUTE}/input`,
      method: 'POST',
      // The host's driver scrolls at a position. With none given, the middle of the window is meant.
      body: {
        pid: frame.pid,
        window_id: frame.window_id,
        ...(input.action === 'scroll' ? { x: Math.round(frame.width / 2), y: Math.round(frame.height / 2) } : {}),
        ...input
      }
    })

    return result.ok ? null : result.message || 'The host did not take the input.'
  } catch (error) {
    return screenProblem(error)
  } finally {
    pictureSoon()
  }
}
