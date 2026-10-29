import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useState } from 'react'
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Field, type IconName, IconButton } from '@/components/ui'
import { HermesApi } from '@/core/api'
import {
  CONNECTION_KINDS,
  type ConnectionKind,
  connectionKindInfo,
  type WorkspaceDraft,
  workspaceFromDraft
} from '@/core/workspaces'
import { $workspaces, newWorkspaceId, saveWorkspace } from '@/store/workspaces'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const KIND_ICON: Record<ConnectionKind, IconName> = { cloudflare: 'shield', tailscale: 'link', lan: 'wifi', other: 'server' }

type FieldErrors = Partial<Record<keyof WorkspaceDraft, string>>

export default function SignIn() {
  const t = useTheme()
  const hasWorkspace = useStore($workspaces).workspaces.length > 0
  const [draft, setDraft] = useState<WorkspaceDraft>({ kind: 'cloudflare', baseUrl: '', username: '', password: '' })
  const [choosing, setChoosing] = useState(false)
  const info = connectionKindInfo(draft.kind)
  const [advanced, setAdvanced] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (field: Exclude<keyof WorkspaceDraft, 'kind'>) => (value: string) => {
    setDraft(current => ({ ...current, [field]: value }))
    setErrors(current => ({ ...current, [field]: undefined }))
    setFailure(null)
  }

  const submit = async () => {
    const result = workspaceFromDraft(draft, newWorkspaceId())

    if (!result.ok) {
      setErrors({ [result.field]: result.message })

      if (result.field === 'accessClientId' || result.field === 'accessClientSecret') {
        setAdvanced(true)
      }

      return
    }

    setBusy(true)

    try {
      // Prove the credentials before storing them: a workspace that cannot
      // sign in must never become the active one.
      await new HermesApi(result.workspace).signIn()
      await saveWorkspace(result.workspace)
      router.replace('/')
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: t.bg }]}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <Image source={require('../../assets/images/icon.png')} style={styles.logo} />
            <Text style={[type.title, { color: t.ink }]}>{hasWorkspace ? 'Add a workspace' : 'Connect to Hermes'}</Text>
            <Text style={[type.body, { color: t.muted }]}>
              Enter the address of your Hermes and the account you use there.
            </Text>
          </View>

          <Pressable
            accessibilityHint="Changes how this phone reaches your Hermes"
            accessibilityLabel={`Connection: ${info.label}`}
            accessibilityRole="button"
            onPress={() => setChoosing(true)}
            style={[styles.kind, { backgroundColor: t.paper, borderColor: t.line }]}
          >
            <View style={[styles.kindIcon, { backgroundColor: t.accentBg }]}>
              <Feather color={t.accent} name={KIND_ICON[info.kind]} size={18} />
            </View>
            <View style={styles.fill}>
              <Text style={[type.small, { color: t.muted }]}>How do you connect?</Text>
              <Text style={[type.label, { color: t.ink }]}>{info.label}</Text>
            </View>
            <Feather color={t.muted} name="chevron-down" size={20} />
          </Pressable>

          <View style={styles.addressBlock}>
            <Field
              error={errors.baseUrl}
              keyboardType="url"
              label="Address"
              onChangeText={set('baseUrl')}
              placeholder={info.placeholder}
              textContentType="URL"
              value={draft.baseUrl}
            />
            {errors.baseUrl ? null : <Text style={[type.small, { color: t.muted }]}>{info.hint}</Text>}
          </View>
          <Field
            error={errors.username}
            label="Username"
            onChangeText={set('username')}
            textContentType="username"
            value={draft.username}
          />
          <Field
            error={errors.password}
            label="Password"
            onChangeText={set('password')}
            onSubmitEditing={submit}
            returnKeyType="go"
            secureTextEntry
            textContentType="password"
            value={draft.password}
          />

          {info.proxyHeaders ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setAdvanced(open => !open)}>
              <Text style={[type.label, { color: t.accent }]}>
                {advanced ? 'Hide access proxy settings' : 'Add a Cloudflare Access service token'}
              </Text>
            </Pressable>
          ) : null}

          {info.proxyHeaders && advanced ? (
            <>
              <Field
                error={errors.accessClientId}
                label="Access client ID"
                onChangeText={set('accessClientId')}
                value={draft.accessClientId ?? ''}
              />
              <Field
                error={errors.accessClientSecret}
                label="Access client secret"
                onChangeText={set('accessClientSecret')}
                secureTextEntry
                value={draft.accessClientSecret ?? ''}
              />
            </>
          ) : null}

          <Field
            label="Workspace name (optional)"
            onChangeText={set('label')}
            placeholder="Personal"
            value={draft.label ?? ''}
          />

          {failure ? (
            <View style={[styles.failure, { backgroundColor: t.redBg }]}>
              <Text style={[type.body, { color: t.red }]}>{failure}</Text>
            </View>
          ) : null}

          <Button busy={busy} label="Sign in" onPress={submit} tone="primary" />
          {hasWorkspace ? <Button label="Cancel" onPress={() => router.back()} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal animationType="slide" onRequestClose={() => setChoosing(false)} transparent visible={choosing}>
        <Pressable accessibilityLabel="Close" onPress={() => setChoosing(false)} style={styles.scrim} />
        <View style={[styles.sheet, { backgroundColor: t.bg }]}>
          <View style={styles.sheetHead}>
            <Text style={[type.heading, styles.fill, { color: t.ink }]}>How do you connect?</Text>
            <IconButton icon="x" label="Close" onPress={() => setChoosing(false)} />
          </View>
          <Text style={[type.body, { color: t.muted }]}>
            Choose how this phone reaches your Hermes host. Your Hermes username and password stay the same.
          </Text>
          <View style={[styles.options, { backgroundColor: t.paper, borderColor: t.line }]}>
            {CONNECTION_KINDS.map((option, index) => (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: option.kind === draft.kind }}
                key={option.kind}
                onPress={() => {
                  setDraft(current => ({ ...current, kind: option.kind }))
                  setErrors({})
                  setFailure(null)
                  setChoosing(false)
                }}
                style={[styles.option, index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}
              >
                <View style={[styles.kindIcon, { backgroundColor: t.accentBg }]}>
                  <Feather color={t.accent} name={KIND_ICON[option.kind]} size={18} />
                </View>
                <View style={styles.fill}>
                  <Text style={[type.label, { color: t.ink }]}>{option.label}</Text>
                  <Text style={[type.small, { color: t.muted }]}>{option.detail}</Text>
                </View>
                {option.kind === draft.kind ? <Feather color={t.ink} name="check" size={20} /> : null}
              </Pressable>
            ))}
          </View>
          <Text style={[type.small, { color: t.muted, textAlign: 'center' }]}>
            Your address is kept when you change the connection type.
          </Text>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.xl, gap: space.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  head: { gap: space.sm, marginBottom: space.sm },
  logo: { width: 56, height: 56, borderRadius: radius.md, marginBottom: space.sm },
  failure: { padding: space.md, borderRadius: radius.md },
  kind: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH + 16,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1
  },
  kindIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  addressBlock: { gap: space.xs + 2 },
  scrim: { flex: 1, backgroundColor: '#0006' },
  sheet: {
    gap: space.lg,
    padding: space.xl,
    paddingBottom: space.xxl + space.lg,
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  options: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg }
})
