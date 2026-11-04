import { Feather } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import type { Bot } from '@/core/bots'
import type { TextPart } from '@/core/mentions'
import { faultWords } from '@/core/format'
import { activityWords, afterRound, assignedLine, type RoomTeam, type Round, type RoundAction, roundLine, turnWords } from '@/core/rounds'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { BotAvatar } from './bot-sheet'
import { RoundSheet } from './round-sheet'
import { Button } from './ui'

type Approval = Extract<RoundAction, { kind: 'approval' }>
type Discard = Extract<RoundAction, { kind: 'discard' }>

interface RoomActivityProps {
  /** The round of the room. With no turn (an older host), the strip says only that the bots work. */
  round: Round
  /** The bots answer now. After the round the strip stays only when there is something to say. */
  working: boolean
  bots: ReadonlyMap<string, Bot>
  /** Splits a text into plain words and the mentions the host follows, for their colour in the sheet. */
  marked: (text: string) => readonly TextPart[]
  /** How the room works as a team: what each bot does now. Null from an older host. */
  team: RoomTeam | null
  onRetry: (taskId: string) => Promise<void>
  onDiscard: (action: Discard) => Promise<void>
  onContinue: (discussion: string) => Promise<void>
  onStop: () => Promise<void>
  onStopTurn: (taskId: string) => Promise<void>
  onApproval: (action: Approval, choice: 'once' | 'deny') => Promise<void>
}

/**
 * What the bots of a group chat do now: one line with the bot that works. A
 * tap opens the round in full: every turn with its state and its time, and
 * what the bot of a turn does in it. A host that does not say what a bot does
 * shows the turns under the line. What the round waits for from the user is
 * always in view: a bot that asks for a yes, and a turn that can run again.
 */
export function RoomActivity({ round, working, bots, marked, team, onRetry, onDiscard, onContinue, onStop, onStopTurn, onApproval }: RoomActivityProps) {
  const t = useTheme()
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const [lettingGo, setLettingGo] = useState<string | null>(null)
  const title = (member: string) => bots.get(member)?.title ?? member
  const { turns, actions } = round
  const asks = actions.filter((action): action is Approval => action.kind === 'approval')
  const retries = new Set(actions.flatMap(action => (action.kind === 'retry' ? [action.taskId] : [])))
  const discards = new Map(actions.flatMap(action => (action.kind === 'discard' ? [[action.taskId, action] as const] : [])))
  const after = afterRound(round, title)
  const assigned = assignedLine(round.assigned, title)
  // What each bot does now, from the process that runs its turn: "Scout · terminal · 7s".
  const busyBots = (team?.activity ?? []).filter(row => row.status === 'running' || row.status === 'stopping')

  // The times count while a bot works. No timer runs after the round.
  useEffect(() => {
    if (!working) {
      return
    }

    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [working])

  if (!working && !after && !actions.length && !round.paused) {
    // The round ended while the user reads its sheet: the sheet stays until they close it.
    return open && turns.some(turn => turn.taskId) ? <RoundSheet bots={bots} marked={marked} onClose={() => setOpen(false)} onStop={onStop} onStopTurn={onStopTurn} round={round} /> : null
  }

  const run = (key: string, work: () => Promise<void>) => {
    setBusy(key)
    setFault(null)
    work()
      .catch(error => setFault(faultWords(error)))
      .finally(() => setBusy(null))
  }

  const live = busyBots.length && !asks.length ? `${activityWords(busyBots[0], title, now)}${busyBots.length > 1 ? ` · ${busyBots.length - 1} more` : ''}` : null
  const line = working || asks.length ? (live ?? roundLine(round, title) ?? 'The bots answer in turn.') : (after ?? 'A turn did not end. You can run it again.')
  // A host that names the task of a turn can also say what its bot does: the sheet shows it. An older host gives the turns only.
  const detailed = turns.some(turn => turn.taskId)
  // A turn to run again is in the list of turns: it must be in view.
  const shown = (open && !detailed) || ((retries.size > 0 || discards.size > 0) && !working)

  return (
    <View style={[styles.strip, { backgroundColor: t.paper, borderColor: t.line }]}>
      {assigned && working ? (
        <View accessibilityLabel={assigned} style={[styles.assigned, { borderBottomColor: t.line }]}>
          <Feather color={t.muted} name="user-check" size={14} />
          <Text style={[type.small, styles.fill, { color: t.muted }]}>{assigned}</Text>
        </View>
      ) : null}
      <Pressable
        accessibilityHint={detailed ? 'Shows what each bot does' : turns.length ? (shown ? 'Hides the turns of the round' : 'Shows the turns of the round') : undefined}
        accessibilityLabel={line}
        accessibilityRole="button"
        accessibilityState={{ expanded: shown }}
        disabled={!turns.length}
        onPress={() => setOpen(value => !value)}
        style={styles.head}
      >
        {asks.length ? (
          <Feather color={t.accent} name="help-circle" size={16} />
        ) : working ? (
          <ActivityIndicator color={t.muted} size="small" />
        ) : (
          <Feather color={after && !round.capped ? t.red : t.muted} name={round.capped && !retries.size ? 'pause-circle' : 'alert-circle'} size={16} />
        )}
        <Text style={[type.small, styles.fill, { color: t.ink }]}>{line}</Text>
        {turns.length ? <Feather color={t.muted} name={detailed ? 'chevron-right' : shown ? 'chevron-down' : 'chevron-up'} size={18} /> : null}
      </Pressable>

      {asks.map(action => (
        <View key={action.requestId} style={[styles.ask, { borderTopColor: t.line }]}>
          <Text style={[type.small, { color: t.muted }]}>{title(action.member)} asks to do this:</Text>
          <Text numberOfLines={6} selectable style={[type.small, { color: t.ink }]}>
            {action.asks || 'The host did not say what. Open the chat of the bot to read it.'}
          </Text>
          <View style={styles.answers}>
            <Button busy={busy === `deny:${action.requestId}`} disabled={busy !== null} label="Deny" onPress={() => run(`deny:${action.requestId}`, () => onApproval(action, 'deny'))} style={styles.fill} />
            <Button busy={busy === `once:${action.requestId}`} disabled={busy !== null} label="Allow once" onPress={() => run(`once:${action.requestId}`, () => onApproval(action, 'once'))} style={styles.fill} tone="primary" />
          </View>
        </View>
      ))}

      {shown
        ? turns.map((turn, index) => {
            const bot = bots.get(turn.member)
            const live = turn.state === 'working' || turn.state === 'stopping'
            const again = retries.has(turn.taskId)

            return (
              <View key={index} style={[styles.turn, { borderTopColor: t.line }]}>
                {bot ? <BotAvatar bot={bot} size={22} t={t} /> : <View style={[styles.unknown, { backgroundColor: t.soft }]} />}
                <View style={styles.fill}>
                  <View style={styles.names}>
                    <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.ink, fontWeight: live ? '700' : '400' }]}>
                      {title(turn.member)}
                    </Text>
                    <Text style={[type.small, styles.words, { color: turn.state === 'failed' ? t.red : live ? t.ink : t.muted }]}>{turnWords(turn, now)}</Text>
                  </View>
                  {turn.why ? <Text style={[type.small, { color: t.muted }]}>Because {turn.why}.</Text> : null}
                </View>
                {discards.has(turn.taskId) && !again ? (
                  <Pressable
                    accessibilityLabel={`Let go of the turn of ${title(turn.member)}`}
                    accessibilityRole="button"
                    disabled={busy !== null}
                    hitSlop={8}
                    onPress={() => setLettingGo(turn.taskId)}
                    style={[styles.again, { borderColor: t.line }, busy !== null && styles.dim]}
                  >
                    <Text style={[type.small, { color: t.red, fontWeight: '600' }]}>Let go</Text>
                  </Pressable>
                ) : null}
                {again ? (
                  <Pressable
                    accessibilityLabel={`Run the turn of ${title(turn.member)} again`}
                    accessibilityRole="button"
                    disabled={busy !== null}
                    hitSlop={8}
                    onPress={() => run(turn.taskId, () => onRetry(turn.taskId))}
                    style={[styles.again, { borderColor: t.line }, busy !== null && styles.dim]}
                  >
                    {busy === turn.taskId ? <ActivityIndicator color={t.ink} size="small" /> : <Text style={[type.small, { color: t.ink, fontWeight: '600' }]}>Run again</Text>}
                  </Pressable>
                ) : null}
              </View>
            )
          })
        : null}

      {round.paused && !working ? (
        <View style={[styles.ask, { borderTopColor: t.line }]}>
          <Text style={[type.small, { color: t.muted }]}>
            {team?.maxRounds ? `They talked for ${team.maxRounds} rounds. ` : ''}Continue gives them more rounds on the same message.
          </Text>
          <Button busy={busy === 'continue'} disabled={busy !== null} icon="play" label="Continue" onPress={() => run('continue', () => onContinue(round.paused as string))} tone="primary" />
        </View>
      ) : null}

      {lettingGo && discards.get(lettingGo) ? (
        <View style={[styles.ask, { borderTopColor: t.line, backgroundColor: t.redBg }]}>
          <Text style={[type.small, { color: t.ink }]}>Let go of the turn of {title(discards.get(lettingGo)?.member ?? '')}? The host does not know if it finished. Its work does not run again.</Text>
          <View style={styles.answers}>
            <Button label="Keep it" onPress={() => setLettingGo(null)} style={styles.fill} />
            <Button
              busy={busy === `discard:${lettingGo}`}
              label="Let it go"
              onPress={() => {
                const action = discards.get(lettingGo)

                if (action) {
                  run(`discard:${lettingGo}`, () => onDiscard(action).then(() => setLettingGo(null)))
                }
              }}
              style={styles.fill}
              tone="danger"
            />
          </View>
        </View>
      ) : null}

      {fault ? <Text style={[type.small, styles.fault, { color: t.red, borderTopColor: t.line }]}>{fault}</Text> : null}
      {open && detailed ? <RoundSheet bots={bots} marked={marked} onClose={() => setOpen(false)} onStop={onStop} onStopTurn={onStopTurn} round={round} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  strip: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  assigned: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.xs, borderBottomWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH, paddingHorizontal: space.md, paddingVertical: space.sm },
  ask: { gap: space.sm, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  answers: { flexDirection: 'row', gap: space.sm },
  turn: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36, paddingHorizontal: space.md, paddingVertical: space.xs, borderTopWidth: StyleSheet.hairlineWidth },
  names: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  unknown: { width: 22, height: 22, borderRadius: 11 },
  // The time changes every second: digits of one width keep the words still.
  words: { fontVariant: ['tabular-nums'] },
  again: { minHeight: 30, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  dim: { opacity: 0.55 },
  fault: { padding: space.md, borderTopWidth: StyleSheet.hairlineWidth }
})
