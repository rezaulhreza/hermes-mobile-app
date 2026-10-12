import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card } from '@/components/ui'
import { HermesApi } from '@/core/api'
import type { Workspace } from '@/core/workspaces'
import { $linkState } from '@/store/link'
import { $preferences, type AppearanceChoice, setPreference } from '@/store/preferences'
import { $push, type PushState, unregisterPush } from '@/store/push'
import { forgetCached } from '@/store/cache'
import { $workspaces, forgetWorkspace, switchWorkspace } from '@/store/workspaces'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { TAB_BAR_CLEARANCE } from './_layout'

/** What the Notifications row says for each answer of the system. */
const PUSH_TEXT: Record<PushState['permission'], (push: PushState) => string> = {
  unknown: () => 'Checked when the workspace connects',
  undetermined: () => 'Not asked yet',
  denied: () => 'Off. Turn them on in the Settings app.',
  unavailable: () => 'This build has no notifications',
  granted: push => (push.error ? `On, but this host did not take the phone: ${push.error}` : push.registered ? 'On. Hermes tells you when it needs you.' : 'On. Not registered with this host yet.')
}

const APPEARANCES: readonly { value: AppearanceChoice; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

export default function Settings() {
  const t = useTheme()
  const { appearance } = useStore($preferences)
  const { workspaces, activeId } = useStore($workspaces)
  const linkState = useStore($linkState)
  const push = useStore($push)

  const signOut = (workspace: Workspace) =>
    Alert.alert(`Sign out of ${workspace.label}?`, 'This removes the workspace and its password from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          // Revoke on the backend first: a session cookie left alive still
          // grants access to the machine. The local removal happens either way.
          const backend = new HermesApi(workspace)

          // While the cookie still works: this phone must get no notification of a host it left.
          await unregisterPush(backend, workspace.id)
          await backend.signOut()
          await forgetWorkspace(workspace.id)
          forgetCached(workspace.id)
        }
      }
    ])

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.title, { color: t.ink }]}>Settings</Text>

        <Text style={[type.small, styles.section, { color: t.muted }]}>For the agent</Text>
        <Card style={styles.card}>
          <Pressable
            accessibilityHint="The logins, cards and addresses Hermes may use in its own browser"
            accessibilityLabel="Logins and cards"
            accessibilityRole="button"
            onPress={() => router.push('/vault')}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="key" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>Logins and cards</Text>
              <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                What Hermes signs in and pays with in its own browser
              </Text>
            </View>
            <Feather color={t.muted} name="chevron-right" size={20} />
          </Pressable>
          <Pressable
            accessibilityHint="Connect a model provider and choose the default model"
            accessibilityLabel="Providers and models"
            accessibilityRole="button"
            onPress={() => router.push('/providers')}
            style={({ pressed }) => [styles.row, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="cpu" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>Providers and models</Text>
              <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                What your agent thinks with, and the default model
              </Text>
            </View>
            <Feather color={t.muted} name="chevron-right" size={20} />
          </Pressable>
          <Pressable
            accessibilityHint="The secrets of your Hermes host"
            accessibilityLabel="API keys"
            accessibilityRole="button"
            onPress={() => router.push('/keys')}
            style={({ pressed }) => [styles.row, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="lock" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>API keys</Text>
              <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                Keys for tools and services, on your Hermes host
              </Text>
            </View>
            <Feather color={t.muted} name="chevron-right" size={20} />
          </Pressable>
          <Pressable
            accessibilityHint="Work your agent does at a time, with nobody there"
            accessibilityLabel="Schedules"
            accessibilityRole="button"
            onPress={() => router.push('/cron')}
            style={({ pressed }) => [styles.row, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="clock" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>Schedules</Text>
              <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                Work your agent does at a time, with nobody there
              </Text>
            </View>
            <Feather color={t.muted} name="chevron-right" size={20} />
          </Pressable>
        </Card>

        <Text style={[type.small, styles.section, { color: t.muted }]}>This phone</Text>
        <Card style={styles.card}>
          <View style={styles.row}>
            <Feather color={t.muted} name="sun" size={20} />
            <Text style={[type.label, styles.fill, { color: t.ink }]}>Appearance</Text>
            <View style={[styles.choices, { backgroundColor: t.soft }]}>
              {APPEARANCES.map(choice => {
                const on = appearance === choice.value

                return (
                  <Pressable
                    accessibilityLabel={`Appearance: ${choice.label}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    key={choice.value}
                    onPress={() => setPreference('appearance', choice.value)}
                    style={[styles.choice, on && { backgroundColor: t.paper }]}
                  >
                    <Text style={[type.small, { color: on ? t.ink : t.muted, fontWeight: '600' }]}>{choice.label}</Text>
                  </Pressable>
                )
              })}
            </View>
          </View>
          <Pressable
            accessibilityHint="The speech engine of a call and the wake word"
            accessibilityLabel="Voice"
            accessibilityRole="button"
            onPress={() => router.push('/voice')}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="mic" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>Voice</Text>
              <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                The speech engine of a call, and the wake word
              </Text>
            </View>
            <Feather color={t.muted} name="chevron-right" size={20} />
          </Pressable>
          <Pressable
            accessibilityHint="Opens the notification settings of this app"
            accessibilityLabel="Notifications"
            accessibilityRole="button"
            onPress={() => void Linking.openSettings()}
            style={({ pressed }) => [styles.row, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
          >
            <Feather color={t.muted} name="bell" size={20} />
            <View style={styles.fill}>
              <Text style={[type.label, { color: t.ink }]}>Notifications</Text>
              <Text numberOfLines={2} style={[type.small, { color: push.error ? t.red : t.muted }]}>
                {PUSH_TEXT[push.permission](push)}
              </Text>
            </View>
            <Feather color={t.muted} name="external-link" size={18} />
          </Pressable>
        </Card>

        <Text style={[type.small, styles.section, { color: t.muted }]}>Workspaces</Text>
        <Card style={styles.card}>
          {workspaces.map((workspace, index) => {
            const active = workspace.id === activeId

            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                key={workspace.id}
                onLongPress={() => signOut(workspace)}
                onPress={() => void switchWorkspace(workspace.id)}
                style={[styles.row, index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}
              >
                <View style={styles.fill}>
                  <Text style={[type.label, { color: t.ink }]}>{workspace.label}</Text>
                  <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                    {workspace.username} · {workspace.baseUrl.replace(/^https?:\/\//, '')}
                    {active ? ` · ${linkState}` : ''}
                  </Text>
                </View>
                {active ? <Feather color={t.accent} name="check" size={20} /> : null}
                <Pressable accessibilityLabel={`Sign out of ${workspace.label}`} hitSlop={10} onPress={() => signOut(workspace)}>
                  <Feather color={t.muted} name="log-out" size={18} />
                </Pressable>
              </Pressable>
            )
          })}
        </Card>
        <Button icon="plus" label="Add a workspace" onPress={() => router.push('/sign-in')} />
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  choices: { flexDirection: 'row', padding: 3, borderRadius: radius.md },
  choice: { minHeight: 32, paddingHorizontal: space.md, justifyContent: 'center', borderRadius: radius.md - 3 },
  fill: { flex: 1 },
  content: {
    padding: space.lg,
    gap: space.md,
    paddingBottom: TAB_BAR_CLEARANCE,
    maxWidth: 760,
    width: '100%',
    alignSelf: 'center'
  },
  section: { fontWeight: '700', marginTop: space.md },
  card: { padding: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg }
})
