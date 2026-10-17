import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'

import { backgroundHeading, type BackgroundJob, backgroundLine } from '@/core/background'
import { faultWords } from '@/core/format'
import { $background, dismissBackground, stopBackground } from '@/store/background'
import { lineOf, MONO, radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * The commands this chat left running, over the message field: a line that
 * says how many run, and under it each command with a way to stop it. Nothing
 * shows when the chat has none.
 */
export function BackgroundPanel({ sessionId }: { sessionId: string }) {
  const t = useTheme()
  const jobs = useStore($background)[sessionId]
  const [closed, setClosed] = useState(false)
  const [stopping, setStopping] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)

  if (!jobs?.length) {
    return null
  }

  const stop = (job: BackgroundJob) => {
    setStopping(job.id)
    setFault(null)
    stopBackground(sessionId, job.id)
      .catch(error => setFault(faultWords(error)))
      .finally(() => setStopping(null))
  }

  return (
    <View style={[styles.panel, { backgroundColor: t.soft }]}>
      <Pressable
        accessibilityHint={closed ? 'Shows the background commands' : 'Hides the background commands'}
        accessibilityLabel={backgroundHeading(jobs)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !closed }}
        hitSlop={6}
        onPress={() => setClosed(!closed)}
        style={styles.head}
      >
        <Feather color={t.muted} name="terminal" size={14} />
        <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.ink, fontWeight: '600' }]}>
          {backgroundHeading(jobs)}
        </Text>
        <Feather color={t.muted} name={closed ? 'chevron-up' : 'chevron-down'} size={16} />
      </Pressable>

      {closed
        ? null
        : jobs.map(job => (
            <View key={job.id} style={[styles.row, { borderTopColor: t.line }]}>
              <View style={styles.fill}>
                <Text numberOfLines={1} style={[styles.command, { color: t.ink }]}>
                  {job.command}
                </Text>
                <Text numberOfLines={1} style={[type.small, { color: job.state === 'failed' ? t.red : t.muted }]}>
                  {backgroundLine(job)}
                </Text>
              </View>
              {stopping === job.id ? (
                <ActivityIndicator color={t.muted} size="small" />
              ) : (
                <Pressable
                  accessibilityLabel={job.state === 'running' ? `Stop ${job.command}` : `Clear ${job.command}`}
                  accessibilityRole="button"
                  hitSlop={10}
                  onPress={() => (job.state === 'running' ? stop(job) : dismissBackground(sessionId, job.id))}
                  style={[styles.action, { backgroundColor: t.paper }]}
                >
                  <Feather color={job.state === 'running' ? t.red : t.muted} name={job.state === 'running' ? 'square' : 'x'} size={15} />
                </Pressable>
              )}
            </View>
          ))}
      {fault && !closed ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  panel: { marginHorizontal: space.md, marginBottom: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, gap: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  command: { fontFamily: MONO, fontSize: 12, lineHeight: lineOf(17) },
  action: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }
})
