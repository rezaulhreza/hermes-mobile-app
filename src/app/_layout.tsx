import { useStore } from '@nanostores/react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { AppState } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { clearAttachments } from '@/store/attachments'
import { clearPreviews } from '@/store/browser'
import { clearConversations } from '@/store/chat'
import { clearCatalog } from '@/store/commands'
import { $linkState, closeLink, openLink, redialNow } from '@/store/link'
import { clearRequests } from '@/store/requests'
import { clearSessions, refreshSessions } from '@/store/sessions'
import { clearVault } from '@/store/vault'
import { clearVoice } from '@/store/voice'
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
    void loadWorkspaces()
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

    if (workspace) {
      void openLink(workspace)
    } else {
      closeLink()
    }
  }, [workspace])

  useEffect(() => {
    if (linkState === 'open') {
      void refreshSessions()
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
          <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
