import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useMemo, useRef, useState } from 'react'
// The plain swipeable, not the Reanimated one: with a hundred rows that one cost 2 MB a row.
import Swipeable from 'react-native-gesture-handler/Swipeable'
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar } from '@/components/bot-sheet'
import { ChannelSheet, FilterButton, ProfileSheet, ProjectSheet } from '@/components/channel-filter'
import { SessionActionsSheet } from '@/components/session-actions'
import { Button, IconButton, Notice } from '@/components/ui'
import { WorkingMark } from '@/components/working-mark'
import { botInitials, botOfBotChat } from '@/core/bots'
import { relativeTime } from '@/core/format'
import { requestSummary } from '@/core/requests'
import {
  channel,
  filterSessions,
  type LiveState,
  rowProfile,
  type SearchHit,
  sessionLine,
  type SessionRow as Row,
  sessionSections,
  sessionTitle,
  snippetParts,
  withMessageHits
} from '@/core/sessions'
import { listPaneWidth } from '@/core/layout'
import { tap } from '@/native/haptics'
import { $bots, $defaultBot } from '@/store/bots'
import { linkProblem } from '@/core/workspaces'
import { createConversation } from '@/store/chat'
import { $linkError, $linkState, type LinkState } from '@/store/link'
import { $pane, closePane, openChat, useWide } from '@/store/pane'
import { $requests } from '@/store/requests'
import {
  $liveSessions,
  $sessionHits,
  $selectedSessions,
  deleteSelected,
  toggleSelected,
  $sessionProfile,
  $sessionProject,
  $projects,
  loadProjects,
  showSessionProject,
  $sessionQuery,
  $sessions,
  $sessionsLoading,
  $sessionSource,
  $sessionSources,
  loadSessionSources,
  $sessionView,
  loadMoreSessions,
  refreshSessions,
  showSessionProfile,
  showSessionSource,
  showSessionView,
  updateSession
} from '@/store/sessions'
import { $activeWorkspace } from '@/store/workspaces'

import { ChatScreen } from '../chat/[id]'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { usePull } from '@/theme/use-pull'
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
  const pull = usePull(refreshSessions)
  // The select mode: a tap marks a row, and one bar deletes the marked rows.
  const selected = useStore($selectedSessions)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [kept, setKept] = useState(0)
  const [problem, setProblem] = useState(false)

  const removeSelected = async () => {
    setDeleting(true)

    try {
      setKept(await deleteSelected())
    } catch {
      setProblem(true)
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  const view = useStore($sessionView)
  const { width } = useWindowDimensions()
  const wide = useWide()
  const pane = useStore($pane)
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
  const actingBot = acting ? botOfBotChat(acting.title, rowProfile(acting), bots ?? []) : undefined
  // A project is a folder of the host. Its chats show alone, and a new chat works in that folder.
  const project = useStore($sessionProject)
  const projects = useStore($projects)
  const [choosingProject, setChoosingProject] = useState(false)
  const crowded = Boolean(project)
  const hits = useStore($sessionHits)
  const live = useStore($liveSessions)
  const sections = useMemo(() => withMessageHits(sessionSections(filterSessions(sessions, query, activeSource), live), hits), [sessions, query, activeSource, hits, live])

  const startChat = async () => {
    setStarting(true)

    try {
      // With one bot shown, a new chat is a chat with that bot.
      // With every bot shown, it is a chat with the default bot of the host.
      const start = shownBot ?? bots?.find(bot => bot.name === $defaultBot.get())
      const owner = start && !start.isDefault ? start.name : undefined
      const { storedId } = await createConversation(owner, project?.path ?? undefined)

      openChat({ id: storedId, live: true, profile: owner })
    } finally {
      setStarting(false)
    }
  }

  const header = (
    <View style={styles.header}>
      <View style={styles.topRow}>
        <View style={styles.fill}>
          <View style={styles.status}>
            <View style={[styles.statusDot, { backgroundColor: linkState === 'open' ? t.green : t.muted }]} />
            <Text numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
              {workspace?.label}
            </Text>
          </View>
          <Text style={[type.title, { color: t.ink }]}>Chats</Text>
        </View>
        <IconButton disabled={linkState !== 'open' || starting} filled icon="plus" label="New chat" onPress={startChat} />
      </View>

      {linkState !== 'open' ? (
        <View style={[styles.banner, { backgroundColor: t.soft }]}>
          <Text style={[type.label, { color: t.ink }]}>{LINK_LABEL[linkState]}</Text>
          {linkError && linkState !== 'connecting' ? (
            <Text style={[type.small, { color: t.muted }]}>{linkProblem(linkError)}</Text>
          ) : null}
        </View>
      ) : null}

      {requests.length ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate('/activity')}
          style={[styles.needs, { backgroundColor: t.paper, borderColor: t.line }]}
        >
          <View style={[styles.count, { backgroundColor: t.inverse }]}>
            <Text style={[type.label, { color: t.onInverse }]}>{requests.length}</Text>
          </View>
          <View style={styles.fill}>
            <Text style={[type.label, { color: t.ink }]}>Needs you</Text>
            <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
              {requestSummary(requests[0])}
            </Text>
          </View>
          <View style={[styles.review, { backgroundColor: t.accentFill }]}>
            <Text style={[type.small, { color: t.onAccent, fontWeight: '700' }]}>Review</Text>
          </View>
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
        {/* A filter that is set shows its name. With three names the row is too short, so an unset filter is then only its icon. */}
        <FilterButton
          compact={!source && crowded}
          icon={source ? channel(source).icon : 'message-circle'}
          label={source ? channel(source).label : 'Channels'}
          on={Boolean(source)}
          onPress={() => {
            setPicking(true)
            void loadSessionSources().catch(() => undefined)
          }}
          opens
        />
        <FilterButton compact={!profile && crowded} icon="users" label={shownBot?.title ?? 'Profiles'} on={Boolean(profile)} onPress={() => setChoosingProfile(true)} opens />
        <FilterButton
          compact={!project}
          icon="folder"
          label={project?.label ?? 'Projects'}
          on={Boolean(project)}
          onPress={() => {
            setChoosingProject(true)
            void loadProjects().catch(() => undefined)
          }}
        />
        <FilterButton compact icon="archive" label="Archived" on={view === 'archived'} onPress={() => showSessionView(view === 'archived' ? 'current' : 'archived')} />
      </View>
    </View>
  )

  const filtered = Boolean(query || activeSource)

  return (
    <View style={[styles.split, { backgroundColor: t.bg }]}>
    <SafeAreaView edges={wide ? ['top', 'left'] : ['top']} style={[wide ? { width: listPaneWidth(width) } : styles.fill, { backgroundColor: t.bg }]}>
      <SectionList
        automaticallyAdjustKeyboardInsets
        ListEmptyComponent={
          // A view that is still loading, for example the archive after its button: not a blank list that looks stuck.
          loading ? (
            <View style={styles.loading}>
              <ActivityIndicator accessibilityLabel="Loading conversations" color={t.muted} />
            </View>
          ) : linkState === 'open' ? (
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
        initialNumToRender={12}
        keyboardDismissMode="on-drag"
        maxToRenderPerBatch={10}
        onEndReached={() => void loadMoreSessions()}
        onEndReachedThreshold={0.5}
        refreshControl={<RefreshControl onRefresh={pull.onRefresh} refreshing={pull.refreshing} tintColor={t.muted} />}
        renderItem={({ item, index, section }) => (
          <SessionRow
            first={index === 0}
            last={index === section.data.length - 1}
            bot={profile || !rowProfile(item) ? undefined : (botTitles.get(item.profile ?? '') ?? item.profile ?? undefined)}
            // The host titles the one long chat of every bot "Bot Chat": a person reads the name of the bot.
            botChat={botOfBotChat(item.title, rowProfile(item), bots ?? [])?.title}
            onActions={() => setActing(item)}
            // In the list of every profile, each row shows whose conversation it is.
            owner={profile ? undefined : (item.profile ?? undefined)}
            live={live[item.id]}
            row={item}
            selected={selected ? selected.includes(item.id) : undefined}
          />
        )}
        renderSectionHeader={({ section }) =>
          section.title ? <Text style={[type.small, styles.section, { color: t.muted, backgroundColor: t.bg }]}>{section.title}</Text> : null
        }
        sections={sections}
        stickySectionHeadersEnabled={false}
        // Three screens of rows are drawn, not the whole list: a row costs memory.
        windowSize={5}
      />
      <ProfileSheet active={profile} bots={bots ?? []} onClose={() => setChoosingProfile(false)} onPick={showSessionProfile} visible={choosingProfile} />
      <ProjectSheet active={project?.id ?? null} onClose={() => setChoosingProject(false)} onPick={showSessionProject} projects={projects} visible={choosingProject} />
      <ChannelSheet active={source} onClose={() => setPicking(false)} onPick={showSessionSource} sources={sources} visible={picking} />
      {selected ? (
        <View style={[styles.selectBar, { backgroundColor: t.paper, borderColor: t.line }]}>
          <Text style={[type.label, styles.fill, { color: t.ink }]}>
            {problem ? 'Hermes did not delete them. Try again.' : confirming ? `Delete ${selected.length} ${selected.length === 1 ? 'chat' : 'chats'} and all their messages?` : `${selected.length} selected`}
          </Text>
          <Button
            label={confirming ? 'Keep' : 'Cancel'}
            onPress={() => {
              if (confirming) {
                setConfirming(false)
              } else {
                $selectedSessions.set(null)
              }
            }}
          />
          <Button busy={deleting} disabled={!selected.length} label="Delete" onPress={() => (setProblem(false), confirming ? void removeSelected() : setConfirming(true))} tone="danger" />
        </View>
      ) : kept ? (
        <Pressable accessibilityRole="button" onPress={() => setKept(0)} style={[styles.selectBar, { backgroundColor: t.paper, borderColor: t.line }]}>
          <Text style={[type.small, styles.fill, { color: t.ink }]}>
            {kept === 1 ? '1 chat was kept: Hermes still works in it.' : `${kept} chats were kept: Hermes still works in them.`}
          </Text>
          <Feather color={t.muted} name="x" size={18} />
        </Pressable>
      ) : null}
      <SessionActionsSheet
        canSelect
        onBranched={storedId => openChat({ id: storedId, profile: (acting && rowProfile(acting)) || undefined })}
        onClose={() => setActing(null)}
        // The host finds the chat of a bot by its title, so the phone must not rename or remove it.
        only={actingBot ? ['branch', 'export-text', 'export'] : undefined}
        row={acting}
        shownTitle={actingBot?.title}
      />
    </SafeAreaView>
      {wide ? (
        <View style={[styles.fill, styles.pane, { borderLeftColor: t.line }]}>
          {pane ? (
            // A key for each chat: the screen of the chat before is taken down, with its call and its timers.
            <ChatScreen
              embedded={{ onClose: closePane, onOpen: (id, owner) => openChat({ id, profile: owner }) }}
              key={pane.id}
              params={{ id: pane.id, title: pane.title, live: pane.live ? '1' : undefined, profile: pane.profile }}
            />
          ) : (
            <Notice detail="The chat opens here, beside the list." icon="message-circle" title="Choose a chat" />
          )}
        </View>
      ) : null}
    </View>
  )
}

/**
 * `bot` names the owner of a row that is not the host's own profile, in the list of all profiles.
 * `botChat` is the name of the bot when the row is that bot's own long chat.
 * `live` says that Hermes works in the conversation now, or that it waits for the user.
 */
function SessionRow({
  row,
  bot,
  botChat,
  owner,
  live,
  onActions,
  selected,
  first,
  last
}: {
  row: Row
  bot?: string
  botChat?: string
  owner?: string
  live?: LiveState
  onActions: () => void
  selected?: boolean
  /** The rows of a section sit on one card: the first and the last round its corners. */
  first: boolean
  last: boolean
}) {
  const t = useTheme()
  // The bot that owns the conversation. Its picture is the same one the Bots tab shows: a photo, or its drawn avatar.
  const ownerBot = useStore($bots)?.find(known => known.name === owner)
  const snippet = (row as SearchHit).snippet
  const line = sessionLine(row)
  const title = botChat ?? sessionTitle(row)
  // The title of a bot's own chat names the bot already.
  const named = botChat ? undefined : bot
  const at = row.last_active ?? row.started_at

  const swipe = useRef<Swipeable>(null)
  // The same two actions as the sheet of a long press, one swipe away. The list shows the change at once.
  const act = (change: Pick<Row, 'pinned' | 'archived'>) => {
    tap()
    swipe.current?.close()
    void updateSession(row, change).catch(() => undefined)
  }

  return (
    <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.line }, first && styles.cardFirst, last && styles.cardLast]}>
    <Swipeable
      friction={2}
      overshootRight={false}
      ref={swipe}
      renderRightActions={() => (
        <View style={styles.swipe}>
          <Pressable
            accessibilityLabel={row.pinned ? `Unpin ${title}` : `Pin ${title}`}
            accessibilityRole="button"
            onPress={() => act({ pinned: !row.pinned })}
            style={[styles.swipeAction, { backgroundColor: t.soft }]}
          >
            <Feather color={t.ink} name="bookmark" size={20} />
            <Text style={[type.small, { color: t.ink }]}>{row.pinned ? 'Unpin' : 'Pin'}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={row.archived ? `Move ${title} back` : `Archive ${title}`}
            accessibilityRole="button"
            onPress={() => act({ archived: !row.archived })}
            style={[styles.swipeAction, { backgroundColor: t.accentBg }]}
          >
            <Feather color={t.accent} name="archive" size={20} />
            <Text style={[type.small, { color: t.accent }]}>{row.archived ? 'Move back' : 'Archive'}</Text>
          </Pressable>
        </View>
      )}
      rightThreshold={40}
    >
    <Pressable
      accessibilityHint="Hold or swipe left for more actions"
      accessibilityLabel={live ? `${title}, ${live === 'waiting' ? 'needs you' : 'Hermes works'}` : title}
      accessibilityRole="button"
      delayLongPress={350}
      onLongPress={() => (tap(), selected === undefined ? onActions() : toggleSelected(row.id))}
      onPress={() => selected !== undefined ? toggleSelected(row.id) : openChat({ id: row.id, title, profile: rowProfile(row) || undefined })}
      // The row hides the actions under it until it slides, so it needs a colour of its own.
      style={({ pressed }) => [styles.row, { borderBottomColor: t.line, backgroundColor: pressed ? t.soft : t.paper }, last && styles.rowLast]}
    >
      {selected === undefined ? null : <Feather accessibilityLabel={selected ? 'Selected' : 'Not selected'} color={selected ? t.accent : t.muted} name={selected ? 'check-circle' : 'circle'} size={22} />}
      {row.unread ? <View accessibilityLabel="Unread" style={[styles.unread, { backgroundColor: t.accent }]} /> : null}
      {owner ? (
        ownerBot ? (
          <View accessibilityLabel={bot ?? 'Main profile'}>
            <BotAvatar bot={ownerBot} size={34} t={t} />
          </View>
        ) : (
          // A profile the list of bots does not know yet: its letters.
          <View accessibilityLabel={bot ?? 'Main profile'} style={[styles.owner, styles.initials, { backgroundColor: t.soft }]}>
            <Text style={[type.small, { color: t.muted, fontWeight: '700' }]}>{botInitials(bot ?? owner)}</Text>
          </View>
        )
      ) : null}
      <View style={styles.fill}>
        <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
          {title}
        </Text>
        {snippet ? (
          // A match in a message: the words around it, with the match in strong ink.
          <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
            {snippetParts(snippet).map((part, index) =>
              part.hit ? (
                <Text key={index} style={{ color: t.ink, fontWeight: '700' }}>
                  {part.text}
                </Text>
              ) : (
                part.text
              )
            )}
          </Text>
        ) : named || line ? (
          <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
            {named ? <Text style={{ color: t.accent, fontWeight: '600' }}>{named}</Text> : null}
            {named && line ? '  ·  ' : ''}
            {line}
          </Text>
        ) : null}
      </View>
      {row.pinned ? <Feather color={t.muted} name="bookmark" size={14} /> : null}
      {row.source ? (
        <Feather accessibilityLabel={channel(row.source).label} color={t.muted} name={channel(row.source).icon} size={14} />
      ) : null}
      {live === 'working' ? (
        // A turn runs now: the mark of the chat screen stands where the time was.
        <WorkingMark />
      ) : (
        live ? (
          <View style={[styles.chip, { backgroundColor: t.inverse }]}>
            <Text style={[type.small, { color: t.onInverse, fontWeight: '700' }]}>Needs you</Text>
          </View>
        ) : (
          <Text style={[type.small, { color: t.muted }]}>{at ? relativeTime(at) : ''}</Text>
        )
      )}
    </Pressable>
    </Swipeable>
    </View>
  )
}

const styles = StyleSheet.create({
  selectBar: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: TAB_BAR_CLEARANCE - space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth
  },
  swipe: { flexDirection: 'row' },
  swipeAction: { width: 84, alignItems: 'center', justifyContent: 'center', gap: 4 },
  fill: { flex: 1 },
  loading: { paddingTop: space.xxl, alignItems: 'center' },
  split: { flex: 1, flexDirection: 'row' },
  pane: { borderLeftWidth: StyleSheet.hairlineWidth },
  list: { paddingBottom: TAB_BAR_CLEARANCE, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  header: { padding: space.lg, gap: space.md },
  topRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  banner: { padding: space.md, borderRadius: radius.md, gap: 2 },
  needs: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  count: { minWidth: 32, height: 32, paddingHorizontal: space.sm, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  review: { height: 32, paddingHorizontal: space.md, borderRadius: 16, justifyContent: 'center' },
  chip: { paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  card: { marginHorizontal: space.lg, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.lg - 6, borderTopRightRadius: radius.lg - 6 },
  cardLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.lg - 6, borderBottomRightRadius: radius.lg - 6 },
  rowLast: { borderBottomWidth: 0 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.md
  },
  filters: { flexDirection: 'row', gap: space.sm },
  section: { fontWeight: '600', paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  // In the margin of the row, so an unread row keeps its picture and its title in line with the others.
  unread: { position: 'absolute', left: space.xs, top: '50%', marginTop: -4, width: 8, height: 8, borderRadius: 4 },
  owner: { width: 34, height: 34, borderRadius: 17 },
  initials: { alignItems: 'center', justifyContent: 'center' },
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
