import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import type { Bot } from '@/core/bots'
import { roundLine, type Turn, turnWords } from '@/core/rounds'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { BotAvatar } from './bot-sheet'

interface RoomActivityProps {
  /** The turns of the round. Empty for a host that names none: the strip then says only that the bots work. */
  turns: readonly Turn[]
  /** The bots answer now. After the round the strip stays only to say that a bot did not answer. */
  working: boolean
  bots: ReadonlyMap<string, Bot>
}

/**
 * What the bots of a group chat do now: one line with the bot that works, and
 * under it, on a tap, every turn of the round with its state and its time.
 */
export function RoomActivity({ turns, working, bots }: RoomActivityProps) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  const title = (member: string) => bots.get(member)?.title ?? member
  const failed = turns.filter(turn => turn.state === 'failed')

  // The times count while a bot works. No timer runs after the round.
  useEffect(() => {
    if (!working) {
      return
    }

    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [working])

  if (!working && !failed.length) {
    return null
  }

  const line = working
    ? (roundLine(turns, title) ?? 'The bots answer in turn.')
    : `${failed.map(turn => title(turn.member)).join(' and ')} did not answer.`

  return (
    <View style={[styles.strip, { backgroundColor: t.paper, borderColor: t.line }]}>
      <Pressable
        accessibilityHint={turns.length ? (open ? 'Hides the turns of the round' : 'Shows the turns of the round') : undefined}
        accessibilityLabel={line}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        disabled={!turns.length}
        onPress={() => setOpen(value => !value)}
        style={styles.head}
      >
        {working ? <ActivityIndicator color={t.muted} size="small" /> : <Feather color={t.red} name="alert-circle" size={16} />}
        <Text numberOfLines={2} style={[type.small, styles.fill, { color: t.ink }]}>
          {line}
        </Text>
        {turns.length ? <Feather color={t.muted} name={open ? 'chevron-down' : 'chevron-up'} size={18} /> : null}
      </Pressable>
      {open
        ? turns.map((turn, index) => {
            const bot = bots.get(turn.member)
            const live = turn.state === 'working' || turn.state === 'stopping'

            return (
              <View key={index} style={[styles.turn, { borderTopColor: t.line }]}>
                {bot ? <BotAvatar bot={bot} size={22} t={t} /> : <View style={[styles.unknown, { backgroundColor: t.soft }]} />}
                <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.ink, fontWeight: live ? '700' : '400' }]}>
                  {title(turn.member)}
                </Text>
                <Text style={[type.small, styles.words, { color: turn.state === 'failed' ? t.red : live ? t.ink : t.muted }]}>{turnWords(turn, now)}</Text>
              </View>
            )
          })
        : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strip: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.md },
  turn: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36, paddingHorizontal: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  unknown: { width: 22, height: 22, borderRadius: 11 },
  // The time changes every second: digits of one width keep the words still.
  words: { fontVariant: ['tabular-nums'] }
})
