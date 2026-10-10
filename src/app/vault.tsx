import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, Card, Field, IconButton, type IconName, Notice } from '@/components/ui'
import {
  emptyVaultForm,
  VAULT_KINDS,
  type VaultEntry,
  type VaultField,
  vaultFields,
  type VaultForm,
  vaultFormProblem,
  type VaultKind,
  vaultSections,
  vaultSummary
} from '@/core/vault'
import { $linkState } from '@/store/link'
import {
  $vaultError,
  $vaultItems,
  $vaultSources,
  addVaultItem,
  loadVault,
  lockVaultSource,
  removeVaultItem,
  setVaultSource,
  unlockVaultSource,
  type VaultSource
} from '@/store/vault'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const KIND_ICON: Record<string, IconName> = { login: 'key', payment: 'credit-card', address: 'map-pin' }

/**
 * The logins, cards and addresses the agent may use in its own browser. The
 * phone is where a person has a password to hand, so adding one must be fast:
 * one button, one form, the keyboard and the system autofill set per field.
 */
export default function Vault() {
  const t = useTheme()
  const items = useStore($vaultItems)
  const sources = useStore($vaultSources)
  const failure = useStore($vaultError)
  const linkState = useStore($linkState)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (linkState === 'open') {
      void loadVault()
    }
  }, [linkState])

  const managers = sources.filter(source => source.name !== 'local')

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Logins and cards</Text>
        <IconButton disabled={linkState !== 'open'} filled icon="plus" label="Add to the vault" onPress={() => setAdding(true)} />
      </View>

      {items === null ? (
        failure ? (
          <Notice detail={failure} icon="alert-triangle" title="Could not open the vault" />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[type.small, { color: t.muted }]}>
            Hermes uses these when it signs in or pays in its own browser. They are stored encrypted on your Hermes host. The phone never
            shows a saved password.
          </Text>

          {items.length === 0 ? (
            <Card style={styles.empty}>
              <Feather color={t.muted} name="key" size={24} />
              <Text style={[type.label, { color: t.ink }]}>Nothing saved yet</Text>
              <Button icon="plus" label="Add a login" onPress={() => setAdding(true)} tone="primary" />
            </Card>
          ) : (
            vaultSections(items).map(section => (
              <View key={section.title} style={styles.group}>
                <Text style={[type.small, styles.heading, { color: t.muted }]}>{section.title}</Text>
                <Card style={styles.card}>
                  {section.data.map((item, index) => (
                    <Entry first={index === 0} item={item} key={item.id} />
                  ))}
                </Card>
              </View>
            ))
          )}

          {managers.length ? (
            <View style={styles.group}>
              <Text style={[type.small, styles.heading, { color: t.muted }]}>Password managers</Text>
              <Card style={styles.card}>
                {managers.map((source, index) => (
                  <Manager first={index === 0} key={source.name} source={source} />
                ))}
              </Card>
            </View>
          ) : null}
        </ScrollView>
      )}

      {adding ? <AddSheet onClose={() => setAdding(false)} /> : null}
    </SafeAreaView>
  )
}

function Entry({ item, first }: { item: VaultEntry; first: boolean }) {
  const t = useTheme()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const summary = vaultSummary(item)
  // An item of a password manager is removed in that manager, not here.
  const removable = item.backend === 'local'

  const remove = async () => {
    setBusy(true)

    try {
      await removeVaultItem(item.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.entry, !first && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.row}>
        <Feather color={t.muted} name={KIND_ICON[item.kind] ?? 'lock'} size={18} />
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {item.label}
          </Text>
          {summary ? (
            <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
              {summary}
            </Text>
          ) : null}
        </View>
        {removable && !asking ? (
          <Pressable accessibilityLabel={`Remove ${item.label}`} accessibilityRole="button" hitSlop={12} onPress={() => setAsking(true)}>
            <Feather color={t.muted} name="trash-2" size={18} />
          </Pressable>
        ) : null}
      </View>
      {asking ? (
        <View style={styles.buttons}>
          <Button label="Keep it" onPress={() => setAsking(false)} style={styles.fill} />
          <Button busy={busy} label="Remove" onPress={remove} style={styles.fill} tone="danger" />
        </View>
      ) : null}
    </View>
  )
}

function Manager({ source, first }: { source: VaultSource; first: boolean }) {
  const t = useTheme()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)

    try {
      await work()
      setPassword('')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const status = !source.installed
    ? 'Not installed on the Hermes host'
    : !source.enabled
      ? 'Off'
      : source.unlocked
        ? 'Unlocked for this run of Hermes'
        : 'Locked'

  return (
    <View style={[styles.entry, !first && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.row}>
        <Feather color={t.muted} name={source.unlocked ? 'unlock' : 'lock'} size={18} />
        <View style={styles.fill}>
          <Text style={[type.label, { color: t.ink }]}>{source.display_name}</Text>
          <Text style={[type.small, { color: t.muted }]}>{status}</Text>
        </View>
        {source.installed ? (
          <Button
            busy={busy && !password}
            label={!source.enabled ? 'Turn on' : source.unlocked ? 'Lock' : 'Turn off'}
            onPress={() => run(() => (!source.enabled ? setVaultSource(source.name, true) : source.unlocked ? lockVaultSource(source.name) : setVaultSource(source.name, false)))}
          />
        ) : null}
      </View>
      {source.installed && source.enabled && source.needs_unlock && !source.unlocked ? (
        <View style={styles.unlock}>
          <Field
            autoCapitalize="none"
            autoCorrect={false}
            error={problem ?? undefined}
            label={`${source.display_name} master password`}
            onChangeText={setPassword}
            secureTextEntry
            value={password}
          />
          <Button busy={busy} disabled={!password} label="Unlock" onPress={() => run(() => unlockVaultSource(source.name, password))} tone="primary" />
        </View>
      ) : problem ? (
        <Text style={[type.small, { color: t.red }]}>{problem}</Text>
      ) : null}
    </View>
  )
}

const INPUT_PROPS: Record<VaultField['input'], object> = {
  text: { autoCapitalize: 'sentences' },
  name: { autoCapitalize: 'words', textContentType: 'name', autoComplete: 'name' },
  url: { autoCapitalize: 'none', autoCorrect: false, keyboardType: 'url', textContentType: 'URL' },
  email: { autoCapitalize: 'none', autoCorrect: false, keyboardType: 'email-address', textContentType: 'username', autoComplete: 'username' },
  password: { autoCapitalize: 'none', autoCorrect: false, secureTextEntry: true, textContentType: 'password', autoComplete: 'current-password' },
  number: { keyboardType: 'number-pad' }
}

function AddSheet({ onClose }: { onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [form, setForm] = useState<VaultForm>(() => emptyVaultForm('login'))
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const save = async () => {
    const reason = vaultFormProblem(form)

    if (reason) {
      return setProblem(reason)
    }

    setBusy(true)
    setProblem(null)

    try {
      await addVaultItem(form)
      onClose()
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  // Fields that share a row number sit on one line.
  const lines: VaultField[][] = []

  for (const field of vaultFields(form.kind)) {
    const last = lines[lines.length - 1]

    if (field.row !== undefined && last?.[0].row === field.row) {
      last.push(field)
    } else {
      lines.push([field])
    }
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={styles.sheetHead}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Add to the vault</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={[styles.form, { paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
          <View style={[styles.kinds, { backgroundColor: t.soft }]}>
            {VAULT_KINDS.map(({ kind, label }) => (
              <Pressable
                accessibilityLabel={`Kind: ${label}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: form.kind === kind }}
                key={kind}
                onPress={() => {
                  setForm(current => ({ ...current, kind: kind as VaultKind }))
                  setProblem(null)
                }}
                style={[styles.kind, form.kind === kind && { backgroundColor: t.paper }]}
              >
                <Feather color={form.kind === kind ? t.ink : t.muted} name={KIND_ICON[kind]} size={15} />
                <Text style={[type.small, { color: form.kind === kind ? t.ink : t.muted, fontWeight: '700' }]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {lines.map(line => (
            <View key={line[0].key} style={styles.line}>
              {line.map(field => (
                <View key={field.key} style={styles.fill}>
                  <Field
                    {...INPUT_PROPS[field.input]}
                    label={field.required ? field.label : `${field.label} (optional)`}
                    onChangeText={text => setForm(current => ({ ...current, [field.key]: text }))}
                    placeholder={field.example}
                    placeholderTextColor={t.muted}
                    secureTextEntry={field.input === 'password' && !shown}
                    value={form[field.key]}
                  />
                  {field.hint ? <Text style={[type.small, { color: t.muted }]}>{field.hint}</Text> : null}
                </View>
              ))}
            </View>
          ))}

          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: shown }} hitSlop={8} onPress={() => setShown(value => !value)} style={styles.row}>
            <Feather color={t.muted} name={shown ? 'eye-off' : 'eye'} size={16} />
            <Text style={[type.small, { color: t.muted }]}>{shown ? 'Hide what I typed' : 'Show what I typed'}</Text>
          </Pressable>

          {problem ? <Text style={[type.small, styles.problem, { color: t.red, backgroundColor: t.redBg }]}>{problem}</Text> : null}

          <Button busy={busy} label="Save" onPress={save} tone="primary" />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  content: { padding: space.lg, gap: space.lg, maxWidth: 760, width: '100%', alignSelf: 'center' },
  group: { gap: space.sm },
  heading: { fontWeight: '700' },
  card: { padding: 0 },
  empty: { alignItems: 'center', gap: space.md },
  entry: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH - 12 },
  buttons: { flexDirection: 'row', gap: space.md },
  unlock: { gap: space.md },
  sheetHead: { flexDirection: 'row', alignItems: 'center', padding: space.lg, paddingBottom: space.sm },
  form: { padding: space.lg, gap: space.md },
  kinds: { flexDirection: 'row', padding: 4, borderRadius: radius.md },
  kind: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, minHeight: 36, borderRadius: radius.md - 4 },
  line: { flexDirection: 'row', gap: space.md },
  problem: { padding: space.md, borderRadius: radius.md }
})
