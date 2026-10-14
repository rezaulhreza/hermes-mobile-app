import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ChoiceRow, ChoiceSheet } from '@/components/choice'
import { Button, IconButton, Notice } from '@/components/ui'
import { faultWords, relativeTime } from '@/core/format'
import { modelLabel } from '@/core/models'
import { type BackgroundJob, CARE_JOBS, type CareJob, dayName, type Fact, type ForeignChat, LOG_FILES, type LogLine, OPS_VIEWS, type OpsView, shortCount, uptimeWords, type UsageDay, type UsageModel } from '@/core/ops'
import { $linkState } from '@/store/link'
import {
  $backgroundJobs,
  $careOutput,
  $curator,
  $foreignChats,
  $hostFacts,
  $hostUpdate,
  $logLines,
  $usage,
  clearOps,
  importForeignChat,
  loadBackgroundJobs,
  loadCurator,
  loadForeignChats,
  loadHostFacts,
  loadLog,
  loadUsage,
  pauseCurator,
  restartMessaging,
  runCareJob,
  stopBackgroundJob,
  updateHermes
} from '@/store/ops'
import { MONO, radius, space, TOUCH, type } from '@/theme/tokens'
import { usePull } from '@/theme/use-pull'
import { useTheme } from '@/theme/use-theme'

type Row =
  | { kind: 'fact'; id: string; fact: Fact }
  | { kind: 'heading'; id: string; text: string }
  | { kind: 'day'; id: string; day: UsageDay; peak: number }
  | { kind: 'model'; id: string; model: UsageModel }
  | { kind: 'job'; id: string; job: BackgroundJob }
  | { kind: 'log'; id: string; line: LogLine }
  | { kind: 'care'; id: string; job: CareJob }
  | { kind: 'output'; id: string; text: string }
  | { kind: 'curator'; id: string }
  | { kind: 'actions'; id: string }
  | { kind: 'chat'; id: string; chat: ForeignChat }

const PERIODS = [
  { id: '7', label: 'The last 7 days' },
  { id: '30', label: 'The last 30 days' },
  { id: '90', label: 'The last 90 days' }
]

/**
 * The Hermes host: its state, what it used, what runs in the background, its
 * logs, its care jobs and the chats of other tools. One view at a time, each
 * read when it is chosen, all as rows of one virtual list.
 */
export default function Ops() {
  const t = useTheme()
  const linkState = useStore($linkState)
  const facts = useStore($hostFacts)
  const canUpdate = useStore($hostUpdate)
  const usage = useStore($usage)
  const jobs = useStore($backgroundJobs)
  const lines = useStore($logLines)
  const curator = useStore($curator)
  const chats = useStore($foreignChats)
  const care = useStore($careOutput)
  const [view, setView] = useState<OpsView>('status')
  const [days, setDays] = useState('7')
  const [logFile, setLogFile] = useState('errors')
  const [choosing, setChoosing] = useState<'view' | 'days' | 'log' | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const read = (): Promise<unknown> =>
    view === 'status'
      ? loadHostFacts()
      : view === 'usage'
        ? loadUsage(Number(days))
        : view === 'work'
          ? loadBackgroundJobs()
          : view === 'logs'
            ? loadLog(logFile)
            : view === 'care'
              ? loadCurator()
              : loadForeignChats()

  const pull = usePull(read)

  useEffect(() => {
    if (linkState === 'open') {
      read().catch(error => setFault(faultWords(error)))
    }
    // Each view is read when it is chosen, with its own choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkState, view, days, logFile])

  // Nothing of the host stays in the memory of the phone, and no timer reads a job, after the screen.
  useEffect(() => clearOps, [])

  const go = (next: OpsView) => {
    setChoosing(null)
    setFault(null)
    setNote(null)
    setAsking(null)
    setView(next)
  }

  const run = (what: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(what)
    setFault(null)
    setNote(null)
    setAsking(null)
    work()
      .then(() => done && setNote(done))
      .catch(error => setFault(faultWords(error)))
      .finally(() => setBusy(null))
  }

  const named = OPS_VIEWS.find(known => known.view === view) ?? OPS_VIEWS[0]
  const loaded = view === 'status' ? facts : view === 'usage' ? usage : view === 'work' ? jobs : view === 'logs' ? lines : view === 'care' ? curator : chats

  const rows: Row[] =
    view === 'status'
      ? [...(facts ?? []).map((fact): Row => ({ kind: 'fact', id: fact.label, fact })), ...(facts ? [{ kind: 'actions', id: 'actions' } as Row] : [])]
      : view === 'usage' && usage
        ? [
            ...usage.facts.map((fact): Row => ({ kind: 'fact', id: fact.label, fact })),
            ...(usage.models.length ? [{ kind: 'heading', id: 'h-models', text: 'By model' } as Row] : []),
            ...usage.models.map((model): Row => ({ kind: 'model', id: `m-${model.model}`, model })),
            ...(usage.days.length ? [{ kind: 'heading', id: 'h-days', text: 'By day' } as Row] : []),
            ...usage.days.map((day): Row => ({ kind: 'day', id: `d-${day.day}`, day, peak: usage.peak }))
          ]
        : view === 'work'
          ? (jobs ?? []).map((job): Row => ({ kind: 'job', id: job.sessionId, job }))
          : view === 'logs'
            ? (lines ?? []).map((line): Row => ({ kind: 'log', id: line.id, line }))
            : view === 'care'
              ? [
                  // The output of a job comes under its own card.
                  ...CARE_JOBS.flatMap((job): Row[] => [
                    { kind: 'care', id: job.id, job },
                    ...(care?.id === job.id && (care.output.lines.length || care.links.length) ? [{ kind: 'output', id: `o-${job.id}`, text: [...care.output.lines.slice(-80), ...care.links].join('\n') } as Row] : [])
                  ]),
                  ...(curator ? [{ kind: 'curator', id: 'curator' } as Row] : [])
                ]
              : (chats ?? []).map((chat): Row => ({ kind: 'chat', id: chat.id, chat }))

  const confirm = (id: string, words: string, label: string, onYes: () => void) =>
    asking === id ? (
      <View style={[styles.confirm, { backgroundColor: t.redBg }]}>
        <Text style={[type.small, { color: t.ink }]}>{words}</Text>
        <View style={styles.line}>
          <Button label="Not now" onPress={() => setAsking(null)} style={styles.fill} />
          <Button label={label} onPress={onYes} style={styles.fill} tone="danger" />
        </View>
      </View>
    ) : null

  const render = (row: Row) => {
    switch (row.kind) {
      case 'fact':
        return (
          <View style={[styles.fact, { borderBottomColor: t.line }]}>
            <Text style={[type.small, styles.fill, { color: t.muted }]}>{row.fact.label}</Text>
            <Text style={[type.label, styles.value, { color: row.fact.bad ? t.red : t.ink }]}>{row.fact.value}</Text>
          </View>
        )
      case 'heading':
        return <Text style={[type.small, styles.heading, { color: t.muted }]}>{row.text}</Text>
      case 'model':
        return (
          <View style={[styles.fact, { borderBottomColor: t.line }]}>
            <Text numberOfLines={1} style={[type.label, styles.fill, { color: t.ink }]}>
              {modelLabel(row.model.model)}
            </Text>
            <Text style={[type.small, { color: t.muted }]}>
              {shortCount(row.model.tokens)} tokens · {shortCount(row.model.calls)} calls
            </Text>
          </View>
        )
      case 'day':
        return (
          <View accessibilityLabel={`${dayName(row.day.day)}: ${shortCount(row.day.tokens)} tokens`} style={styles.day}>
            <Text style={[type.small, styles.dayName, { color: t.muted }]}>{dayName(row.day.day)}</Text>
            <View style={[styles.track, { backgroundColor: t.soft }]}>
              <View style={[styles.bar, { backgroundColor: t.accent, width: `${Math.max(2, Math.round((row.day.tokens / row.peak) * 100))}%` }]} />
            </View>
            <Text style={[type.small, styles.dayCount, { color: t.ink }]}>{shortCount(row.day.tokens)}</Text>
          </View>
        )
      case 'job':
        return (
          <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.line }]}>
            <Text numberOfLines={2} style={[type.small, { color: t.ink, fontFamily: MONO }]}>
              {row.job.command}
            </Text>
            <Text style={[type.small, { color: t.muted }]}>Runs for {uptimeWords(row.job.uptime)}</Text>
            <Button busy={busy === row.job.sessionId} icon="square" label="Stop it" onPress={() => run(row.job.sessionId, () => stopBackgroundJob(row.job.sessionId))} tone="danger" />
          </View>
        )
      case 'log':
        return (
          <View style={[styles.log, { borderBottomColor: t.line }]}>
            {row.line.time ? (
              <Text style={[type.small, { color: row.line.level === 'ERROR' || row.line.level === 'CRITICAL' ? t.red : t.muted }]}>
                {row.line.time} · {row.line.level === 'WARNING' ? 'Warning' : row.line.level === 'ERROR' || row.line.level === 'CRITICAL' ? 'Fault' : 'Note'}
              </Text>
            ) : null}
            <Text numberOfLines={6} style={[styles.mono, { color: t.ink }]}>
              {row.line.text}
            </Text>
          </View>
        )
      case 'care': {
        const mine = care?.id === row.job.id
        const start = () => run(row.job.id, () => runCareJob(row.job))

        return (
          <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.line }]}>
            <Text style={[type.label, { color: t.ink }]}>{row.job.label}</Text>
            <Text style={[type.small, { color: t.muted }]}>{row.job.detail}</Text>
            {row.job.confirm ? confirm(row.job.id, row.job.confirm, 'Upload it', start) : null}
            {asking === row.job.id ? null : (
              <Button busy={mine && care.output.running} label={`Run the ${row.job.label.toLowerCase()}${mine && !care.output.running ? ' again' : ''}`} onPress={() => (row.job.confirm ? setAsking(row.job.id) : start())} />
            )}
            {mine && !care.output.running ? (
              <Text style={[type.small, { color: care.output.exitCode && !row.job.finds ? t.red : t.muted }]}>{care.output.exitCode ? (row.job.finds ? 'It found things to look at. Its last lines are below.' : 'It ended with a fault. Its last lines are below.') : care.links.length ? 'Done. The links are below.' : 'Done. Its last lines are below.'}</Text>
            ) : null}
          </View>
        )
      }
      case 'output':
        return (
          <Text selectable style={[styles.mono, { color: t.ink }]}>
            {row.text}
          </Text>
        )
      case 'curator':
        return curator ? (
          <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.line }]}>
            <Text style={[type.label, { color: t.ink }]}>Skill curator</Text>
            <Text style={[type.small, { color: t.muted }]}>
              It tidies the skills the bots wrote: it joins doubles and puts away what nobody uses. {curator.enabled ? (curator.paused ? 'It is paused.' : curator.line + '.') : 'It is off on this host.'}
            </Text>
            {curator.enabled ? (
              <Button busy={busy === 'curator'} label={curator.paused ? 'Let it run again' : 'Pause it'} onPress={() => run('curator', () => pauseCurator(!curator.paused))} />
            ) : null}
          </View>
        ) : null
      case 'actions':
        return (
          <View style={styles.actions}>
            {confirm('restart', 'Start the messaging of Hermes again? A bot that answers in a channel now is cut off. The chats in this app stay.', 'Start it again', () =>
              run('restart', restartMessaging, 'Messaging starts again. It answers in some seconds.')
            )}
            {asking === 'restart' ? null : <Button busy={busy === 'restart'} icon="refresh-cw" label="Start messaging again" onPress={() => setAsking('restart')} />}
            {canUpdate ? (
              <>
                {confirm('update', 'Update Hermes on the host now? Hermes stops for some minutes, and this app loses its connection until it is back.', 'Update it', () =>
                  run('update', updateHermes, 'The update runs. Open this screen again in some minutes.')
                )}
                {asking === 'update' ? null : <Button busy={busy === 'update'} icon="download" label="Update Hermes" onPress={() => setAsking('update')} />}
              </>
            ) : null}
          </View>
        )
      case 'chat':
        return (
          <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.line }]}>
            <Text numberOfLines={2} style={[type.label, { color: t.ink }]}>
              {row.chat.title}
            </Text>
            <Text style={[type.small, { color: t.muted }]}>
              {[row.chat.tool, `${row.chat.turns} ${row.chat.turns === 1 ? 'turn' : 'turns'}`, row.chat.at ? relativeTime(row.chat.at) : ''].filter(Boolean).join(' · ')}
            </Text>
            <Button
              busy={busy === row.chat.id}
              icon="download"
              label="Take it into Hermes"
              onPress={() => run(row.chat.id, () => importForeignChat(row.chat.id).then(id => router.push({ pathname: '/chat/[id]', params: { id } })))}
            />
          </View>
        )
    }
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>The host</Text>
      </View>

      <FlatList
        ListEmptyComponent={
          !loaded ? (
            fault ? (
              <Notice detail={fault} icon="alert-triangle" title="Could not read this" />
            ) : (
              <ActivityIndicator color={t.muted} style={styles.wait} />
            )
          ) : (
            <Notice
              icon={named.icon}
              title={view === 'work' ? 'Nothing runs in the background' : view === 'logs' ? 'This log is empty' : view === 'import' ? 'The host has no chat of another tool' : 'Nothing here'}
            />
          )
        }
        ListHeaderComponent={
          <View style={styles.top}>
            <ChoiceRow icon={named.icon} label="Show" onPress={() => setChoosing('view')} value={named.label} />
            {view === 'usage' ? <ChoiceRow icon="calendar" label="Time" onPress={() => setChoosing('days')} value={PERIODS.find(period => period.id === days)?.label ?? ''} /> : null}
            {view === 'logs' ? <ChoiceRow icon="file-text" label="Log" onPress={() => setChoosing('log')} value={LOG_FILES.find(file => file.id === logFile)?.label ?? ''} /> : null}
            {fault && loaded ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
            {note ? <Text style={[type.small, { color: t.ink }]}>{note}</Text> : null}
          </View>
        }
        contentContainerStyle={styles.content}
        data={rows}
        initialNumToRender={16}
        keyExtractor={row => row.id}
        onRefresh={pull.onRefresh}
        refreshing={pull.refreshing}
        renderItem={({ item }) => render(item)}
        windowSize={7}
      />

      {choosing === 'view' ? (
        <ChoiceSheet choices={OPS_VIEWS.map(known => ({ id: known.view, label: known.label, detail: known.detail }))} current={view} onClose={() => setChoosing(null)} onPick={picked => go(picked as OpsView)} title="Show" />
      ) : null}
      {choosing === 'days' ? <ChoiceSheet choices={PERIODS} current={days} onClose={() => setChoosing(null)} onPick={picked => (setChoosing(null), setDays(picked))} title="Time" /> : null}
      {choosing === 'log' ? <ChoiceSheet choices={LOG_FILES} current={logFile} onClose={() => setChoosing(null)} onPick={picked => (setChoosing(null), setLogFile(picked))} title="Log" /> : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wait: { marginTop: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { gap: space.sm, marginBottom: space.sm },
  content: { padding: space.lg, gap: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center', flexGrow: 1 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  value: { flexShrink: 1, textAlign: 'right' },
  heading: { fontWeight: '700', marginTop: space.md },
  day: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  dayName: { width: 52 },
  dayCount: { width: 52, textAlign: 'right' },
  track: { flex: 1, height: 10, borderRadius: 5, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5 },
  card: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  log: { gap: 2, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  mono: { fontFamily: MONO, fontSize: 12, lineHeight: 17 },
  actions: { gap: space.sm, marginTop: space.md },
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.md },
  line: { flexDirection: 'row', gap: space.md }
})
