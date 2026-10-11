import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, Field, IconButton, Notice } from '@/components/ui'
import { type Bot, botInitials, botNameProblem, botSlug, filterBots } from '@/core/bots'
import { relativeTime } from '@/core/format'
import { modelLabel } from '@/core/models'
import { $botAvatars, $bots, createBot, deleteBot, describeBot, loadBots, loadBotSoul, renameBot, saveBotSoul } from '@/store/bots'
import { createConversation } from '@/store/chat'
import { $linkState } from '@/store/link'
import { type Palette, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { TAB_BAR_CLEARANCE } from './_layout'

const say = (error: unknown) => Alert.alert('That did not work', error instanceof Error ? error.message : String(error))

/**
 * The bots of this Hermes: each one an agent with its own role. A tap opens
 * the one long conversation with that bot. A long press opens what it is.
 */
export default function Bots() {
  const t = useTheme()
  const bots = useStore($bots)
  const linkState = useStore($linkState)
  const [query, setQuery] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const shown = useMemo(() => filterBots(bots ?? [], query), [bots, query])
  const open = bots?.find(bot => bot.name === detail)

  const load = () => loadBots().then(() => setFailure(null), error => setFailure(error instanceof Error ? error.message : String(error)))

  useEffect(() => {
    if (linkState === 'open') {
      void load()
    }
  }, [linkState])

  const talk = async (bot: Bot) => {
    setOpening(bot.name)

    try {
      if (bot.chatId) {
        router.push({ pathname: '/chat/[id]', params: { id: bot.chatId, title: bot.title, profile: bot.name } })
      } else {
        // Nobody has talked to this bot yet: its conversation starts now.
        const { storedId } = await createConversation(bot.name)

        router.push({ pathname: '/chat/[id]', params: { id: storedId, live: '1', profile: bot.name } })
      }
    } catch (error) {
      say(error)
    } finally {
      setOpening(null)
    }
  }

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={styles.top}>
        <Text style={[type.title, styles.fill, { color: t.ink }]}>Bots</Text>
        <IconButton icon="clock" label="Schedules" onPress={() => router.push('/cron')} />
        <IconButton disabled={!bots} filled icon="plus" label="Add a bot" onPress={() => setAdding(true)} />
      </View>

      {!bots ? (
        failure ? (
          <Notice action={<Button label="Try again" onPress={() => void load()} />} detail={failure} icon="alert-triangle" title="Could not read the bots" />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        )
      ) : (
        <FlatList
          contentContainerStyle={styles.content}
          data={shown}
          keyboardShouldPersistTaps="handled"
          keyExtractor={bot => bot.name}
          ListHeaderComponent={
            bots.length > 6 ? (
              <TextInput
                accessibilityLabel="Find a bot"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Find a bot: a name or a role"
                placeholderTextColor={t.muted}
                style={[type.body, styles.search, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
                value={query}
              />
            ) : null
          }
          refreshControl={
            <RefreshControl
              onRefresh={() => {
                setRefreshing(true)
                void load().finally(() => setRefreshing(false))
              }}
              refreshing={refreshing}
              tintColor={t.muted}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityHint="Opens the conversation with this bot. Hold for its details."
              accessibilityLabel={item.title}
              accessibilityRole="button"
              onLongPress={() => setDetail(item.name)}
              onPress={() => void talk(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
            >
              <Avatar bot={item} size={46} t={t} />
              <View style={styles.fill}>
                <View style={styles.nameRow}>
                  <Text numberOfLines={1} style={[type.label, styles.shrink, { color: t.ink }]}>
                    {item.title}
                  </Text>
                  {item.working ? <Text style={[type.small, styles.badge, { color: t.accent, backgroundColor: t.accentBg }]}>Working</Text> : null}
                  <View style={styles.fill} />
                  {item.lastActive ? <Text style={[type.small, { color: t.muted }]}>{relativeTime(item.lastActive)}</Text> : null}
                </View>
                <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
                  {item.preview || item.description || 'No role written yet.'}
                </Text>
              </View>
              {opening === item.name ? <ActivityIndicator color={t.muted} /> : null}
            </Pressable>
          )}
        />
      )}

      {open ? <BotSheet bot={open} onClose={() => setDetail(null)} onTalk={() => void talk(open)} /> : null}
      {adding && bots ? <NewBotSheet bots={bots} onClose={() => setAdding(false)} /> : null}
    </SafeAreaView>
  )
}

function Avatar({ bot, size, t }: { bot: Bot; size: number; t: Palette }) {
  const picture = useStore($botAvatars)[bot.name]
  const shape = { width: size, height: size, borderRadius: size / 2 }

  return picture ? (
    <Image accessibilityIgnoresInvertColors source={{ uri: picture }} style={shape} />
  ) : (
    <View style={[shape, styles.initials, { backgroundColor: bot.isDefault ? t.accentBg : t.soft }]}>
      <Text style={[type.label, { color: bot.isDefault ? t.accent : t.muted }]}>{botInitials(bot.title)}</Text>
    </View>
  )
}

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.sheetHead, { borderBottomColor: t.line }]}>
          <Text numberOfLines={1} style={[type.heading, styles.fill, { color: t.ink }]}>
            {title}
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

/** What a bot is: its role, its own instructions, its name. Each part saves by itself. */
function BotSheet({ bot, onClose, onTalk }: { bot: Bot; onClose: () => void; onTalk: () => void }) {
  const t = useTheme()
  const [description, setDescription] = useState(bot.description)
  const [soul, setSoul] = useState<string | null>(null)
  const [savedSoul, setSavedSoul] = useState('')
  const [name, setName] = useState(bot.name)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    loadBotSoul(bot.name).then(text => {
      setSoul(text)
      setSavedSoul(text)
    }, () => setSoul(''))
  }, [bot.name])

  const run = (what: string, work: () => Promise<unknown>) => {
    setBusy(what)
    work()
      .catch(say)
      .finally(() => setBusy(null))
  }

  const remove = () =>
    Alert.alert(`Delete ${bot.title}?`, 'Hermes deletes this bot with its conversations, its memory and its skills. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => run('delete', () => deleteBot(bot.name).then(onClose)) }
    ])

  return (
    <SheetFrame onClose={onClose} title={bot.title}>
      <View style={styles.who}>
        <Avatar bot={bot} size={64} t={t} />
        <View style={styles.fill}>
          <Text style={[type.small, { color: t.muted }]}>
            {[bot.isDefault ? 'The main bot' : bot.name, bot.model ? modelLabel(bot.model) : '', `${bot.skillCount} skills`].filter(Boolean).join(' · ')}
          </Text>
          <Button
            icon="message-circle"
            label="Talk to this bot"
            onPress={() => {
              onClose()
              onTalk()
            }}
            style={styles.talk}
            tone="primary"
          />
        </View>
      </View>

      <Field label="Role" multiline onChangeText={setDescription} placeholder="What this bot is for, in a sentence" style={styles.role} value={description} />
      <Button busy={busy === 'role'} disabled={description.trim() === bot.description} label="Save the role" onPress={() => run('role', () => describeBot(bot.name, description))} />

      <Field
        editable={soul !== null}
        label="Its own instructions (SOUL.md)"
        multiline
        onChangeText={setSoul}
        placeholder={soul === null ? 'Reading…' : 'How this bot thinks and talks'}
        style={styles.soul}
        value={soul ?? ''}
      />
      <Button
        busy={busy === 'soul'}
        disabled={soul === null || soul === savedSoul}
        label="Save the instructions"
        onPress={() => run('soul', () => saveBotSoul(bot.name, soul ?? '').then(() => setSavedSoul(soul ?? '')))}
      />

      {bot.isDefault ? null : (
        <>
          <Field label="Name on the host" onChangeText={setName} value={name} />
          <Button
            busy={busy === 'name'}
            disabled={botSlug(name) === bot.name || !botSlug(name)}
            label={`Rename to ${botSlug(name) || '…'}`}
            onPress={() => run('name', () => renameBot(bot.name, name).then(onClose))}
          />
          <Button busy={busy === 'delete'} icon="trash-2" label="Delete this bot" onPress={remove} tone="danger" />
        </>
      )}
    </SheetFrame>
  )
}

function NewBotSheet({ bots, onClose }: { bots: readonly Bot[]; onClose: () => void }) {
  const t = useTheme()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [like, setLike] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const problem = name ? botNameProblem(name, bots.map(bot => bot.name)) : null

  const add = () => {
    setBusy(true)
    createBot(name, description, like)
      .then(onClose, say)
      .finally(() => setBusy(false))
  }

  return (
    <SheetFrame onClose={onClose} title="Add a bot">
      <Text style={[type.small, { color: t.muted }]}>A bot is an agent of its own on your Hermes host, with its own role, memory and skills.</Text>
      <Field autoCapitalize="words" error={problem} label="Name" onChangeText={setName} placeholder="Researcher" value={name} />
      <Field label="Role" multiline onChangeText={setDescription} placeholder="What this bot is for, in a sentence" style={styles.role} value={description} />

      <Text style={[type.small, { color: t.muted, fontWeight: '600' }]}>Start as a copy of</Text>
      <View style={styles.chips}>
        {[null, ...bots.map(bot => bot.name)].map(choice => {
          const checked = choice === like

          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              key={choice ?? '-'}
              onPress={() => setLike(choice)}
              style={[styles.chip, { backgroundColor: checked ? t.ink : t.paper, borderColor: checked ? t.ink : t.line }]}
            >
              <Text style={[type.small, { color: checked ? t.bg : t.ink }]}>{choice ?? 'Nothing: a new bot'}</Text>
            </Pressable>
          )
        })}
      </View>

      <Button busy={busy} disabled={!name.trim() || Boolean(problem)} icon="plus" label="Add the bot" onPress={add} tone="primary" />
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },
  content: { padding: space.lg, gap: space.sm, paddingBottom: TAB_BAR_CLEARANCE, maxWidth: 760, width: '100%', alignSelf: 'center' },
  search: { minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge: { paddingHorizontal: space.sm, borderRadius: radius.sm, overflow: 'hidden', fontWeight: '700' },
  initials: { alignItems: 'center', justifyContent: 'center' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  sheet: { padding: space.lg, gap: space.md },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  talk: { marginTop: space.sm },
  role: { minHeight: 72, textAlignVertical: 'top', paddingTop: space.md },
  soul: { minHeight: 180, maxHeight: 320, textAlignVertical: 'top', paddingTop: space.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.md, minHeight: 36, justifyContent: 'center', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth }
})
