import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotModelSheet, SheetFrame } from '@/components/bot-sheet'
import { ChoiceRow, ChoiceSheet } from '@/components/choice'
import { Button, Field, IconButton } from '@/components/ui'
import { faultWords } from '@/core/format'
import { type Endpoint, endpointProblem, helperLine, memoryName, taskName } from '@/core/host-settings'
import { modelLabel } from '@/core/models'
import {
  $endpoints,
  $helperTasks,
  $memory,
  checkEndpoint,
  type EndpointForm,
  loadEndpoints,
  loadHelperTasks,
  loadMemory,
  removeEndpoint,
  saveEndpoint,
  setHelperModel,
  setMemory,
  runOnEndpoint
} from '@/store/host-settings'
import { $linkState } from '@/store/link'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * Settings of the host that are not about one provider: the models of its
 * helper jobs, endpoints the user runs, and the kind of memory.
 */
export default function Host() {
  const t = useTheme()
  const linkState = useStore($linkState)
  const tasks = useStore($helperTasks)
  const endpoints = useStore($endpoints)
  const memory = useStore($memory)
  const [task, setTask] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Endpoint | null>(null)
  const [choosingMemory, setChoosingMemory] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const activeMemory = memory?.find(choice => choice.active)

  useEffect(() => {
    if (linkState === 'open') {
      void loadHelperTasks().catch(() => undefined)
      void loadEndpoints().catch(() => undefined)
      void loadMemory().catch(() => undefined)
    }
  }, [linkState])

  const run = (name: string, work: () => Promise<unknown>) => {
    setBusy(name)
    setFault(null)
    work()
      .catch(error => setFault(faultWords(error)))
      .finally(() => setBusy(null))
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Helper models and memory</Text>
        {busy ? <ActivityIndicator color={t.muted} /> : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {fault ? (
          <Text accessibilityRole="alert" style={[type.small, styles.fault, { color: t.red, backgroundColor: t.redBg }]}>
            {fault}
          </Text>
        ) : null}

        <Text style={[type.small, styles.section, { color: t.muted }]}>Helper models</Text>
        <Text style={[type.small, { color: t.muted }]}>Small jobs beside your chats. A cheaper, faster model can do them. With “Automatic” the host chooses.</Text>
        {tasks === null ? (
          <ActivityIndicator color={t.muted} />
        ) : (
          tasks.map(item => <ChoiceRow icon="cpu" key={item.task} label={taskName(item.task).name} onPress={() => setTask(item.task)} value={helperLine(item, modelLabel)} />)
        )}

        <Text style={[type.small, styles.section, { color: t.muted }]}>Your own endpoints</Text>
        <Text style={[type.small, { color: t.muted }]}>A model server you run, or one that speaks the OpenAI protocol.</Text>
        {(endpoints ?? []).map(item => (
          <Pressable
            accessibilityLabel={`Endpoint: ${item.name}`}
            accessibilityRole="button"
            key={item.id}
            onPress={() => setOpen(item)}
            style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
          >
            <Feather color={item.active ? t.accent : t.muted} name="server" size={20} />
            <View style={styles.fill}>
              <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                {item.name}
              </Text>
              <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                {[item.active ? 'Hermes runs on it' : '', item.model ? modelLabel(item.model) : ''].filter(Boolean).join(' · ') || item.baseUrl}
              </Text>
            </View>
            <Feather color={t.muted} name="chevron-right" size={18} />
          </Pressable>
        ))}
        <Button icon="plus" label="Add an endpoint" onPress={() => setAdding(true)} />

        <Text style={[type.small, styles.section, { color: t.muted }]}>Memory</Text>
        <Text style={[type.small, { color: t.muted }]}>How the host keeps what it learns between chats.</Text>
        <ChoiceRow disabled={!memory} icon="database" label="Kind of memory" onPress={() => setChoosingMemory(true)} value={memory ? memoryName(activeMemory?.name ?? '') : 'Reading…'} />
      </ScrollView>

      {task ? (
        <BotModelSheet
          auto="Automatic: the host chooses"
          current={tasks?.find(item => item.task === task)?.model ?? ''}
          onClose={() => setTask(null)}
          onPick={(provider, model) => {
            const name = task

            setTask(null)
            run('task', () => setHelperModel(name, provider, model))
          }}
          title={taskName(task).name}
        />
      ) : null}

      {choosingMemory && memory ? (
        <ChoiceSheet
          choices={[
            { id: '', label: 'Built-in memory', detail: 'The memory files of Hermes itself' },
            ...memory.map(choice => ({ id: choice.name, label: memoryName(choice.name), detail: choice.available ? choice.description : `Not set up on the host. ${choice.description}` }))
          ]}
          current={activeMemory?.name ?? ''}
          onClose={() => setChoosingMemory(false)}
          onPick={name => {
            setChoosingMemory(false)
            run('memory', () => setMemory(name))
          }}
          title="Kind of memory"
        />
      ) : null}

      {adding ? <EndpointSheet onClose={() => setAdding(false)} /> : null}

      {open ? (
        <SheetFrame onClose={() => setOpen(null)} title={open.name}>
          <Text selectable style={[type.small, { color: t.muted }]}>
            {open.baseUrl}
          </Text>
          {open.model ? <Text style={[type.body, { color: t.ink }]}>{modelLabel(open.model)}</Text> : null}
          {open.active ? (
            <Text style={[type.small, { color: t.accent }]}>Hermes runs on this endpoint.</Text>
          ) : (
            <Button icon="check-circle" label="Run Hermes on it" onPress={() => (setOpen(null), run('use', () => runOnEndpoint(open.id)))} tone="primary" />
          )}
          <Button icon="trash-2" label="Remove this endpoint" onPress={() => (setOpen(null), run('remove', () => removeEndpoint(open.id)))} tone="danger" />
        </SheetFrame>
      ) : null}
    </SafeAreaView>
  )
}

/** A new endpoint. "Check" asks the host to reach it and lists its models, so the model is a choice and not a guess. */
function EndpointSheet({ onClose }: { onClose: () => void }) {
  const t = useTheme()
  const [form, setForm] = useState<EndpointForm>({ name: '', baseUrl: '', model: '', apiKey: '' })
  const [models, setModels] = useState<string[] | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState<'check' | 'save' | null>(null)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const problem = endpointProblem(form)
  const set = (change: Partial<EndpointForm>) => setForm(current => ({ ...current, ...change }))

  const check = () => {
    setBusy('check')
    setNote(null)
    checkEndpoint(form)
      .then(found => {
        setModels(found)
        setNote({ text: found.length ? `The host reached it. It has ${found.length} ${found.length === 1 ? 'model' : 'models'}.` : 'The host reached it. It lists no model: type the name.', bad: false })
      })
      .catch(error => setNote({ text: faultWords(error), bad: true }))
      .finally(() => setBusy(null))
  }

  const save = () => {
    setBusy('save')
    saveEndpoint(form)
      .then(onClose, error => setNote({ text: faultWords(error), bad: true }))
      .finally(() => setBusy(null))
  }

  return (
    <SheetFrame onClose={onClose} title="Add an endpoint">
      <Field label="Name" onChangeText={name => set({ name })} placeholder="My server" value={form.name} />
      <Field autoCapitalize="none" autoCorrect={false} keyboardType="url" label="Address" onChangeText={baseUrl => set({ baseUrl })} placeholder="https://h.example/v1" value={form.baseUrl} />
      <Field autoCapitalize="none" autoCorrect={false} label="API key (if it needs one)" onChangeText={apiKey => set({ apiKey })} secureTextEntry value={form.apiKey} />
      <Button busy={busy === 'check'} disabled={!form.baseUrl.trim()} icon="activity" label="Check the address" onPress={check} />
      {note ? <Text style={[type.small, { color: note.bad ? t.red : t.green }]}>{note.text}</Text> : null}
      {models?.length ? (
        <ChoiceRow icon="cpu" label="Model" onPress={() => setPicking(true)} value={form.model ? modelLabel(form.model) : 'Choose'} />
      ) : (
        <Field autoCapitalize="none" autoCorrect={false} label="Model" onChangeText={model => set({ model })} value={form.model} />
      )}
      <Button busy={busy === 'save'} disabled={Boolean(problem)} icon="plus" label={problem ?? 'Add the endpoint'} onPress={save} tone="primary" />
      {picking && models ? (
        <ChoiceSheet choices={models.map(model => ({ id: model, label: modelLabel(model) }))} current={form.model} onClose={() => setPicking(false)} onPick={model => (set({ model }), setPicking(false))} title="Model" />
      ) : null}
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { padding: space.lg, gap: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center' },
  section: { fontWeight: '700', marginTop: space.md },
  fault: { padding: space.md, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 12, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth }
})
