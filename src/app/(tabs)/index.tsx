import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { ChannelSheet, FilterButton, ProfileSheet } from '@/components/channel-filter'
import { SessionActionsSheet } from '@/components/session-actions'
import { IconButton, Notice } from '@/components/ui'
import { greeting, relativeTime } from '@/core/format'
import { requestSummary } from '@/core/requests'
import { channel, filterSessions, rowProfile, sessionPreview, type SessionRow as Row, sessionSections, sessionTitle } from '@/core/sessions'
import { $bots } from '@/store/bots'
import { createConversation } from '@/store/chat'
import { $linkError, $linkState, type LinkState } from '@/store/link'
import { $requests } from '@/store/requests'
import {
  $sessionProfile,
  $sessionQuery,
  $sessions,
  $sessionsLoading,
  $sessionSource,
  $sessionSources,
  $sessionView,
  loadMoreSessions,
  refreshSessions,
  showSessionProfile,
  showSessionSource,
  showSessionView
} from '@/store/sessions'
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

  const view = useStore($sessionView)
  const source = useStore($sessionSource)
  const [acting, setActing] = useState<Row | null>(null)

  // The backend filters by source.
  const sources = useStore($sessionSources)
  const activeSource = source
  const [picking, setPicking] = useState(false)
  // Each bot is a profile with its own conversations. The list shows every profile, or one.
  const profile = useStore($sessionProfile)
  const bots = useStore($bots)
  const botTitles = useMemo(() => new Map((bots ?? []).map(bot => [bot.name, bot.title])), [bots])
  const shownBot = bots?.find(bot => bot.name === profile)
  const [choosingProfile, setChoosingProfile] = useState(false)
  const sections = useMemo(() => sessionSections(filterSessions(sessions, query, activeSource)), [sessions, query, activeSource])

  const startChat = async () => {
    setStarting(true)

    try {
      // With one bot shown, a new chat is a chat with that bot.
      const owner = shownBot && !shownBot.isDefault ? shownBot.name : undefined
      const { storedId } = await createConversation(owner)

      router.push({ pathname: '/chat/[id]', params: { id: storedId, live: '1', ...(owner ? { profile: owner } : {}) } })
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

      <View style={styles.filters}>
        <FilterButton
          icon={source ? channel(source).icon : 'message-circle'}
          label={source ? channel(source).label : 'All channels'}
          on={Boolean(source)}
          onPress={() => setPicking(true)}
          opens
        />
        <FilterButton icon="users" label={shownBot?.title ?? 'All profiles'} on={Boolean(profile)} onPress={() => setChoosingProfile(true)} opens />
        <FilterButton compact icon="archive" label="Archived" on={view === 'archived'} onPress={() => showSessionView(view === 'archived' ? 'current' : 'archived')} />
      </View>
    </View>
  )

  const filtered = Boolean(query || activeSource)

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <SectionList
        ListEmptyComponent={
          linkState === 'open' && !loading ? (
            <Notice
              detail={filtered ? 'Try other words or another filter.' : view === 'archived' ? 'Archive a conversation to put it away without deleting it.' : 'Tap + to start one.'}
              icon={view === 'archived' ? 'archive' : 'message-circle'}
              title={filtered ? 'No matching conversations' : view === 'archived' ? 'Nothing is archived' : 'No conversations yet'}
            />
          ) : null
        }
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        keyExtractor={row => row.id}
        keyboardDismissMode="on-drag"
        onEndReached={() => void loadMoreSessions()}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl onRefresh={refreshSessions} refreshing={loading} tintColor={t.muted} />}
        renderItem={({ item }) => <SessionRow bot={profile || !rowProfile(item) ? undefined : (botTitles.get(item.profile ?? '') ?? item.profile ?? undefined)} onActions={() => setActing(item)} row={item} />}
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={[type.small, styles.section, { color: t.muted, backgroundColor: t.bg }]}>{section.title}</Text> : null
        }
        sections={sections}
        stickySectionHeadersEnabled={false}
      />
      <ProfileSheet active={profile} bots={bots ?? []} onClose={() => setChoosingProfile(false)} onPick={showSessionProfile} visible={choosingProfile} />
      <ChannelSheet active={source} onClose={() => setPicking(false)} onPick={showSessionSource} sources={sources} visible={picking} />
      <SessionActionsSheet
        onBranched={storedId => router.push({ pathname: '/chat/[id]', params: { id: storedId, ...(acting && rowProfile(acting) ? { profile: rowProfile(acting) } : {}) } })}
        onClose={() => setActing(null)}
        row={acting}
      />
    </SafeAreaView>
  )
}

/** `bot` names the owner of a row that is not the host's own profile, in the list of all profiles. */
function SessionRow({ row, bot, onActions }: { row: Row; bot?: string; onActions: () => void }) {
  const t = useTheme()
  const preview = sessionPreview(row)
  const title = sessionTitle(row)
  const at = row.last_active ?? row.started_at

  return (
    <Pressable
      accessibilityHint="Hold for more actions"
      accessibilityLabel={title}
      accessibilityRole="button"
      delayLongPress={350}
      onLongPress={onActions}
      onPress={() => router.push({ pathname: '/chat/[id]', params: { id: row.id, title, ...(rowProfile(row) ? { profile: rowProfile(row) } : {}) } })}
      style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
    >
      {row.unread ? <View accessibilityLabel="Unread" style={[styles.unread, { backgroundColor: t.accent }]} /> : null}
      <View style={styles.fill}>
        <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
          {title}
        </Text>
        {bot || (row.title && preview) ? (
          <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
            {bot ? <Text style={{ color: t.accent, fontWeight: '600' }}>{bot}</Text> : null}
            {bot && row.title && preview ? '  ·  ' : ''}
            {row.title ? preview : ''}
          </Text>
        ) : null}
      </View>
      {row.pinned ? <Feather color={t.muted} name="bookmark" size={14} /> : null}
      {row.source ? (
        <Feather accessibilityLabel={channel(row.source).label} color={t.muted} name={channel(row.source).icon} size={14} />
      ) : null}
      <Text style={[type.small, { color: t.muted }]}>{at ? relativeTime(at) : ''}</Text>
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
  filters: { flexDirection: 'row', gap: space.sm },
  section: { fontWeight: '700', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  unread: { width: 8, height: 8, borderRadius: 4 },
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
