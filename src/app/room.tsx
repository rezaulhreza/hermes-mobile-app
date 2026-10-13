import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo } from 'react'
import { FlatList, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar } from '@/components/bot-sheet'
import { Markdown } from '@/components/markdown'
import { IconButton, Notice } from '@/components/ui'
import { type Bot, botsByAnyName, type RoomMessage } from '@/core/bots'
import { relativeTime } from '@/core/format'
import { $bots, $rooms, loadBots } from '@/store/bots'
import { $linkState } from '@/store/link'
import { radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/**
 * A group chat of bots: who is in it and what was said last. The desktop app
 * runs a group chat (it gives each message to the members and collects their
 * answers) and keeps a copy of the newest messages on the host. The phone
 * reads that copy.
 */
export default function RoomScreen() {
  const t = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const room = useStore($rooms).find(known => known.id === id)
  const bots = useStore($bots)
  const linkState = useStore($linkState)
  const byName = useMemo(() => botsByAnyName(bots ?? []), [bots])
  // The list is upside down: it opens at the newest message with only the rows on screen drawn.
  const newestFirst = useMemo(() => [...(room?.messages ?? [])].reverse(), [room?.messages])

  useEffect(() => {
    if (linkState === 'open') {
      void loadBots().catch(() => undefined)
    }
  }, [linkState])

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.heading, { color: t.ink }]}>
            {room?.name ?? 'Group chat'}
          </Text>
          {room ? (
            <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
              {room.members.map(name => byName.get(name)?.title ?? name).join(', ')}
            </Text>
          ) : null}
        </View>
      </View>

      {!room ? (
        <Notice detail="It may be closed on the desktop app." icon="users" title="This group chat is not on the host" />
      ) : (
        <FlatList
          ListEmptyComponent={<Notice icon="message-circle" title="Nothing was said here yet" />}
          ListFooterComponent={
            room.omitted ? <Text style={[type.small, styles.note, { color: t.muted }]}>{room.omitted} earlier messages are in the desktop app.</Text> : null
          }
          ListHeaderComponent={
            <View style={[styles.foot, { backgroundColor: t.soft }]}>
              <Feather color={t.muted} name="monitor" size={16} />
              <Text style={[type.small, styles.fill, { color: t.muted }]}>
                The desktop app runs this group chat. To say something to the group, write there. To talk to one bot, open it on the Bots tab.
              </Text>
            </View>
          }
          contentContainerStyle={styles.list}
          data={newestFirst}
          initialNumToRender={10}
          inverted={newestFirst.length > 0}
          keyExtractor={message => message.id}
          renderItem={({ item }) => <Message bot={byName.get(item.from)} message={item} />}
          windowSize={7}
        />
      )}
    </SafeAreaView>
  )
}

function Message({ message, bot }: { message: RoomMessage; bot?: Bot }) {
  const t = useTheme()

  if (message.mine) {
    return (
      <View style={[styles.mine, { backgroundColor: t.soft }]}>
        <Text style={[type.body, { color: t.ink }]}>{message.text}</Text>
      </View>
    )
  }

  return (
    <View style={styles.theirs}>
      {bot ? <BotAvatar bot={bot} size={30} t={t} /> : <View style={[styles.unknown, { backgroundColor: t.soft }]} />}
      <View style={styles.fill}>
        <Text style={[type.small, { color: t.muted }]}>
          <Text style={{ color: t.ink, fontWeight: '700' }}>{bot?.title ?? message.from}</Text>
          {message.at ? `  ${relativeTime(message.at / 1000)}` : ''}
        </Text>
        <Markdown text={message.text} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  list: { padding: space.lg, gap: space.lg, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' },
  note: { textAlign: 'center', paddingVertical: space.md },
  foot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
  mine: { alignSelf: 'flex-end', maxWidth: '88%', padding: space.md, borderRadius: radius.lg },
  theirs: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  unknown: { width: 30, height: 30, borderRadius: 15 }
})
