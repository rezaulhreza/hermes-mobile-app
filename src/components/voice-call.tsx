import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { requestSummary } from '@/core/requests'
import type { TranscriptItem } from '@/core/transcript'
import { callTimer, type CallPhase, PHASE_HEADING, PHASE_HINT } from '@/core/voice'
import { $requests } from '@/store/requests'
import { $preferences } from '@/store/preferences'
import { $call, $callLevel, $engines, type Call, endCall, interruptCall, restartCall, setCallMuted, setCallSpeaker, showCallFull } from '@/store/voice'
import { MONO, type Palette, radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton } from './ui'
import { EngineChoices } from './voice-engines'

interface Props {
  sessionId: string
  title: string
  /** The rows of the conversation. The answer on screen is the one that streams there. */
  items: readonly TranscriptItem[]
}

function useSeconds(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [])

  return Math.max(0, (now - startedAt) / 1000)
}

/** The colour of a phase: green while the microphone is open, the accent while the agent has the turn. */
function phaseColours(phase: CallPhase, muted: boolean, t: Palette): { strong: string; soft: string } {
  if (muted) {
    return { strong: t.muted, soft: t.soft }
  }

  return phase === 'listening' || phase === 'hearing' ? { strong: t.green, soft: t.greenBg } : { strong: t.accent, soft: t.accentBg }
}

const BAR_SHAPE = [0.45, 0.8, 1, 0.7, 0.9]

/** Five bars that follow the level. With no level (the agent's turn) they hold a low, even shape. */
function Bars({ level, colour, height }: { level: number; colour: string; height: number }) {
  return (
    <View style={[styles.bars, { height }]}>
      {BAR_SHAPE.map((shape, index) => (
        <View key={index} style={{ width: height / 7, borderRadius: height / 14, backgroundColor: colour, height: Math.max(height / 6, height * shape * (0.25 + 0.75 * level)) }} />
      ))}
    </View>
  )
}

/** The bars of the live microphone. Only this draws again when the level changes. */
function LiveBars({ colour, height, floor }: { colour: string; height: number; floor: number }) {
  return <Bars colour={colour} height={height} level={Math.max(useStore($callLevel), floor)} />
}

/** The circle of the call. It grows a little with the voice of the user. */
function Halo({ open, colour, children, ...rest }: { open: boolean; colour: string; children: ReactNode } & Omit<ComponentProps<typeof Pressable>, 'style' | 'children'>) {
  const level = useStore($callLevel)

  return (
    <Pressable {...rest} style={[styles.halo, { backgroundColor: colour, transform: [{ scale: 1 + (open ? level * 0.12 : 0) }] }]}>
      {children}
    </Pressable>
  )
}

/** What the agent says now: the answer after the last message of the user, as it streams. */
function answerText(items: readonly TranscriptItem[]): string {
  const from = items.map(item => item.kind).lastIndexOf('user')

  return items
    .slice(from + 1)
    .flatMap(item => (item.kind === 'assistant' ? [item.text.trim()] : []))
    .join('\n\n')
}

/**
 * The call, full screen: who you talk to, a circle that shows who has the
 * turn, the words of both sides, and the three things a call needs to hand:
 * mute, back to the chat, end.
 */
export function VoiceCallScreen({ sessionId, title, items }: Props) {
  const call = useStore($call)

  if (!call || call.sessionId !== sessionId || !call.full) {
    return null
  }

  return <FullCall call={call} items={items} title={title} />
}

function FullCall({ call, title, items }: { call: Call; title: string; items: readonly TranscriptItem[] }) {
  const t = useTheme()
  const speaker = useStore($preferences).speaker
  const insets = useSafeAreaInsets()
  const seconds = useSeconds(call.startedAt)
  const requests = useStore($requests).filter(request => request.sessionId === call.sessionId)
  const colours = phaseColours(call.phase, call.muted, t)
  // The last exchange stays on screen while the call listens again: the user may want to read what was said.
  const answer = call.heard ? answerText(items) : ''
  // The microphone is open in every phase of a duplex call, so the circle always follows the voice of the user.
  const open = !call.muted && call.phase !== 'connecting'
  const hide = () => showCallFull(false)
  const [choosing, setChoosing] = useState(false)
  const engineLabel = useStore($engines)?.find(choice => choice.name === call.engine)?.label ?? 'Voice'

  return (
    <Modal animationType="slide" onRequestClose={hide} presentationStyle="fullScreen" visible>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingTop: insets.top + space.sm, paddingBottom: Math.max(insets.bottom, space.md) }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Talk to Hermes</Text>
          <IconButton icon="chevron-down" label="Hide the Live voice view" onPress={hide} />
        </View>
        <View style={styles.sub}>
          <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
            {title || 'New chat'}
          </Text>
          <Text style={[styles.timer, { color: t.ink }]}>{callTimer(seconds)}</Text>
        </View>

        <Pressable
          accessibilityHint="Choose another speech engine for Live voice"
          accessibilityLabel="Speech engine"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setChoosing(open => !open)}
          style={[styles.engine, { backgroundColor: t.soft }]}
        >
          <Feather color={t.muted} name="radio" size={14} />
          <Text style={[type.small, { color: t.ink }]}>{engineLabel}</Text>
          <Feather color={t.muted} name={choosing ? 'chevron-up' : 'chevron-down'} size={14} />
        </Pressable>

        {choosing ? (
          <View style={[styles.engines, { backgroundColor: t.paper, borderColor: t.line }]}>
            <EngineChoices
              onChoose={choice => {
                setChoosing(false)

                if (choice.name !== call.engine) {
                  void restartCall().catch(() => undefined)
                }
              }}
            />
          </View>
        ) : null}

        <View style={styles.stage}>
          <Halo
            accessibilityHint={PHASE_HINT[call.phase]}
            accessibilityLabel={call.muted ? 'Muted' : PHASE_HEADING[call.phase]}
            accessibilityRole="button"
            colour={colours.soft}
            onPress={interruptCall}
            open={open}
          >
            <View style={[styles.orb, { backgroundColor: t.bg }]}>
              {call.muted ? (
                <Feather color={colours.strong} name="mic-off" size={44} />
              ) : open ? (
                <LiveBars colour={colours.strong} floor={call.phase === 'speaking' || call.phase === 'thinking' ? 0.3 : 0} height={64} />
              ) : (
                <Bars colour={colours.strong} height={64} level={0.3} />
              )}
            </View>
          </Halo>

          <Text style={[type.title, { color: t.ink, textAlign: 'center' }]}>{call.muted ? 'Muted.' : PHASE_HEADING[call.phase]}</Text>

          {/* The words of both sides. This is the part of a call a person checks: "did it hear me right?" */}
          <ScrollView contentContainerStyle={styles.words} style={styles.wordsBox}>
            {call.partial || call.heard ? (
              <Text style={[type.body, { color: call.partial ? t.ink : t.muted, textAlign: 'center' }]}>
                <Text style={styles.strong}>You  </Text>
                {call.partial || call.heard}
              </Text>
            ) : null}
            {call.partial ? null : answer ? (
              <Text style={[type.body, { color: t.ink, textAlign: 'center' }]}>{answer}</Text>
            ) : !call.heard ? (
              <Text style={[type.body, { color: t.muted, textAlign: 'center' }]}>{call.muted ? 'The microphone is off. Hermes hears nothing.' : PHASE_HINT[call.phase]}</Text>
            ) : null}
          </ScrollView>
        </View>

        {call.error ? <Text style={[type.small, styles.error, { color: t.red, backgroundColor: t.redBg }]}>{call.error}</Text> : null}

        {requests.length ? (
          <Pressable accessibilityHint="Goes to the chat, where you can answer" accessibilityRole="button" onPress={hide} style={[styles.needs, { borderTopColor: t.line }]}>
            <Feather color={t.accent} name="shield" size={18} />
            <View style={styles.fill}>
              <Text style={[type.small, { color: t.accent, fontWeight: '700' }]}>Hermes needs you</Text>
              <Text numberOfLines={1} style={[type.small, { color: t.ink }]}>
                {requestSummary(requests[0])}
              </Text>
            </View>
            <Text style={[type.label, { color: t.accent }]}>Review</Text>
          </Pressable>
        ) : null}

        <View style={[styles.bar, { borderTopColor: t.line }]}>
          <IconButton icon={call.muted ? 'mic-off' : 'mic'} label={call.muted ? 'Turn the microphone on' : 'Mute'} onPress={() => setCallMuted(!call.muted)} />
          <IconButton
            icon={speaker ? 'volume-2' : 'phone'}
            label={speaker ? 'Loudspeaker is on. Use the earpiece' : 'Earpiece is on. Use the loudspeaker'}
            onPress={() => setCallSpeaker(!speaker)}
          />
          <IconButton icon="message-circle" label="Show the chat" onPress={hide} />
          <Pressable accessibilityLabel="End Live voice" accessibilityRole="button" onPress={endCall} style={[styles.end, { backgroundColor: t.redBg }]}>
            <Feather color={t.red} name="x" size={22} />
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

/** The same call as a strip above the message field, for when the user wants the chat on screen. */
export function VoiceStrip({ sessionId }: { sessionId: string }) {
  const t = useTheme()
  const call = useStore($call)

  if (!call || call.sessionId !== sessionId || call.full) {
    return null
  }

  return <Strip call={call} t={t} />
}

function Strip({ call, t }: { call: Call; t: Palette }) {
  const seconds = useSeconds(call.startedAt)
  const colours = phaseColours(call.phase, call.muted, t)

  return (
    <View style={[styles.strip, { backgroundColor: colours.soft }]}>
      <Pressable accessibilityLabel="Show Live voice" accessibilityRole="button" onPress={() => showCallFull(true)} style={styles.stripMain}>
        {!call.muted && call.phase !== 'connecting' ? <LiveBars colour={colours.strong} floor={0.15} height={18} /> : <Bars colour={colours.strong} height={18} level={0.3} />}
        <Text numberOfLines={1} style={[type.small, styles.shrink, { color: t.ink, fontWeight: '700' }]}>
          {call.muted ? 'Muted' : PHASE_HEADING[call.phase].replace(/\.$/, '')}
        </Text>
        <Text style={[styles.timer, { color: t.muted }]}>{callTimer(seconds)}</Text>
      </Pressable>
      <Pressable accessibilityLabel={call.muted ? 'Turn the microphone on' : 'Mute'} accessibilityRole="button" hitSlop={10} onPress={() => setCallMuted(!call.muted)}>
        <Feather color={t.ink} name={call.muted ? 'mic-off' : 'mic'} size={18} />
      </Pressable>
      <Pressable accessibilityLabel="Show Live voice" accessibilityRole="button" hitSlop={10} onPress={() => showCallFull(true)}>
        <Feather color={t.ink} name="maximize-2" size={18} />
      </Pressable>
      <Pressable accessibilityLabel="End Live voice" accessibilityRole="button" hitSlop={10} onPress={endCall}>
        <Feather color={t.red} name="x" size={18} />
      </Pressable>
    </View>
  )
}

const ORB = 176

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  strong: { fontWeight: '700' },
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg },
  sub: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.xs },
  timer: { fontFamily: MONO, fontSize: 13, fontVariant: ['tabular-nums'] },
  engine: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space.xs, marginLeft: space.lg, marginTop: space.sm, paddingHorizontal: space.md, minHeight: 32, borderRadius: 16 },
  engines: { marginHorizontal: space.lg, marginTop: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.xl },
  halo: { width: ORB + 40, height: ORB + 40, borderRadius: (ORB + 40) / 2, alignItems: 'center', justifyContent: 'center' },
  orb: { width: ORB, height: ORB, borderRadius: ORB / 2, alignItems: 'center', justifyContent: 'center' },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wordsBox: { maxHeight: 190, alignSelf: 'stretch', flexGrow: 0 },
  words: { gap: space.md },
  error: { marginHorizontal: space.lg, marginBottom: space.md, padding: space.md, borderRadius: radius.md, textAlign: 'center' },
  needs: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  end: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  strip: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginHorizontal: space.md, paddingHorizontal: space.md, minHeight: 44, borderRadius: radius.md },
  stripMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm }
})
