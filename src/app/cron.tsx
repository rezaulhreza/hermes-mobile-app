import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { BotAvatar } from '@/components/bot-sheet'
import { type Choice, ChoiceRow, ChoiceSheet } from '@/components/choice'
import { Markdown } from '@/components/markdown'
import { Button, Field, IconButton, Notice } from '@/components/ui'
import { WhenPicker } from '@/components/when-picker'
import { type Blueprint, blueprintDefaults, blueprintMissing, CATCH_UP_CHOICES, type CatchUpChoice, catchUpChoice, catchUpValue, deliveryLabel, type Schedule, scheduleLine, type ScheduleRun } from '@/core/cron'
import { faultWords, relativeTime } from '@/core/format'
import { parseWhen, type When, whenProblem, whenText } from '@/core/when'
import { $bots } from '@/store/bots'
import {
  $deliveryTargets,
  $schedules,
  createFromBlueprint,
  createSchedule,
  deleteSchedule,
  loadBlueprints,
  loadDeliveryTargets,
  loadRuns,
  loadRunText,
  loadSchedules,
  pauseSchedule,
  runSchedule,
  stopScheduleRun,
  updateSchedule
} from '@/store/cron'
import { $linkState } from '@/store/link'
import { type Palette, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const say = (error: unknown) => Alert.alert('That did not work', faultWords(error))

/** The places a result can go, as choices with the names of the bots. */
function useDelivery(): { choices: Choice[]; label: (id: string) => string } {
  const targets = useStore($deliveryTargets)
  const bots = useStore($bots)
  const titles = useMemo(() => new Map((bots ?? []).map(bot => [bot.name, bot.title])), [bots])

  useEffect(() => {
    if (!targets) {
      void loadDeliveryTargets().catch(() => undefined)
    }
  }, [targets])

  return useMemo(
    () => ({
      choices: (targets ?? [{ id: 'local', name: '' }]).map(target => ({ id: target.id, label: deliveryLabel(target.id, targets ?? [], titles) })),
      label: (id: string) => deliveryLabel(id, targets ?? [], titles)
    }),
    [targets, titles]
  )
}

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
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

function ScheduleSheet({ schedule, now, onClose }: { schedule: Schedule; now: number; onClose: () => void }) {
  const t = useTheme()
  const [prompt, setPrompt] = useState(schedule.prompt)
  // The choices the text of the host stands for. A form the choices do not have opens as text.
  const [when, setWhen] = useState(() => parseWhen(schedule.when))
  const [busy, setBusy] = useState<string | null>(null)
  const [runs, setRuns] = useState<ScheduleRun[] | null>(null)
  // The text of the choices is not always the text the host gave ("every 360m" is "every 6h"): compare what they mean.
  const whenChanged = whenText(when) !== whenText(parseWhen(schedule.when))
  const changed = prompt.trim() !== schedule.prompt || whenChanged
  const problem = changed ? (prompt.trim() ? whenProblem(when, new Date(now)) : 'Write what the agent must do.') : null
  const delivery = useDelivery()
  const [delivering, setDelivering] = useState(false)
  const [catchingUp, setCatchingUp] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [stopNote, setStopNote] = useState<string | null>(null)
  // The whole text of one run, open over the sheet.
  const [reading, setReading] = useState<{ title: string; text: string | null } | null>(null)

  const openRun = (item: ScheduleRun) => {
    if (item.hasChat) {
      // A run of the agent is a conversation: the chat screen shows all of it.
      onClose()
      router.push({ pathname: '/chat/[id]', params: { id: item.id, title: schedule.name, ...(schedule.profile && schedule.profile !== 'default' ? { profile: schedule.profile } : {}) } })

      return
    }

    setReading({ title: item.at ? relativeTime(item.at / 1000) : 'Run', text: null })
    loadRunText(schedule, item).then(
      text => setReading(current => current && { ...current, text: text || 'This run wrote nothing.' }),
      error => setReading(current => current && { ...current, text: faultWords(error) })
    )
  }

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
        {[scheduleLine(schedule, now), schedule.scriptOnly ? 'a script, with no agent' : ''].filter(Boolean).join(' · ')}
      </Text>
      <ChoiceRow icon="send" label="The result goes to" onPress={() => setDelivering(true)} value={delivery.label(schedule.deliver)} />
      {delivering ? (
        <ChoiceSheet
          choices={delivery.choices}
          current={schedule.deliver}
          onClose={() => setDelivering(false)}
          onPick={id => {
            setDelivering(false)
            run('deliver', () => updateSchedule(schedule, { deliver: id }))
          }}
          title="The result goes to"
        />
      ) : null}
      {schedule.state === 'completed' ? null : (
        <ChoiceRow icon="rotate-ccw" label="Missed runs" onPress={() => setCatchingUp(true)} value={CATCH_UP_CHOICES.find(choice => choice.id === catchUpChoice(schedule.catchUp))?.label ?? ''} />
      )}
      {catchingUp ? (
        <ChoiceSheet
          choices={CATCH_UP_CHOICES.map(choice => ({ ...choice, detail: choice.id === 'default' ? 'What the host does for every schedule' : undefined }))}
          current={catchUpChoice(schedule.catchUp)}
          footer={<Text style={[type.small, { color: t.muted }]}>What to do with the runs missed while Hermes was not running.</Text>}
          onClose={() => setCatchingUp(false)}
          onPick={id => {
            setCatchingUp(false)
            run('catch-up', () => updateSchedule(schedule, { catch_up: catchUpValue(id as CatchUpChoice) }))
          }}
          title="Missed runs"
        />
      ) : null}
      {schedule.cancelled !== null && !schedule.running ? (
        <Text style={[type.small, { color: t.muted }]}>{schedule.cancelled ? `The last run was stopped: ${schedule.cancelled}` : 'The last run was stopped.'}</Text>
      ) : null}
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
        {schedule.running ? (
          <Button icon="square" label="Stop the run" onPress={() => (setStopNote(null), setStopping(true))} style={styles.fill} tone="danger" />
        ) : (
          <Button busy={busy === 'run'} icon="zap" label="Run now" onPress={() => run('run', () => runSchedule(schedule))} style={styles.fill} />
        )}
      </View>
      {stopping && schedule.running ? (
        <View style={[styles.confirm, { backgroundColor: t.redBg }]}>
          <Text style={[type.small, { color: t.ink }]}>Stop the run of “{schedule.name}” now? What it did so far stays. The schedule runs again at its next time.</Text>
          <View style={styles.actions}>
            <Button label="Let it run" onPress={() => setStopping(false)} style={styles.fill} />
            <Button
              busy={busy === 'stop'}
              label="Stop it"
              onPress={() => run('stop', () => stopScheduleRun(schedule).then(words => (setStopNote(words), setStopping(false))))}
              style={styles.fill}
              tone="danger"
            />
          </View>
        </View>
      ) : null}
      {stopNote ? <Text style={[type.small, { color: t.ink }]}>{stopNote}</Text> : null}

      <Field label="What the agent does" multiline onChangeText={setPrompt} style={styles.prompt} value={prompt} />
      <Text style={[type.small, { color: t.muted, fontWeight: '600' }]}>When</Text>
      <WhenPicker now={now} onChange={setWhen} showProblem={changed} value={when} />
      {changed && problem && !prompt.trim() ? <Text style={[type.small, { color: t.red }]}>{problem}</Text> : null}
      <Button
        busy={busy === 'save'}
        disabled={!changed || Boolean(problem)}
        label="Save the changes"
        // The time goes to the host only when the person changed it: a schedule keeps the text it has.
        onPress={() => run('save', () => updateSchedule(schedule, { prompt: prompt.trim(), ...(whenChanged ? { schedule: whenText(when) } : {}) }))}
        tone="primary"
      />

      <Text style={[type.small, styles.heading, { color: t.muted }]}>Last runs</Text>
      {runs === null ? (
        <ActivityIndicator color={t.muted} />
      ) : runs.length ? (
        runs.map(item => (
          <Pressable
            accessibilityHint="Shows the whole run"
            accessibilityLabel={`Run ${item.at ? relativeTime(item.at / 1000) : ''}: ${item.title}`}
            accessibilityRole="button"
            key={item.id}
            onPress={() => openRun(item)}
            style={({ pressed }) => [styles.run, { borderColor: t.line }, pressed && { backgroundColor: t.soft }]}
          >
            <View style={styles.fill}>
              <Text style={[type.small, { color: t.muted }]}>{item.at ? relativeTime(item.at / 1000) : ''}</Text>
              <Text numberOfLines={3} style={[type.small, { color: t.ink }]}>
                {item.title}
              </Text>
            </View>
            <Feather color={t.muted} name="chevron-right" size={16} />
          </Pressable>
        ))
      ) : (
        <Text style={[type.small, { color: t.muted }]}>It has not run yet.</Text>
      )}

      <Button busy={busy === 'delete'} icon="trash-2" label="Delete this schedule" onPress={remove} tone="danger" />
      {reading ? (
        <SheetFrame onClose={() => setReading(null)} title={`Run, ${reading.title}`}>
          {reading.text === null ? <ActivityIndicator color={t.muted} /> : <Markdown text={reading.text} />}
        </SheetFrame>
      ) : null}
    </SheetFrame>
  )
}

function NewScheduleSheet({ onClose }: { onClose: () => void }) {
  const t = useTheme()
  const [prompt, setPrompt] = useState('')
  const [name, setName] = useState('')
  // Every day at 9:00 to start with: the schedule a person asks for most.
  const [when, setWhen] = useState<When>({ kind: 'daily', hour: 9, minute: 0 })
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  // The clock of the sheet, for the earliest time a single run can have.
  const [now] = useState(Date.now)
  const problem = prompt.trim() ? whenProblem(when, new Date()) : 'Write what the agent must do.'
  const bots = useStore($bots) ?? []
  // The bot that does the work. The main bot with none chosen.
  const [owner, setOwner] = useState<string | null>(null)
  const [deliver, setDeliver] = useState('local')
  const delivery = useDelivery()
  const [choosing, setChoosing] = useState<'bot' | 'deliver' | 'template' | null>(null)
  const [templates, setTemplates] = useState<Blueprint[] | null>(null)
  const [template, setTemplate] = useState<Blueprint | null>(null)
  const ownerBot = bots.find(bot => bot.name === owner) ?? bots.find(bot => bot.isDefault)
  const profile = ownerBot && !ownerBot.isDefault ? ownerBot.name : undefined

  const openTemplates = () => {
    setChoosing('template')
    setTemplates(null)
    loadBlueprints(profile).then(setTemplates, () => setTemplates([]))
  }

  const add = () => {
    setTried(true)

    if (problem) {
      return
    }

    setBusy(true)
    createSchedule(prompt, whenText(when), name, profile, deliver)
      .then(onClose, say)
      .finally(() => setBusy(false))
  }

  return (
    <SheetFrame onClose={onClose} title="Add a schedule">
      <Button icon="layers" label="Start from a template" onPress={openTemplates} />
      {bots.length > 1 ? <ChoiceRow icon="user" label="The bot that does it" onPress={() => setChoosing('bot')} value={ownerBot?.title ?? 'The main bot'} /> : null}
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
      <WhenPicker now={now} onChange={setWhen} showProblem={tried} value={when} />

      <ChoiceRow icon="send" label="The result goes to" onPress={() => setChoosing('deliver')} value={delivery.label(deliver)} />
      <Button busy={busy} icon="plus" label="Add the schedule" onPress={add} tone="primary" />

      {choosing === 'bot' ? (
        <ChoiceSheet
          choices={bots.map(bot => ({ id: bot.name, label: bot.title, detail: bot.description, lead: <BotAvatar bot={bot} size={36} t={t} /> }))}
          current={ownerBot?.name}
          onClose={() => setChoosing(null)}
          onPick={id => (setOwner(id), setChoosing(null))}
          title="The bot that does it"
        />
      ) : null}
      {choosing === 'deliver' ? (
        <ChoiceSheet choices={delivery.choices} current={deliver} onClose={() => setChoosing(null)} onPick={id => (setDeliver(id), setChoosing(null))} title="The result goes to" />
      ) : null}
      {choosing === 'template' ? (
        <ChoiceSheet
          choices={(templates ?? []).map(item => ({ id: item.key, label: item.title, detail: item.description }))}
          footer={templates === null ? <ActivityIndicator color={t.muted} /> : templates.length ? null : <Text style={[type.body, { color: t.muted }]}>This host has no template.</Text>}
          onClose={() => setChoosing(null)}
          onPick={key => (setTemplate(templates?.find(item => item.key === key) ?? null), setChoosing(null))}
          title="Template"
        />
      ) : null}
      {template ? <TemplateSheet blueprint={template} delivery={delivery} onClose={() => setTemplate(null)} onMade={onClose} profile={profile} /> : null}
    </SheetFrame>
  )
}

/** The few questions of one template of the host. Each answer is text; a field with a fixed set of answers opens a list. */
function TemplateSheet({
  blueprint,
  profile,
  delivery,
  onClose,
  onMade
}: {
  blueprint: Blueprint
  profile?: string
  delivery: { label: (id: string) => string }
  onClose: () => void
  onMade: () => void
}) {
  const t = useTheme()
  const [values, setValues] = useState(() => blueprintDefaults(blueprint))
  const [picking, setPicking] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const missing = blueprintMissing(blueprint, values)
  const picked = blueprint.fields.find(field => field.name === picking)
  // The answers that name a place for the result read as a person says them.
  const words = (field: string, value: string) => (field === 'deliver' ? delivery.label(value) : value)

  const make = () => {
    setBusy(true)
    createFromBlueprint(blueprint.key, values, profile)
      .then(onMade, say)
      .finally(() => setBusy(false))
  }

  return (
    <SheetFrame onClose={onClose} title={blueprint.title}>
      {blueprint.description ? <Text style={[type.small, { color: t.muted }]}>{blueprint.description}</Text> : null}
      {blueprint.fields.map(field =>
        field.options?.length ? (
          <ChoiceRow icon="list" key={field.name} label={field.label || field.name} onPress={() => setPicking(field.name)} value={words(field.name, values[field.name] ?? '') || 'Choose'} />
        ) : (
          <Field
            autoCapitalize="none"
            key={field.name}
            label={[field.label || field.name, field.help].filter(Boolean).join(' — ')}
            onChangeText={text => setValues(current => ({ ...current, [field.name]: text }))}
            value={values[field.name] ?? ''}
          />
        )
      )}
      <Button busy={busy} disabled={Boolean(missing)} icon="plus" label={missing ? `Fill “${missing.label || missing.name}”` : 'Add the schedule'} onPress={make} tone="primary" />
      {picked ? (
        <ChoiceSheet
          choices={(picked.options ?? []).map(option => ({ id: String(option), label: words(picked.name, String(option)) }))}
          current={values[picked.name]}
          onClose={() => setPicking(null)}
          onPick={id => (setValues(current => ({ ...current, [picked.name]: id })), setPicking(null))}
          title={picked.label || picked.name}
        />
      ) : null}
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
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.md },
  error: { padding: space.md, borderRadius: radius.md, overflow: 'hidden' },
  prompt: { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md },
  heading: { fontWeight: '700', marginTop: space.sm },
  run: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth }
})
