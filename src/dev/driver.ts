/**
 * Development builds only. Lets `scripts/drive.mjs` on the Mac press buttons
 * and type in the running app, because synthetic taps do not reach the iOS
 * Simulator there. The app dials a loopback port, so only a process on the
 * same machine can drive it, and only while that script listens.
 *
 * `_layout.tsx` loads this file behind `__DEV__`. A release bundle has no
 * copy of it.
 */

import { router } from 'expo-router'

import { $attachments, stage } from '@/store/attachments'
import { $previews } from '@/store/browser'
import { $conversations } from '@/store/chat'
import { $linkState, currentApi, rpc } from '@/store/link'
import { $requests } from '@/store/requests'
import { $sessions, $sessionSource, $sessionView } from '@/store/sessions'
import { duplexAudio } from '@/native/duplex-audio'
import { voiceTrace } from '@/store/voice-engine'
import { pcmBytes } from '@/core/live-voice'
import { $call, $dictation, $enginePreference, $engines, injectSpeech, setCallMuted } from '@/store/voice'

const PORT = 8099
const REDIAL_MS = 1500
const HOST_TEXT = 6

interface Fiber {
  tag: number
  child: Fiber | null
  sibling: Fiber | null
  memoizedProps: Record<string, unknown> | string | null
}

interface DevToolsHook {
  renderers: Map<number, unknown>
  getFiberRoots: (id: number) => Set<{ current: Fiber }>
}

function fibers(from?: Fiber | null): Fiber[] {
  const hook = (globalThis as { __REACT_DEVTOOLS_GLOBAL_HOOK__?: DevToolsHook }).__REACT_DEVTOOLS_GLOBAL_HOOK__
  const stack: (Fiber | null)[] = []

  if (from !== undefined) {
    stack.push(from)
  } else {
    hook?.renderers.forEach((_, id) => hook.getFiberRoots(id).forEach(root => stack.push(root.current)))
  }

  const found: Fiber[] = []

  while (stack.length) {
    const fiber = stack.pop()

    if (fiber) {
      found.push(fiber)
      // Child last, so it comes off first: the order is the order on screen.
      stack.push(fiber.sibling, fiber.child)
    }
  }

  return found
}

function props(fiber: Fiber): Record<string, unknown> {
  return fiber.memoizedProps && typeof fiber.memoizedProps === 'object' ? fiber.memoizedProps : {}
}

function textOf(fiber: Fiber): string {
  return fibers(fiber.child)
    .filter(f => f.tag === HOST_TEXT)
    .map(f => String(f.memoizedProps))
    .join('')
    // An icon is a glyph of an icon font. It is not part of the name a person reads.
    .replace(/[\uE000-\uF8FF]/g, '')
    .trim()
}

/** One entry per control: a Pressable passes `onPress` down through several fibers. */
function pressables(): Fiber[] {
  const seen = new Set<unknown>()

  return fibers().filter(fiber => {
    const onPress = props(fiber).onPress

    if (typeof onPress !== 'function' || seen.has(onPress)) {
      return false
    }

    seen.add(onPress)

    return true
  })
}

/** The app's own buttons take the name as `label`; a bare Pressable has `accessibilityLabel`. */
function labelOf(fiber: Fiber): unknown {
  return props(fiber).accessibilityLabel ?? props(fiber).label
}

function nameOf(fiber: Fiber): string {
  return String(labelOf(fiber) ?? textOf(fiber))
}

function pressOne(hit: Fiber | undefined, what: string): string {
  if (!hit) {
    return `not found: ${what}`
  }

  if (props(hit).disabled) {
    return `disabled: ${what}`
  }

  ;(props(hit).onPress as (event: unknown) => void)({ nativeEvent: {} })

  return `pressed: ${nameOf(hit)}`
}

const helpers = {
  router,
  rpc,
  api: currentApi,
  /** Stage a file by its path, past the native picker that a script cannot use. */
  stage,
  /** The call audio, for a check of the microphone with no call. */
  audio: duplexAudio,
  voiceTrace,
  /** Say a recording into the call with the microphone muted: base64 of mono int16 PCM at 16 kHz. See `scripts/say-to-call.sh`. */
  hear: (base64: string) => {
    setCallMuted(true)
    injectSpeech(pcmBytes(base64))

    return 'fed'
  },
  stores: { $attachments, $previews, $call, $dictation, $enginePreference, $engines, $conversations, $linkState, $requests, $sessions, $sessionSource, $sessionView },

  /** Every string on screen, in order. Screens under the current one are included. */
  texts: () => fibers().filter(f => f.tag === HOST_TEXT).map(f => String(f.memoizedProps)),

  /** The name of every control that can be pressed. */
  labels: () => pressables().map(nameOf).filter(Boolean),

  /**
   * Press the control whose accessibility label or text is exactly this. A
   * part of a name never matches here: "Send" must not press a list row named
   * "Send message to ...". Use `pressLike` to press by a part of a name.
   */
  press: (what: string, nth = 0) => pressOne(pressables().filter(fiber => labelOf(fiber) === what || nameOf(fiber) === what)[nth], what),

  /** Press the first control whose name contains this. For a long title; never for a button. */
  pressLike: (what: string, nth = 0) => pressOne(pressables().filter(fiber => nameOf(fiber).includes(what))[nth], what),

  /** Hold the first control that has a long press and this name. */
  longPress: (what: string) => {
    const hit = fibers().find(fiber => typeof props(fiber).onLongPress === 'function' && nameOf(fiber).includes(what))

    if (!hit) {
      return `not found: ${what}`
    }

    ;(props(hit).onLongPress as (event: unknown) => void)({ nativeEvent: {} })

    return `held: ${nameOf(hit)}`
  },

  /** Replace the text of the input with this accessibility label. */
  type: (text: string, label = 'Message') => {
    const input = fibers().find(fiber => typeof props(fiber).onChangeText === 'function' && props(fiber).accessibilityLabel === label)

    if (!input) {
      return `no input: ${label}`
    }

    ;(props(input).onChangeText as (text: string) => void)(text)

    return 'typed'
  },

  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
}

// A fast refresh runs this file again. Only the newest copy may hold a connection.
const slot = globalThis as { __driverCopy?: number }
const copy = (slot.__driverCopy ?? 0) + 1

slot.__driverCopy = copy

function dial(): void {
  if (slot.__driverCopy !== copy) {
    return
  }

  const socket = new WebSocket(`ws://127.0.0.1:${PORT}`)

  socket.onmessage = event => {
    const { id, code } = JSON.parse(String(event.data)) as { id: number; code: string }

    // The script is the developer's own. Running its text is the purpose of this file.
    Promise.resolve((0, eval)(`(async h => (${code}))`)(helpers))
      .then(value => socket.send(JSON.stringify({ id, value: value ?? null })))
      .catch(error => socket.send(JSON.stringify({ id, error: String(error) })))
  }

  socket.onclose = () => setTimeout(dial, REDIAL_MS)
}

dial()
