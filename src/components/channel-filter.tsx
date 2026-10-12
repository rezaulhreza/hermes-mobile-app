import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { ActivityIndicator, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { type Bot, botInitials } from '@/core/bots'
import { folderLine, type ProjectChoice } from '@/core/projects'
import { channel } from '@/core/sessions'
import { $botAvatars } from '@/store/bots'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton, type IconName } from './ui'

interface ButtonProps {
  icon: IconName
  label: string
  /** The filter is set: the button shows it in the accent colour. */
  on: boolean
  /** The button opens a list. */
  opens?: boolean
  /** Only the icon shows. The label is still what a screen reader says. */
  compact?: boolean
  onPress: () => void
}

/** One filter of the chat list, under the search field. */
export function FilterButton({ icon, label, on, opens, compact, onPress }: ButtonProps) {
  const t = useTheme()
  const ink = on ? t.accent : t.ink

  return (
    <Pressable
      accessibilityLabel={`Filter: ${label}`}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        !compact && styles.shrink,
        { backgroundColor: on ? t.accentBg : t.paper, borderColor: on ? t.accent : t.line },
        pressed && styles.dim
      ]}
    >
      <Feather color={on ? t.accent : t.muted} name={icon} size={16} />
      {compact ? null : (
        <Text numberOfLines={1} style={[type.small, styles.shrink, { color: ink, fontWeight: '600' }]}>
          {label}
        </Text>
      )}
      {opens ? <Feather color={on ? t.accent : t.muted} name="chevron-down" size={14} /> : null}
    </Pressable>
  )
}

interface SheetProps {
  visible: boolean
  sources: readonly string[]
  /** The source that is shown now. Null shows all. */
  active: string | null
  onPick: (source: string | null) => void
  onClose: () => void
}

/** Where a conversation started: the desktop app, the phone, Telegram, the API, a schedule. */
export function ChannelSheet({ visible, sources, active, onPick, onClose }: SheetProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const rows: (string | null)[] = [null, ...[...sources].sort((a, b) => channel(a).label.localeCompare(channel(b).label))]

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Channels</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <FlatList
          data={rows}
          keyExtractor={source => source ?? 'all'}
          renderItem={({ item }) => {
            const { label, icon } = item ? channel(item) : { label: 'All channels', icon: 'message-circle' as const }
            const on = item === active

            return (
              <Pressable
                accessibilityLabel={`Channel: ${label}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => (onPick(item), onClose())}
                style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
              >
                <View style={[styles.badge, { backgroundColor: on ? t.accentBg : t.soft }]}>
                  <Feather color={on ? t.accent : t.muted} name={icon} size={18} />
                </View>
                <Text style={[type.label, styles.fill, { color: t.ink }]}>{label}</Text>
                {on ? <Feather color={t.accent} name="check" size={18} /> : null}
              </Pressable>
            )
          }}
        />
      </View>
    </Modal>
  )
}

interface ProjectSheetProps {
  visible: boolean
  /** Null while the host is asked. */
  projects: readonly ProjectChoice[] | null
  active: string | null
  onPick: (project: ProjectChoice | null) => void
  onClose: () => void
}

/** The folders of the host that conversations ran in. One project shows its conversations; a new chat then works in its folder. */
export function ProjectSheet({ visible, projects, active, onPick, onClose }: ProjectSheetProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const rows: (ProjectChoice | null)[] = [null, ...(projects ?? [])]

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Projects</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <FlatList
          ListFooterComponent={projects ? null : <ActivityIndicator color={t.muted} style={styles.wait} />}
          data={rows}
          keyExtractor={project => project?.id ?? 'all'}
          renderItem={({ item }) => {
            const on = (item?.id ?? null) === active
            const line = item ? [folderLine(item.path), `${item.count} ${item.count === 1 ? 'chat' : 'chats'}`].filter(Boolean).join('  ·  ') : ''

            return (
              <Pressable
                accessibilityLabel={`Project: ${item?.label ?? 'All projects'}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => (onPick(item), onClose())}
                style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
              >
                <View style={[styles.badge, { backgroundColor: on ? t.accentBg : t.soft }]}>
                  <Feather color={on ? t.accent : t.muted} name={!item ? 'grid' : item.home ? 'home' : 'folder'} size={18} />
                </View>
                <View style={styles.fill}>
                  <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                    {item?.label ?? 'All projects'}
                  </Text>
                  {line ? (
                    <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                      {line}
                    </Text>
                  ) : null}
                </View>
                {on ? <Feather color={t.accent} name="check" size={18} /> : null}
              </Pressable>
            )
          }}
        />
      </View>
    </Modal>
  )
}

interface ProfileSheetProps {
  visible: boolean
  bots: readonly Bot[]
  /** The profile that is shown now. Null shows all. */
  active: string | null
  onPick: (profile: string | null) => void
  onClose: () => void
}

/** Whose conversations the list shows: every profile, or one bot. A new chat then starts with that bot. */
export function ProfileSheet({ visible, bots, active, onPick, onClose }: ProfileSheetProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const avatars = useStore($botAvatars)
  const rows: (Bot | null)[] = [null, ...bots]

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={visible}>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Profiles</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <FlatList
          data={rows}
          keyExtractor={bot => bot?.name ?? 'all'}
          renderItem={({ item }) => {
            const on = (item?.name ?? null) === active
            const picture = item ? avatars[item.name] : undefined

            return (
              <Pressable
                accessibilityLabel={`Profile: ${item?.title ?? 'All profiles'}`}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => (onPick(item?.name ?? null), onClose())}
                style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
              >
                {picture ? (
                  <Image source={{ uri: picture }} style={styles.badge} />
                ) : (
                  <View style={[styles.badge, { backgroundColor: on ? t.accentBg : t.soft }]}>
                    {item ? (
                      <Text style={[type.small, { color: on ? t.accent : t.muted, fontWeight: '700' }]}>{botInitials(item.title)}</Text>
                    ) : (
                      <Feather color={on ? t.accent : t.muted} name="users" size={18} />
                    )}
                  </View>
                )}
                <View style={styles.fill}>
                  <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                    {item?.title ?? 'All profiles'}
                  </Text>
                  {item?.description ? (
                    <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                      {item.description}
                    </Text>
                  ) : null}
                </View>
                {on ? <Feather color={t.accent} name="check" size={18} /> : null}
              </Pressable>
            )
          }}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wait: { padding: space.xl },
  shrink: { flexShrink: 1 },
  dim: { opacity: 0.6 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth
  },
  head: { flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH + space.md,
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  badge: { width: 36, height: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }
})
