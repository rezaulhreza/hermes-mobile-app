import { Feather } from '@expo/vector-icons'
import { createContext, useContext, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { faultWords } from '@/core/format'
import { addCreditsWords, creditsWords, type LimitCard as Limit, type LimitSuggestion, resetWords } from '@/core/limits'
import { recoverFromLimit } from '@/store/chat'
import { radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button } from './ui'

/** The live session of the chat on screen. A card of a closed chat offers no button. */
export const ChatSessionContext = createContext<string | null>(null)

/**
 * A turn stopped at the limit of a plan. The card says what ran out and when
 * it is back, and offers the ways on that the host named: a model that still
 * works, or credits. Each one runs the turn again once it applied.
 */
export function LimitCard({ limit }: { limit: Limit }) {
  const t = useTheme()
  const sessionId = useContext(ChatSessionContext)
  const [busy, setBusy] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ suggestion: LimitSuggestion; message: string } | null>(null)
  const [done, setDone] = useState(false)
  const back = resetWords(limit.resetsAt, new Date())
  const credits = creditsWords(limit.credits)
  const addCredits = addCreditsWords(limit.credits)

  const run = (key: string, work: () => Promise<{ done: boolean; confirmMessage?: string }>, suggestion?: LimitSuggestion) => {
    setBusy(key)
    setFault(null)
    work()
      .then(result => {
        if (!result.done && suggestion) {
          setConfirm({ suggestion, message: result.confirmMessage ?? `Switch to ${suggestion.label}?` })
        } else {
          setConfirm(null)
          setDone(true)
        }
      }, error => setFault(faultWords(error)))
      .finally(() => setBusy(null))
  }

  const switchTo = (suggestion: LimitSuggestion, confirmed = false) =>
    sessionId && run(`switch:${suggestion.model}`, () => recoverFromLimit(sessionId, { kind: 'switch', model: suggestion.model, provider: suggestion.provider, label: suggestion.label, confirmed }), suggestion)

  return (
    <View accessibilityLabel={`${limit.message} ${back}`.trim()} style={[styles.card, { backgroundColor: t.paper, borderColor: t.line }]}>
      <View style={styles.head}>
        <Feather color={t.muted} name="clock" size={16} />
        <Text style={[type.label, styles.fill, { color: t.ink }]}>{limit.message}</Text>
      </View>
      {back ? <Text style={[type.small, { color: t.muted }]}>{back}</Text> : null}

      {done ? (
        <Text style={[type.small, { color: t.green }]}>Done. The message runs again.</Text>
      ) : sessionId ? (
        <>
          {limit.suggestions.slice(0, 2).map(suggestion => (
            <View key={suggestion.model} style={styles.way}>
              <Button busy={busy === `switch:${suggestion.model}`} disabled={busy !== null} icon="shuffle" label={`Switch to ${suggestion.label} and try again`} onPress={() => switchTo(suggestion)} />
              {suggestion.note ? <Text style={[type.small, { color: t.muted }]}>{suggestion.note}</Text> : null}
            </View>
          ))}
          {credits ? <Button busy={busy === 'credits'} disabled={busy !== null} icon="credit-card" label={credits} onPress={() => run('credits', () => recoverFromLimit(sessionId, { kind: 'credits' }))} /> : null}
          {limit.suggestions.length ? <Text style={[type.small, { color: t.muted }]}>A switch is for this chat only. The bot keeps its own model.</Text> : null}
        </>
      ) : null}
      {addCredits && !done ? <Text style={[type.small, { color: t.muted }]}>{addCredits}</Text> : null}

      {confirm ? (
        <View style={[styles.confirm, { backgroundColor: t.soft }]}>
          <Text style={[type.small, { color: t.ink }]}>{confirm.message}</Text>
          <View style={styles.line}>
            <Button label="Cancel" onPress={() => setConfirm(null)} style={styles.fill} />
            <Button busy={busy !== null} label="Switch" onPress={() => switchTo(confirm.suggestion, true)} style={styles.fill} tone="primary" />
          </View>
        </View>
      ) : null}
      {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  way: { gap: space.xs },
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.md },
  line: { flexDirection: 'row', gap: space.sm }
})
