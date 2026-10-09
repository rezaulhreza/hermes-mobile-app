import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Field } from '@/components/ui'
import { HermesApi } from '@/core/api'
import { type WorkspaceDraft, workspaceFromDraft } from '@/core/workspaces'
import { $workspaces, newWorkspaceId, saveWorkspace } from '@/store/workspaces'
import { radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type FieldErrors = Partial<Record<keyof WorkspaceDraft, string>>

export default function SignIn() {
  const t = useTheme()
  const hasWorkspace = useStore($workspaces).workspaces.length > 0
  const [draft, setDraft] = useState<WorkspaceDraft>({ baseUrl: '', username: '', password: '' })
  const [advanced, setAdvanced] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const set = (field: keyof WorkspaceDraft) => (value: string) => {
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

          <Field
            error={errors.baseUrl}
            keyboardType="url"
            label="Address"
            onChangeText={set('baseUrl')}
            placeholder="hermes.example.com"
            textContentType="URL"
            value={draft.baseUrl}
          />
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

          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setAdvanced(open => !open)}>
            <Text style={[type.label, { color: t.accent }]}>
              {advanced ? 'Hide access proxy settings' : 'My Hermes is behind Cloudflare Access'}
            </Text>
          </Pressable>

          {advanced ? (
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
              <Field
                label="Workspace name (optional)"
                onChangeText={set('label')}
                placeholder="Personal"
                value={draft.label ?? ''}
              />
            </>
          ) : null}

          {failure ? (
            <View style={[styles.failure, { backgroundColor: t.redBg }]}>
              <Text style={[type.body, { color: t.red }]}>{failure}</Text>
            </View>
          ) : null}

          <Button busy={busy} label="Sign in" onPress={submit} tone="primary" />
          {hasWorkspace ? <Button label="Cancel" onPress={() => router.back()} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.xl, gap: space.lg, maxWidth: 520, width: '100%', alignSelf: 'center' },
  head: { gap: space.sm, marginBottom: space.sm },
  logo: { width: 56, height: 56, borderRadius: radius.md, marginBottom: space.sm },
  failure: { padding: space.md, borderRadius: radius.md }
})
