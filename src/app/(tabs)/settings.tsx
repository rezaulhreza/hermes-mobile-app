import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, Card } from '@/components/ui'
import { HermesApi } from '@/core/api'
import type { Workspace } from '@/core/workspaces'
import { $linkState } from '@/store/link'
import { $workspaces, forgetWorkspace, switchWorkspace } from '@/store/workspaces'
import { space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { TAB_BAR_CLEARANCE } from './_layout'

export default function Settings() {
  const t = useTheme()
  const { workspaces, activeId } = useStore($workspaces)
  const linkState = useStore($linkState)

  const signOut = (workspace: Workspace) =>
    Alert.alert(`Sign out of ${workspace.label}?`, 'This removes the workspace and its password from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          // Revoke on the backend first: a session cookie left alive still
          // grants access to the machine. The local removal happens either way.
          await new HermesApi(workspace).signOut()
          await forgetWorkspace(workspace.id)
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
        </Card>

        <Text style={[type.small, styles.section, { color: t.muted }]}>This phone</Text>
        <Card style={styles.card}>
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
