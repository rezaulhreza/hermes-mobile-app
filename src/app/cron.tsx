import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, Field, IconButton, Notice } from '@/components/ui'
import { type Schedule, SCHEDULE_CHOICES, scheduleLine, scheduleProblem, type ScheduleRun } from '@/core/cron'
import { relativeTime } from '@/core/format'
import { $schedules, createSchedule, deleteSchedule, loadRuns, loadSchedules, pauseSchedule, runSchedule, updateSchedule } from '@/store/cron'
import { $linkState } from '@/store/link'
import { type Palette, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const say = (error: unknown) => Alert.alert('That did not work', error instanceof Error ? error.message : String(error))

function colour(schedule: Schedule, t: Palette): string {
  return schedule.failed && schedule.state !== 'completed' ? t.red : schedule.state === 'scheduled' ? t.green : t.muted
}

/** Work the agent does at a time, with nobody there. A failing one is first. */
export default function Cron() {
  const t = useTheme()
  const schedules = useStore($schedules)
  const linkState = useStore($linkState)
  const [failure, setFailure] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const open = schedules?.find(schedule => schedule.id === openId)

  const load = () => loadSchedules().then(() => setFailure(null), error => setFailure(error instanceof Error ? error.message : String(error)))

  useEffect(() => {
    if (linkState === 'open') {
      void load()
    }
  }, [linkState])

  // "Next in 5 min" must stay true while the screen is open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)

    return () => clearInterval(timer)
  }, [])

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Schedules</Text>
        <IconButton disabled={!schedules} filled icon="plus" label="Add a schedule" onPress={() => setAdding(true)} />
      </View>

      {!schedules ? (
        failure ? (
          <Notice action={<Button label="Try again" onPress={() => void load()} />} detail={failure} icon="alert-triangle" title="Could not read the schedules" />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        )
      ) : (
        <FlatList
          contentContainerStyle={styles.content}
          data={schedules}
          keyExtractor={schedule => `${schedule.profile}:${schedule.id}`}
          ListEmptyComponent={<Notice action={<Button icon="plus" label="Add a schedule" onPress={() => setAdding(true)} tone="primary" />} detail="Tell your agent to do something every morning, every hour, or once at a time." icon="clock" title="No schedules yet" />}
          refreshControl={
            <RefreshControl
              onRefresh={() => {
                setRefreshing(true)
                void load().finally(() => setRefreshing(false))
              }}
              refreshing={refreshing}
              tintColor={t.muted}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={item.name}
              accessibilityRole="button"
              onPress={() => setOpenId(item.id)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
            >
              <Feather color={colour(item, t)} name={item.state === 'paused' ? 'pause-circle' : item.state === 'completed' ? 'check-circle' : item.failed ? 'alert-circle' : 'clock'} size={20} />
              <View style={styles.fill}>
                <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                  {item.name}
                </Text>
                <Text numberOfLines={1} style={[type.small, { color: item.failed && item.state !== 'completed' ? t.red : t.muted }]}>
                  {scheduleLine(item, now)}
                </Text>
              </View>
              {item.profile !== 'default' ? <Text style={[type.small, { color: t.muted }]}>{item.profile}</Text> : null}
              <Feather color={t.muted} name="chevron-right" size={18} />
            </Pressable>
          )}
        />
      )}

      {open ? <ScheduleSheet now={now} onClose={() => setOpenId(null)} schedule={open} /> : null}
      {adding ? <NewScheduleSheet onClose={() => setAdding(false)} /> : null}
    </SafeAreaView>
  )
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.header, styles.sheetHeader, { borderBottomColor: t.line }]}>
          <Text numberOfLines={1} style={[type.heading, styles.fill, { color: t.ink }]}>
            {title}
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

function ScheduleSheet({ schedule, now, onClose }: { schedule: Schedule; now: number; onClose: () => void }) {
  const t = useTheme()
  const [prompt, setPrompt] = useState(schedule.prompt)
  const [when, setWhen] = useState(schedule.when)
  const [busy, setBusy] = useState<string | null>(null)
  const [runs, setRuns] = useState<ScheduleRun[] | null>(null)
  const changed = prompt.trim() !== schedule.prompt || when.trim() !== schedule.when
  const problem = changed ? scheduleProblem(prompt, when) : null

  useEffect(() => {
    loadRuns(schedule).then(setRuns, () => setRuns([]))
    // The history of one schedule, read once when its sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule.id])

  const run = (what: string, work: () => Promise<unknown>) => {
    setBusy(what)
    work()
      .catch(say)
      .finally(() => setBusy(null))
  }

  const remove = () =>
    Alert.alert(`Delete “${schedule.name}”?`, 'It does not run again. Its past results stay.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run('delete', () => deleteSchedule(schedule).then(onClose)) }
    ])

  return (
    <SheetFrame onClose={onClose} title={schedule.name}>
      <Text style={[type.small, { color: colour(schedule, t) }]}>
        {[scheduleLine(schedule, now), schedule.deliver === 'local' ? 'the result is saved on the host' : `the result goes to ${schedule.deliver}`, schedule.scriptOnly ? 'a script, with no agent' : '']
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {schedule.failed && schedule.lastError ? <Text style={[type.small, styles.error, { color: t.red, backgroundColor: t.redBg }]}>{schedule.lastError}</Text> : null}

      <View style={styles.actions}>
        {schedule.state === 'completed' ? null : (
          <Button
            busy={busy === 'pause'}
            icon={schedule.state === 'paused' ? 'play' : 'pause'}
            label={schedule.state === 'paused' ? 'Resume' : 'Pause'}
            onPress={() => run('pause', () => pauseSchedule(schedule, schedule.state !== 'paused'))}
            style={styles.fill}
          />
        )}
        <Button busy={busy === 'run'} icon="zap" label="Run now" onPress={() => run('run', () => runSchedule(schedule))} style={styles.fill} />
      </View>

      <Field label="What the agent does" multiline onChangeText={setPrompt} style={styles.prompt} value={prompt} />
      <Field error={problem} label="When" onChangeText={setWhen} value={when} />
      <Button busy={busy === 'save'} disabled={!changed || Boolean(problem)} label="Save the changes" onPress={() => run('save', () => updateSchedule(schedule, { prompt: prompt.trim(), schedule: when.trim() }))} tone="primary" />

      <Text style={[type.small, styles.heading, { color: t.muted }]}>Last runs</Text>
      {runs === null ? (
        <ActivityIndicator color={t.muted} />
      ) : runs.length ? (
        runs.map(item => (
          <View key={item.id} style={[styles.run, { borderColor: t.line }]}>
            <Text style={[type.small, { color: t.muted }]}>{item.at ? relativeTime(item.at / 1000) : ''}</Text>
            <Text numberOfLines={3} style={[type.small, { color: t.ink }]}>
              {item.title}
            </Text>
          </View>
        ))
      ) : (
        <Text style={[type.small, { color: t.muted }]}>It has not run yet.</Text>
      )}

      <Button busy={busy === 'delete'} icon="trash-2" label="Delete this schedule" onPress={remove} tone="danger" />
    </SheetFrame>
  )
}

function NewScheduleSheet({ onClose }: { onClose: () => void }) {
  const t = useTheme()
  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  const [when, setWhen] = useState(SCHEDULE_CHOICES[2].value)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const problem = scheduleProblem(prompt, when)

  const add = () => {
    setTried(true)

    if (problem) {
      return
    }

    setBusy(true)
    createSchedule(prompt, when, name)
      .then(onClose, say)
      .finally(() => setBusy(false))
  }

  return (
    <SheetFrame onClose={onClose} title="Add a schedule">
      <Field
        error={tried && !prompt.trim() ? problem : null}
        label="What the agent does"
        multiline
        onChangeText={setPrompt}
        placeholder="Read my new mail and tell me what needs an answer"
        style={styles.prompt}
        value={prompt}
      />
      <Field label="Name (optional)" onChangeText={setName} placeholder="Morning mail" value={name} />

      <Text style={[type.small, { color: t.muted, fontWeight: '600' }]}>When</Text>
      <View style={styles.chips}>
        {SCHEDULE_CHOICES.map(choice => {
          const checked = choice.value === when

          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              key={choice.value}
              onPress={() => setWhen(choice.value)}
              style={[styles.chip, { backgroundColor: checked ? t.ink : t.paper, borderColor: checked ? t.ink : t.line }]}
            >
              <Text style={[type.small, { color: checked ? t.bg : t.ink }]}>{choice.label}</Text>
            </Pressable>
          )
        })}
      </View>
      <Field error={tried && prompt.trim() ? problem : null} label="Or write it: “every 2h”, or cron fields" onChangeText={setWhen} value={when} />

      <Text style={[type.small, { color: t.muted }]}>The result is saved on your Hermes host. Ask your agent in a chat to send it to a messaging app.</Text>
      <Button busy={busy} icon="plus" label="Add the schedule" onPress={add} tone="primary" />
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  sheetHeader: { paddingTop: space.md, paddingLeft: space.lg },
  content: { padding: space.lg, gap: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  sheet: { padding: space.lg, gap: space.md },
  actions: { flexDirection: 'row', gap: space.md },
  error: { padding: space.md, borderRadius: radius.md, overflow: 'hidden' },
  prompt: { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md },
  heading: { fontWeight: '700', marginTop: space.sm },
  run: { gap: 2, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth }
})
