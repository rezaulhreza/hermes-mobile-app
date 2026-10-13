import { useStore } from '@nanostores/react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { clearAttachments } from '@/store/attachments'
import { clearBots, restoreBots } from '@/store/bots'
import { clearPreviews } from '@/store/browser'
import { clearConversations } from '@/store/chat'
import { clearCatalog } from '@/store/commands'
import { clearSchedules, restoreSchedules } from '@/store/cron'
import { clearHostSettings } from '@/store/host-settings'
import { $linkState, closeLink, openLink, redialNow } from '@/store/link'
import { refreshScreenHold } from '@/store/screen'
import { loadPreferences } from '@/store/preferences'
import { preloadLists } from '@/store/preload'
import { clearProviders, restoreProviders } from '@/store/providers'
import { clearPush, installPush, registerPush } from '@/store/push'
import { clearRequests } from '@/store/requests'
import { clearSessions, restoreSessions } from '@/store/sessions'
import { clearVault } from '@/store/vault'
import { clearVoice } from '@/store/voice'
import { clearWake } from '@/store/wake'
import { clearWork } from '@/store/work'
import { clearWorkspace } from '@/store/workspace'
import { $activeWorkspace, loadWorkspaces } from '@/store/workspaces'
import { useTheme } from '@/theme/use-theme'

if (__DEV__) {
  // Lets scripts/drive.mjs press and type in the Simulator. Not in a release bundle.
  void import('@/dev/driver')
}

export default function RootLayout() {
  const t = useTheme()
  const workspace = useStore($activeWorkspace)
  const linkState = useStore($linkState)

  useEffect(() => {
    void loadPreferences().then(loadWorkspaces)
    installPush()
  }, [])

  // One link per active workspace. A switch drops every screen's data first,
  // so nothing from the previous account stays on screen.
  useEffect(() => {
    clearSessions()
    clearConversations()
    clearCatalog()
    clearAttachments()
    clearRequests()
    clearVault()
    clearPreviews()
    clearVoice()
    clearWake()
    clearWork()
    clearBots()
    clearSchedules()
    clearWorkspace()
    clearProviders()
    clearPush()
    clearHostSettings()

    if (workspace) {
      // What the last run showed is on screen before the host answers.
      restoreSessions()
      restoreBots()
      restoreSchedules()
      restoreProviders()
      void openLink(workspace)
    } else {
      closeLink()
    }
  }, [workspace])

  useEffect(() => {
    if (linkState === 'open') {
      void registerPush()
      void refreshScreenHold()
      void preloadLists()
    }
  }, [linkState])

  // iOS suspends the socket in the background. Dial at once on return instead
  // of waiting for the backoff timer.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        redialNow()
      }
    })

    return () => subscription.remove()
  }, [])

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="chat/[id]" />
          <Stack.Screen name="vault" />
          <Stack.Screen name="voice" />
          <Stack.Screen name="providers" />
          <Stack.Screen name="keys" />
          <Stack.Screen name="cron" />
          <Stack.Screen name="file" />
          <Stack.Screen name="room" />
          <Stack.Screen name="host" />
          <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
