import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import type { Bot } from '@/core/bots'
import { duration, faultWords } from '@/core/format'
import { type Round, type Turn, turnWords } from '@/core/rounds'
import type { TranscriptItem } from '@/core/transcript'
import { readTurnWork } from '@/store/rooms'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { BotAvatar } from './bot-sheet'
import { Markdown } from './markdown'
import { Button, IconButton } from './ui'

const READ_MS = 2500

interface RoundSheetProps {
  round: Round
  bots: ReadonlyMap<string, Bot>
  /** Stop the bot that works and the turns that wait. */
  onStop: () => Promise<void>
  onClose: () => void
}

const live = (turn: Turn) => turn.state === 'working' || turn.state === 'stopping'

/**
 * The round of a group chat in full: every turn, and for the turn the user
 * picks, what the bot does in it: its thoughts, its tools and the answer as
 * far as it is written. It opens on the bot that works now.
 */
export function RoundSheet({ round, bots, onStop, onClose }: RoundSheetProps) {
  const t = useTheme()
  const { turns } = round
  const [now, setNow] = useState(Date.now)
  const [picked, setPicked] = useState<string | null>(null)
  // The turn on show: the one the user picked, else the one that works, else the last one.
  const turn = turns.find(known => known.taskId === picked) ?? turns.find(live) ?? turns[turns.length - 1]
  const running = turns.some(live)
  const [work, setWork] = useState<{ taskId: string; items: TranscriptItem[] } | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [stopFault, setStopFault] = useState<string | null>(null)
  const title = (member: string) => bots.get(member)?.title ?? member
  const taskId = turn?.taskId
  const member = turn?.member
  const session = turn?.session
  const turnLive = turn ? live(turn) : false

  useEffect(() => {
    if (!running) {
      return
    }

    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [running])

  // Read the work of the turn on show, and read it again while its bot works.
  useEffect(() => {
    if (!member || !session) {
      return
    }

    let closed = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const read = () => {
      readTurnWork(member, session)
        .then(items => {
          if (!closed) {
            setWork({ taskId: taskId ?? '', items })
            setFault(null)
          }
        })
        .catch(error => !closed && setFault(faultWords(error)))
        .finally(() => {
          if (!closed && turnLive) {
            timer = setTimeout(read, READ_MS)
          }
        })
    }

    read()

    return () => {
      closed = true

      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [taskId, member, session, turnLive])

  const items = work && work.taskId === (taskId ?? '') ? work.items : null

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <Text numberOfLines={1} style={[type.heading, styles.fill, { color: t.ink }]}>
            Activity
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.turns, { backgroundColor: t.paper, borderColor: t.line }]}>
            {turns.map((known, index) => {
              const bot = bots.get(known.member)
              const shown = known === turn

              return (
                <Pressable
                  accessibilityLabel={`${title(known.member)}: ${turnWords(known, now)}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: shown }}
                  key={known.taskId || index}
                  onPress={() => setPicked(known.taskId)}
                  style={[styles.turn, index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, shown && { backgroundColor: t.soft }]}
                >
                  {bot ? <BotAvatar bot={bot} size={24} t={t} /> : <View style={[styles.unknown, { backgroundColor: t.soft }]} />}
                  <View style={styles.fill}>
                    <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                      {title(known.member)}
                    </Text>
                    {known.why ? <Text style={[type.small, { color: t.muted }]}>Because {known.why}.</Text> : null}
                  </View>
                  <Text style={[type.small, styles.words, { color: known.state === 'failed' ? t.red : live(known) ? t.ink : t.muted }]}>{turnWords(known, now)}</Text>
                  {live(known) ? <ActivityIndicator color={t.muted} size="small" /> : null}
                </Pressable>
              )
            })}
          </View>

          {running ? (
            <View style={styles.stop}>
              {/* The engine stops a room as a whole: the bot at work, and every turn that waits. */}
              <Button
                busy={stopping}
                icon="square"
                label={turns.some(known => known.state === 'waiting') ? 'Stop this bot and the turns that wait' : 'Stop this bot'}
                onPress={() => {
                  setStopping(true)
                  setStopFault(null)
                  onStop()
                    .catch(error => setStopFault(faultWords(error)))
                    .finally(() => setStopping(false))
                }}
                tone="danger"
              />
              {stopFault ? <Text style={[type.small, { color: t.red }]}>{stopFault}</Text> : null}
            </View>
          ) : null}

          {turn ? (
            <View style={styles.work}>
              <Text style={[type.small, { color: t.muted, fontWeight: '600' }]}>
                {turnLive ? `What ${title(turn.member)} does now` : `What ${title(turn.member)} did in this turn`}
              </Text>
              {!turn.session ? (
                <Text style={[type.small, { color: t.muted }]}>This host does not say what a bot does in its turn. Update its group-rooms plugin.</Text>
              ) : fault && !items ? (
                <Text style={[type.small, { color: t.red }]}>{fault}</Text>
              ) : !items ? (
                <ActivityIndicator color={t.muted} />
              ) : !items.length ? (
                <Text style={[type.small, { color: t.muted }]}>{turnLive ? 'It reads the thread. Nothing to show yet.' : 'Nothing was kept of this turn.'}</Text>
              ) : (
                // The host stores a tool call before its result: with no result yet, the last tool of a live turn still runs.
                items.map((item, index) => <WorkRow item={item} key={item.key} running={turnLive && index === items.length - 1} />)
              )}
            </View>
          ) : (
            <Text style={[type.small, { color: t.muted }]}>No bot had a turn yet.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

/** One step of a bot in its turn. */
function WorkRow({ item, running }: { item: TranscriptItem; running: boolean }) {
  const t = useTheme()
  const [open, setOpen] = useState(false)

  switch (item.kind) {
    case 'tool': {
      const detail = item.input ?? item.output

      return (
        <View style={styles.step}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} disabled={!detail} hitSlop={6} onPress={() => setOpen(value => !value)} style={styles.stepHead}>
            {item.state === 'running' || (running && !item.output) ? <ActivityIndicator color={t.muted} size="small" /> : <Feather color={t.green} name="check" size={15} />}
            <Text numberOfLines={open ? undefined : 1} style={[type.small, styles.fill, { color: t.muted }]}>
              <Text style={{ color: t.ink, fontWeight: '600' }}>{item.name}</Text>
              {item.detail ? `  ${item.detail}` : ''}
            </Text>
            {item.durationS !== undefined ? <Text style={[type.small, { color: t.muted }]}>{duration(item.durationS)}</Text> : null}
          </Pressable>
          {open && item.output ? (
            <Text numberOfLines={12} selectable style={[type.small, styles.output, { color: t.muted, backgroundColor: t.soft }]}>
              {item.output}
            </Text>
          ) : null}
        </View>
      )
    }

    case 'thinking':
      return (
        <View style={styles.step}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6} onPress={() => setOpen(value => !value)} style={styles.stepHead}>
            <Feather color={t.muted} name={open ? 'chevron-down' : 'chevron-right'} size={15} />
            <Text numberOfLines={open ? undefined : 1} style={[type.small, styles.fill, { color: t.muted }]}>
              {open ? 'Thought' : item.text.replace(/\s+/g, ' ').trim()}
            </Text>
          </Pressable>
          {open ? <Markdown muted text={item.text} /> : null}
        </View>
      )

    case 'assistant':
      return <Markdown text={item.text} />

    case 'notice':
      return <Text style={[type.small, { color: item.tone === 'error' ? t.red : t.muted }]}>{item.text}</Text>

    default:
      return null
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  body: { padding: space.lg, gap: space.lg },
  turns: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  turn: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, paddingHorizontal: space.md, paddingVertical: space.sm },
  unknown: { width: 24, height: 24, borderRadius: 12 },
  words: { fontVariant: ['tabular-nums'] },
  stop: { gap: space.sm },
  work: { gap: space.md },
  step: { gap: space.sm },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  output: { padding: space.md, borderRadius: radius.sm }
})
