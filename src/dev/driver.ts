/**
 * Development builds only. Lets `scripts/drive.mjs` on the Mac press buttons
 * and type in the running app, because synthetic taps do not reach the iOS
 * Simulator there. The app dials a loopback port, so only a process on the
 * same machine can drive it, and only while that script listens.
 *
 * `_layout.tsx` loads this file behind `__DEV__`. A release bundle has no
 * copy of it.
 */

import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'

import { $attachments, stage } from '@/store/attachments'
import { $previews } from '@/store/browser'
import { $conversations, $shownSession } from '@/store/chat'
import { $linkState, currentApi, onGatewayEvent, rpc } from '@/store/link'
import { $push, openFromPush, registerPush, unregisterPush } from '@/store/push'
import { $requests } from '@/store/requests'
import { $sessions, $sessionSource, $sessionView } from '@/store/sessions'
import { duplexAudio } from '@/native/duplex-audio'
import { voiceTrace } from '@/store/voice-engine'
import { GptLiveEngine } from '@/store/voice-gpt-live'
import { pcmBytes } from '@/core/live-voice'
import { $call, $dictation, $engines, injectSpeech, setCallMuted } from '@/store/voice'
import { $preferences, setPreference } from '@/store/preferences'
import { $wake, setWake } from '@/store/wake'
import { $work } from '@/store/work'

const PORT = 8099
const REDIAL_MS = 1500
const IDLE_MS = 4000
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

/** The last gateway events whose type starts with the traced prefix, each cut to a readable length. */
const traced: string[] = []
const TRACE_ROWS = 60
const TRACE_CHARS = 1200
let stopTrace: (() => void) | null = null

const helpers = {
  router,
  /** Record gateway events by the start of their type (`h.trace("tool.")`); `h.traced()` reads them. `h.trace()` stops. */
  trace: (prefix?: string) => {
    stopTrace?.()
    stopTrace = null
    traced.length = 0

    if (prefix === undefined) {
      return 'trace off'
    }

    stopTrace = onGatewayEvent(event => {
      if (event.type.startsWith(prefix)) {
        traced.push(JSON.stringify(event).slice(0, TRACE_CHARS))
        traced.splice(0, Math.max(0, traced.length - TRACE_ROWS))
      }
    })

    return `tracing ${prefix}`
  },
  traced: () => traced,
  rpc,
  api: currentApi,
  /** Stage a file by its path, past the native picker that a script cannot use. */
  stage,
  /** The call audio, for a check of the microphone with no call. */
  audio: duplexAudio,
  voiceTrace,
  /** The tap on a notification, which a script cannot make. */
  openFromPush,
  notifications: Notifications,
  registerPush,
  unregisterPush,
  setPreference,
  setWake,
  /** Start the gpt-live engine with no call, to see how far a host with no OpenAI key lets it go. Resolves with what happened. */
  gptLive: async () => {
    const seen: string[] = []
    const note = (name: string) => (...values: unknown[]) => void seen.push(`${name} ${values.join(' ')}`)
    const engine = new GptLiveEngine(currentApi()!, () => [], {
      partial: note('partial'),
      hearing: note('hearing'),
      barge: note('barge'),
      transcribing: note('transcribing'),
      utterance: note('utterance'),
      stopWord: note('stopWord'),
      changed: note('changed'),
      lost: note('lost')
    })

    try {
      await engine.start()
      seen.push('started')
    } catch (error) {
      seen.push(`start failed: ${String(error)}`)
    }

    engine.stop()

    return seen
  },
  /** Say a recording into the call with the microphone muted: base64 of mono int16 PCM at 16 kHz. See `scripts/say-to-call.sh`. */
  hear: (base64: string) => {
    setCallMuted(true)
    duplexAudio?.setMuted(true)
    injectSpeech(pcmBytes(base64))

    return 'fed'
  },
  stores: { $push, $shownSession, $attachments, $previews, $call, $dictation, $engines, $preferences, $wake, $work, $conversations, $linkState, $requests, $sessions, $sessionSource, $sessionView },

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
  let pending = 0
  let idle: ReturnType<typeof setTimeout> | null = null

  // A script that ended with no close frame leaves this socket open and deaf. Drop a socket that is quiet after its last answer.
  const watch = () => {
    if (idle) {
      clearTimeout(idle)
    }

    idle = pending ? null : setTimeout(drop, IDLE_MS)
  }

  // The close event of a deaf socket may never come, so the next dial does not wait for it.
  const drop = () => {
    socket.onclose = null
    socket.onmessage = null
    socket.close()
    setTimeout(dial, REDIAL_MS)
  }

  const answer = (body: object) => {
    pending -= 1
    socket.send(JSON.stringify(body))
    watch()
  }

  socket.onmessage = event => {
    const { id, code } = JSON.parse(String(event.data)) as { id: number; code: string }

    pending += 1
    watch()

    // The script is the developer's own. Running its text is the purpose of this file.
    Promise.resolve((0, eval)(`(async h => (${code}))`)(helpers))
      .then(value => answer({ id, value: value ?? null }))
      .catch(error => answer({ id, error: String(error) }))
  }

  socket.onclose = () => {
    if (idle) {
      clearTimeout(idle)
    }

    setTimeout(dial, REDIAL_MS)
  }
}

dial()
