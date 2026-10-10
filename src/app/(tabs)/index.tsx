import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { IconButton, Notice } from '@/components/ui'
import { greeting, previewLine, relativeTime } from '@/core/format'
import type { SessionListRow } from '@/core/gateway/gateway-contract.generated'
import { requestSummary } from '@/core/requests'
import { createConversation } from '@/store/chat'
import { $linkError, $linkState, type LinkState } from '@/store/link'
import { $requests } from '@/store/requests'
import { $sessionQuery, $sessions, $sessionsLoading, refreshSessions } from '@/store/sessions'
import { $activeWorkspace } from '@/store/workspaces'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { TAB_BAR_CLEARANCE } from './_layout'

const LINK_LABEL: Record<Exclude<LinkState, 'open'>, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  failed: 'Cannot reach Hermes',
  'auth-failed': 'Sign-in was refused'
}

export default function Chats() {
  const t = useTheme()
  const workspace = useStore($activeWorkspace)
  const sessions = useStore($sessions)
  const loading = useStore($sessionsLoading)
  const linkState = useStore($linkState)
  const linkError = useStore($linkError)
  const requests = useStore($requests)
  const query = useStore($sessionQuery)
  const [starting, setStarting] = useState(false)

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return needle
      ? sessions.filter(s => `${s.title ?? ''} ${s.preview ?? ''}`.toLowerCase().includes(needle))
      : sessions
  }, [sessions, query])

  const startChat = async () => {
    setStarting(true)

    try {
      const { storedId } = await createConversation()

      router.push({ pathname: '/chat/[id]', params: { id: storedId, live: '1' } })
    } finally {
      setStarting(false)
    }
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
            {workspace?.label}
          </Text>
          <Text style={[type.title, { color: t.ink }]}>{greeting(new Date())}</Text>
        </View>
        <IconButton disabled={linkState !== 'open' || starting} filled icon="plus" label="New chat" onPress={startChat} />
      </View>

      {linkState !== 'open' ? (
        <View style={[styles.banner, { backgroundColor: t.soft }]}>
          <Text style={[type.label, { color: t.ink }]}>{LINK_LABEL[linkState]}</Text>
          {linkError && linkState !== 'connecting' ? (
            <Text style={[type.small, { color: t.muted }]}>{linkError}</Text>
          ) : null}
        </View>
      ) : null}

      {requests.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate('/activity')}
          style={[styles.needs, { backgroundColor: t.accentBg }]}
        >
          <Feather color={t.accent} name="shield" size={20} />
          <View style={styles.fill}>
            <Text style={[type.label, { color: t.ink }]}>
              {requests.length === 1 ? '1 thing needs you' : `${requests.length} things need you`}
            </Text>
            <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
              {requestSummary(requests[0])}
            </Text>
          </View>
          <Feather color={t.ink} name="chevron-right" size={20} />
        </Pressable>
      ) : null}

      <View style={[styles.search, { backgroundColor: t.soft }]}>
        <Feather color={t.muted} name="search" size={18} />
        <TextInput
          accessibilityLabel="Search conversations"
          autoCorrect={false}
          onChangeText={text => $sessionQuery.set(text)}
          placeholder="Search conversations"
          placeholderTextColor={t.muted}
          style={[styles.fill, type.body, { color: t.ink }]}
          value={query}
        />
      </View>
    </View>
  )

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <FlatList
        ListEmptyComponent={
          linkState === 'open' && !loading ? (
            <Notice
              detail={query ? 'Try another title.' : 'Tap + to start one.'}
              icon="message-circle"
              title={query ? 'No matching conversations' : 'No conversations yet'}
            />
          ) : null
        }
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        data={shown}
        keyExtractor={row => row.id}
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl onRefresh={refreshSessions} refreshing={loading} tintColor={t.muted} />}
        renderItem={({ item }) => <SessionRow row={item} />}
      />
    </SafeAreaView>
  )
}

function SessionRow({ row }: { row: SessionListRow }) {
  const t = useTheme()
  const preview = previewLine(row.preview ?? '')
  const title = row.title?.trim() || preview || 'Untitled conversation'

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: row.id, title } })}
      style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
    >
      <View style={styles.fill}>
        <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
          {title}
        </Text>
        {row.title && preview ? (
          <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
            {preview}
          </Text>
        ) : null}
      </View>
      <Text style={[type.small, { color: t.muted }]}>
        {[row.source && row.source !== 'mobile' ? row.source : null, row.started_at ? relativeTime(row.started_at) : null]
          .filter(Boolean)
          .join(' · ')}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { paddingBottom: TAB_BAR_CLEARANCE, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  header: { padding: space.lg, gap: space.md },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  banner: { padding: space.md, borderRadius: radius.md, gap: 2 },
  needs: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.md
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth
  }
})
