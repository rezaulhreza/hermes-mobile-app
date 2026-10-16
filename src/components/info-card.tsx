import { Feather } from '@expo/vector-icons'
import * as Clipboard from 'expo-clipboard'
import { useContext, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'

import { type CardAction, cardActions, cardText, type InfoCard, titleName } from '@/core/info-cards'
import { fade, radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { SayToAgent } from './draft-card'

/**
 * A call, an event, a place, a reminder, a payment, a contact, a booking or
 * a service to connect, from an answer, as a card: its title, its fields, its notes, and the buttons that
 * fit its kind. A tap on a field copies its value.
 */
export function InfoCardView({ card }: { card: InfoCard }) {
  const t = useTheme()
  const say = useContext(SayToAgent)
  // What was copied last: 'all', or the label of one field. It shows a tick for a moment.
  const [copied, setCopied] = useState<string | null>(null)
  const actions = cardActions(card).filter(action => action.url || say)
  const [first, ...others] = actions
  const name = titleName(card)
  const rest = name === card.title ? '' : card.title.replace(name, '').replace(/^[\s(),:-]+|[\s(),:-]+$/g, '')

  const copy = (what: string, text: string) => {
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  const run = (action: CardAction) => {
    if (action.say) {
      return say?.(action.say)
    }

    if (action.url) {
      void Linking.openURL(action.url).catch(() => Alert.alert(`${action.label} did not open`, 'The card is still here: copy what you need from it.'))
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: t.paper, borderColor: fade(t.ink, 0.15) }]}>
      <View style={styles.head}>
        <Text style={[styles.kind, styles.fill, { color: t.muted }]}>{card.label}</Text>
        <Pressable accessibilityLabel={copied === 'all' ? 'Copied' : 'Copy the card'} accessibilityRole="button" hitSlop={10} onPress={() => copy('all', cardText(card))}>
          <Feather color={copied === 'all' ? t.green : t.ink} name={copied === 'all' ? 'check' : 'copy'} size={19} />
        </Pressable>
      </View>

      <View>
        <Text selectable style={[type.body, styles.strong, { color: t.ink }]}>
          {name}
        </Text>
        {rest ? (
          <Text selectable style={[type.body, { color: t.muted }]}>
            {rest}
          </Text>
        ) : null}
      </View>

      {card.rows.length ? (
        <View style={[styles.rows, { borderTopColor: fade(t.ink, 0.12) }]}>
          {card.rows.map(row => (
            <Pressable
              accessibilityHint="Copies the value"
              accessibilityLabel={`${row.label}: ${row.value}`}
              accessibilityRole="button"
              key={row.label}
              onPress={() => copy(row.label, row.value)}
              style={({ pressed }) => [styles.row, pressed && styles.dim]}
            >
              <Text style={[type.small, styles.label, { color: t.muted }]}>{row.label}</Text>
              <Text style={[type.body, styles.fill, { color: t.ink }]}>{row.value}</Text>
              {copied === row.label ? <Feather color={t.green} name="check" size={15} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {card.notes ? (
        <Text selectable style={[type.body, styles.notes, { borderTopColor: fade(t.ink, 0.12), color: t.ink }]}>
          {card.notes}
        </Text>
      ) : null}

      {first ? (
        <Pressable accessibilityLabel={`${first.label}: ${name}`} accessibilityRole="button" onPress={() => run(first)} style={({ pressed }) => [styles.first, { backgroundColor: t.ink }, pressed && styles.dim]}>
          <Feather color={t.bg} name={first.icon} size={17} />
          <Text style={[type.label, { color: t.bg }]}>{first.label}</Text>
        </Pressable>
      ) : null}
      {others.length ? (
        <View style={styles.others}>
          {others.map(action => (
            <Pressable
              accessibilityLabel={`${action.label}: ${name}`}
              accessibilityRole="button"
              key={action.label}
              onPress={() => run(action)}
              style={({ pressed }) => [styles.other, { backgroundColor: fade(t.ink, 0.1) }, pressed && styles.dim]}
            >
              <Feather color={t.ink} name={action.icon} size={15} />
              <Text style={[type.small, styles.strong, { color: t.ink }]}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { opacity: 0.6 },
  strong: { fontWeight: '700' },
  card: { gap: space.md, padding: 20, borderRadius: 22, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  kind: { fontSize: 15 },
  rows: { gap: space.sm, paddingTop: space.md, borderTopWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  label: { width: 84 },
  notes: { paddingTop: space.md, borderTopWidth: 1 },
  first: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, borderRadius: radius.pill },
  others: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  other: { height: 36, flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, borderRadius: radius.pill }
})
