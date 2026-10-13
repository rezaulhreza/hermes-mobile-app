/**
 * The agent's work on a screen: the tools that count as screen work, the
 * words that tell the agent the user took over, and where a tap on the phone
 * lands in the window on the host.
 *
 * The host half is the `screen-remote` plugin (`host/screen-remote`). It
 * shows one window, holds the screen for the user and takes input.
 */

/** A name that ends with `_` is the start of a tool name. The plugin on the host has the same list. */
const SCREEN_TOOLS = ['computer_use', 'browser_', 'mcp__chrome__'] as const

/** The agent uses the host's screen or drives a browser with this tool. */
export function isScreenTool(name: string): boolean {
  return SCREEN_TOOLS.some(tool => (tool.endsWith('_') ? name.startsWith(tool) : name === tool))
}

export interface ScreenWork {
  /** A screen tool ran in this conversation. */
  used: boolean
  /** A screen tool runs now. */
  running: boolean
}

export function screenWork(items: readonly { kind: string; name?: string; state?: string }[]): ScreenWork {
  const tools = items.filter(item => item.kind === 'tool' && isScreenTool(item.name ?? ''))

  return { used: tools.length > 0, running: tools.some(item => item.state === 'running') }
}

/** What the plugin says about the picture it sent. Positions for input are in `width` x `height`. */
export interface ScreenFrame {
  pid: number | null
  window_id: number | null
  app: string
  title: string
  width: number
  height: number
  digest: string
}

export interface ScreenHold {
  reason: string
  since: number
  expires_at: number
}

export interface ScreenWindow {
  pid: number
  window_id: number
  app: string
  title: string
}

export interface Size {
  width: number
  height: number
}

/** The picture can be made this many times larger with two fingers. */
export const MAX_ZOOM = 5

export function clampZoom(scale: number): number {
  return Math.max(1, Math.min(MAX_ZOOM, scale))
}

/**
 * How far the enlarged picture may move from the middle: an edge of the
 * picture never comes inside the box. At scale 1 it does not move.
 */
export function clampPan(offset: number, side: number, scale: number): number {
  const limit = (side * (scale - 1)) / 2

  return Math.max(-limit, Math.min(limit, offset))
}

/** A drag in the window on the host for a move of one finger on its picture. Null when an end is outside the window. */
export function dragPoints(box: Size, frame: Size, from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number; to_x: number; to_y: number } | null {
  const start = tapPoint(box, frame, from)
  const end = tapPoint(box, frame, to)

  return start && end ? { ...start, to_x: end.x, to_y: end.y } : null
}

/**
 * The position in the window on the host for a touch on its picture. The
 * picture is drawn whole inside the box (`contain`), so a wide window leaves
 * bands above and under it. A touch on a band is not in the window: null.
 */
export function tapPoint(box: Size, frame: Size, touch: { x: number; y: number }): { x: number; y: number } | null {
  if (!box.width || !box.height || !frame.width || !frame.height) {
    return null
  }

  const scale = Math.min(box.width / frame.width, box.height / frame.height)
  const x = (touch.x - (box.width - frame.width * scale) / 2) / scale
  const y = (touch.y - (box.height - frame.height * scale) / 2) / scale

  return x < 0 || y < 0 || x >= frame.width || y >= frame.height ? null : { x: Math.round(x), y: Math.round(y) }
}

/** The message that stops a running turn and tells the agent why. The agent reads it as the user's words. */
export function stopMessage(reason: string): string {
  const why = reason.trim()

  return [
    'I stopped your screen work and took control of the screen from my phone.',
    why ? `Reason: ${why}` : '',
    'Do not use computer_use or any browser tool until I say that you can continue. Tell me in one or two sentences what you were doing and what is left, then wait.'
  ]
    .filter(Boolean)
    .join(' ')
}

export const CONTINUE_MESSAGE = 'I gave the screen back. Look at the screen again first, because I changed things, then continue where you stopped.'

/** The keys the view offers under the picture. `keys` is what the host's driver takes. */
export const SCREEN_KEYS = [
  { label: 'Return', keys: 'return', icon: 'corner-down-left' },
  { label: 'Tab', keys: 'tab', icon: 'arrow-right' },
  { label: 'Escape', keys: 'escape', icon: 'x-circle' },
  { label: 'Delete', keys: 'delete', icon: 'delete' },
  { label: 'Up', keys: 'up', icon: 'arrow-up' },
  { label: 'Down', keys: 'down', icon: 'arrow-down' }
] as const

/** Why the view has no picture, in words for the user. A host with no plugin answers 404 for its routes. */
export function screenProblem(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)

  // The plugin gives its own words with a 404 (no window, an empty picture). A 404 with none means the route is not there.
  if (/\b404\b/.test(text) && (!/"detail":"/.test(text) || /"detail":"(Not Found|No such API endpoint)"/.test(text))) {
    return 'This Hermes host has no screen-remote plugin. Install it on the host (the folder host/screen-remote of the app, install.sh), then restart Hermes.'
  }

  return text.replace(/^(HttpError: )?\d{3}: /, '').replace(/^\{"detail":"(.*)"\}$/, '$1')
}
