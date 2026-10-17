import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { Arrival } from '@/core/arrivals'
import type { Bot } from '@/core/bots'
import { chatMentionParts, type TextPart } from '@/core/mentions'
import { $bots } from '@/store/bots'
import { openBotChat } from '@/store/chat'
import { MONO, type Palette, radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { BotAvatar } from './bot-sheet'
import { Markdown } from './markdown'
import { MentionText } from './mention-text'

const FACE = 30
/** A schedule can give a long report. Its first lines say what it is about. */
const FOLDED_LINES = 4

const EVENT_ICON = { done: 'check-circle', failed: 'alert-circle', info: 'activity' } as const

/**
 * Something the bot was given that the user did not write. It is not a
 * message of the user (right, filled) and not an answer of the bot (plain
 * words). A sender has a face and a name over a card with a line around it:
 * another bot, or a schedule. The end of a background task is one quiet line
 * that opens to its record.
 */
export function ArrivalRow({ arrival, mentions }: { arrival: Arrival; /** Splits words into plain text and the bots they name. */ mentions?: (text: string) => readonly TextPart[] }) {
  const t = useTheme()
  const bots = useStore($bots)

  if (arrival.kind === 'event') {
    return <EventLine arrival={arrival} bots={bots ?? []} t={t} />
  }

  if (arrival.kind === 'schedule') {
    return (
      <Sender
        face={
          <View style={[styles.face, { backgroundColor: t.accentBg }]}>
            <Feather color={t.accent} name="clock" size={15} />
          </View>
        }
        name={arrival.name}
        t={t}
        what="Schedule"
      >
        <Folded mentions={mentions} t={t} text={arrival.text || 'It gave no output.'} />
      </Sender>
    )
  }

  // The host calls the main bot "hermes" in a message.
  const bot = bots?.find(known => known.name === arrival.handle || (known.isDefault && arrival.handle === 'hermes'))

  return (
    <Sender
      face={bot ? <BotAvatar bot={bot} size={FACE} t={t} /> : <View style={[styles.face, { backgroundColor: t.soft }]} />}
      name={bot?.title ?? arrival.name}
      // The face and the name of the sender open the chat with it.
      onOpen={bot ? () => void openBotChat(bot).catch(() => undefined) : undefined}
      t={t}
      what="Bot"
    >
      <Markdown mentions={mentions} text={arrival.text} />
    </Sender>
  )
}

function Sender({ face, name, what, t, onOpen, children }: { face: React.ReactNode; name: string; /** What kind of sender it is, in one word. */ what: string; t: Palette; /** Opens the sender, when it is a bot the app knows. */ onOpen?: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.sender}>
      <Pressable accessibilityElementsHidden disabled={!onOpen} hitSlop={6} onPress={onOpen}>
        {face}
      </Pressable>
      <View style={styles.fill}>
        <Pressable
          accessibilityHint={onOpen ? 'Opens the chat with this bot' : undefined}
          accessibilityLabel={`${what}: ${name}`}
          accessibilityRole={onOpen ? 'button' : 'text'}
          disabled={!onOpen}
          hitSlop={6}
          onPress={onOpen}
          style={styles.byline}
        >
          <Text numberOfLines={1} style={[type.small, styles.shrink, { color: t.ink, fontWeight: '700' }]}>
            {name}
          </Text>
          <Text style={[styles.tag, { color: t.muted, borderColor: t.line }]}>{what}</Text>
          {onOpen ? <Feather color={t.muted} name="chevron-right" size={14} /> : null}
        </Pressable>
        <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.line }]}>{children}</View>
      </View>
    </View>
  )
}

function Folded({ text, t, mentions }: { text: string; t: Palette; mentions?: (text: string) => readonly TextPart[] }) {
  const [open, setOpen] = useState(false)
  // A short output needs no fold.
  const long = text.length > 220 || text.split('\n').length > FOLDED_LINES

  if (!long || open) {
    return <Markdown mentions={mentions} text={text} />
  }

  return (
    <>
      <Text numberOfLines={FOLDED_LINES} style={[type.body, { color: t.ink }]}>
        {text.replace(/\n{2,}/g, '\n')}
      </Text>
      <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setOpen(true)}>
        <Text style={[type.small, { color: t.accent, fontWeight: '600' }]}>Show all</Text>
      </Pressable>
    </>
  )
}

function EventLine({ arrival, bots, t }: { arrival: Extract<Arrival, { kind: 'event' }>; bots: readonly Bot[]; t: Palette }) {
  const [open, setOpen] = useState(false)
  const colour = arrival.tone === 'failed' ? t.red : t.muted

  return (
    <View style={styles.event}>
      <Pressable accessibilityHint="Shows the record of the host" accessibilityRole="button" accessibilityState={{ expanded: open }} disabled={!arrival.detail} hitSlop={8} onPress={() => setOpen(value => !value)} style={styles.eventHead}>
        <Feather color={colour} name={EVENT_ICON[arrival.tone]} size={15} />
        <Text style={[type.small, styles.shrink, { color: colour, fontWeight: '600' }]}>
          {/* The title can name a bot ("@reviewer"): it shows as the bot. */}
          <MentionText parts={chatMentionParts(arrival.title, bots, undefined, null)} />
        </Text>
        {arrival.detail ? <Feather color={t.muted} name={open ? 'chevron-down' : 'chevron-right'} size={15} /> : null}
      </Pressable>
      {open ? (
        <Text selectable style={[styles.record, { color: t.muted, backgroundColor: t.soft }]}>
          {arrival.detail}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, gap: space.xs },
  shrink: { flexShrink: 1 },
  sender: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, maxWidth: '94%' },
  face: { width: FACE, height: FACE, borderRadius: FACE / 2, alignItems: 'center', justifyContent: 'center' },
  byline: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 20 },
  tag: { fontSize: 11, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  // The corner by the face is tight: the card comes from the sender.
  card: { alignSelf: 'flex-start', maxWidth: '100%', padding: space.md, borderRadius: radius.md, borderTopLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth, gap: space.sm },
  event: { gap: space.sm },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 24 },
  record: { fontFamily: MONO, fontSize: 12, lineHeight: 17, padding: space.md, borderRadius: radius.sm, overflow: 'hidden' }
})
