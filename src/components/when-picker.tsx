import DateTimePicker from '@react-native-community/datetimepicker'
import { Feather } from '@expo/vector-icons'
import { useState } from 'react'
import { StyleSheet, Text, useColorScheme, View } from 'react-native'

import { whenWords } from '@/core/cron'
import { asKind, daysWords, WEEK, WEEKDAYS, type When, type WhenKind, whenProblem, whenText } from '@/core/when'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { ChoiceRow, ChoiceSheet } from './choice'
import { Field } from './ui'

const KINDS: readonly { id: WhenKind; label: string; detail: string }[] = [
  { id: 'once', label: 'Once', detail: 'One run, at a day and a time' },
  { id: 'daily', label: 'Every day', detail: 'At the same time each day' },
  { id: 'weekly', label: 'On days of the week', detail: 'Weekdays, or the days you choose' },
  { id: 'hours', label: 'Every few hours', detail: 'Again and again through the day' },
  { id: 'minutes', label: 'Every few minutes', detail: 'For something to watch closely' },
  { id: 'custom', label: 'Write it yourself', detail: 'A form the choices do not have, as text' }
]

const HOURS = [1, 2, 3, 4, 6, 8, 12, 24]
const MINUTES = [5, 10, 15, 20, 30, 45]
const count = (value: number, one: string) => `${value} ${one}${value === 1 ? '' : 's'}`

/**
 * When a schedule runs, as choices: how often, then the day and the time
 * with the pickers of the phone. The text the host takes is written from the
 * choices (`core/when`). A form the choices do not have is still there, as
 * text, under "Write it yourself". The line at the end says the schedule in
 * words, so the person reads what they set.
 */
export function WhenPicker({ value, onChange, now, showProblem = true }: { value: When; onChange: (when: When) => void; /** Unix milliseconds. */ now: number; /** Say what is wrong with the choices. Off until the person tried to save. */ showProblem?: boolean }) {
  const t = useTheme()
  const dark = useColorScheme() === 'dark'
  const [choosing, setChoosing] = useState<'kind' | 'days' | 'every' | null>(null)
  const today = new Date(now)
  const problem = whenProblem(value, today)
  const time = value.kind === 'daily' || value.kind === 'weekly' ? new Date(2000, 0, 1, value.hour, value.minute) : null
  const steps = value.kind === 'hours' ? HOURS : value.kind === 'minutes' ? MINUTES : []
  const unit = value.kind === 'hours' ? 'hour' : 'minute'

  const picker = (mode: 'time' | 'datetime', shown: Date, change: (date: Date) => void) => (
    <DateTimePicker
      accentColor={t.accent}
      display="compact"
      minimumDate={mode === 'datetime' ? today : undefined}
      mode={mode}
      onChange={(_event, date) => date && change(date)}
      themeVariant={dark ? 'dark' : 'light'}
      value={shown}
    />
  )

  return (
    <View style={styles.all}>
      <ChoiceRow icon="repeat" label="How often" onPress={() => setChoosing('kind')} value={KINDS.find(kind => kind.id === value.kind)?.label ?? ''} />

      {value.kind === 'once' ? (
        <PickerRow icon="calendar" label="On">
          {picker('datetime', value.at, at => onChange({ kind: 'once', at }))}
        </PickerRow>
      ) : null}

      {value.kind === 'weekly' ? <ChoiceRow icon="calendar" label="Days" onPress={() => setChoosing('days')} value={daysWords(value.days)} /> : null}

      {time && (value.kind === 'daily' || value.kind === 'weekly') ? (
        <PickerRow icon="clock" label="At">
          {picker('time', time, at => onChange({ ...value, hour: at.getHours(), minute: at.getMinutes() }))}
        </PickerRow>
      ) : null}

      {value.kind === 'hours' || value.kind === 'minutes' ? <ChoiceRow icon="clock" label="Every" onPress={() => setChoosing('every')} value={count(value.every, unit)} /> : null}

      {value.kind === 'custom' ? (
        <>
          <Field label="The schedule, as text" onChangeText={text => onChange({ kind: 'custom', text })} placeholder="0 9 1 * *" value={value.text} />
          <Text style={[type.small, { color: t.muted }]}>For example “0 9 1 * *” for day 1 of every month at 9:00, or “every 90m”. The host reads five cron fields, “every” with a length, and a date with a time.</Text>
        </>
      ) : null}

      {problem ? (
        showProblem ? <Text style={[type.small, { color: t.red }]}>{problem}</Text> : null
      ) : (
        <View style={[styles.says, { backgroundColor: t.soft }]}>
          <Feather color={t.muted} name="check" size={14} />
          <Text style={[type.small, styles.fill, { color: t.ink }]}>{whenWords(whenText(value), today)}</Text>
        </View>
      )}

      {choosing === 'kind' ? (
        <ChoiceSheet
          choices={KINDS}
          current={value.kind}
          onClose={() => setChoosing(null)}
          onPick={id => {
            setChoosing(null)
            onChange(asKind(value, id as WhenKind, today))
          }}
          title="How often"
        />
      ) : null}

      {choosing === 'days' && value.kind === 'weekly' ? (
        <ChoiceSheet
          // A tap adds a day or takes it away: the sheet stays open until the person closes it.
          choices={[
            { id: 'weekdays', label: 'Weekdays', detail: 'Monday to Friday', lead: <Feather color={t.muted} name="briefcase" size={18} /> },
            ...WEEK.map(({ day, name }) => ({
              id: String(day),
              label: name,
              lead: <Feather color={value.days.includes(day) ? t.accent : t.line} name={value.days.includes(day) ? 'check-circle' : 'circle'} size={20} />
            }))
          ]}
          footer={<Text style={[type.small, styles.foot, { color: t.muted }]}>Tap a day to add it or to take it away. Close the list when the days are right.</Text>}
          onClose={() => setChoosing(null)}
          onPick={id => {
            const day = Number(id)
            const days = id === 'weekdays' ? WEEKDAYS : value.days.includes(day) ? value.days.filter(known => known !== day) : [...value.days, day].sort((a, b) => a - b)

            onChange({ ...value, days })
          }}
          title="Days"
        />
      ) : null}

      {choosing === 'every' && (value.kind === 'hours' || value.kind === 'minutes') ? (
        <ChoiceSheet
          // A length the list does not have (from a schedule made elsewhere) is in the list too, so it stays set.
          choices={[...new Set([...steps, value.every])].sort((a, b) => a - b).map(step => ({ id: String(step), label: count(step, unit) }))}
          current={String(value.every)}
          onClose={() => setChoosing(null)}
          onPick={id => {
            setChoosing(null)
            onChange({ ...value, every: Number(id) })
          }}
          title="Every"
        />
      ) : null}
    </View>
  )
}

/** A row with a picker of the phone at its end: the same shape as a row that opens a list. */
function PickerRow({ icon, label, children }: { icon: keyof typeof Feather.glyphMap; label: string; children: React.ReactNode }) {
  const t = useTheme()

  return (
    <View style={[styles.row, { backgroundColor: t.paper, borderColor: t.line }]}>
      <Feather color={t.muted} name={icon} size={18} />
      <Text style={[type.label, styles.fill, { color: t.ink }]}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  all: { gap: space.sm },
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 12, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  says: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.sm },
  foot: { padding: space.lg }
})
