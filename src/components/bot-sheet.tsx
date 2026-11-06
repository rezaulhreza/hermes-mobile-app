import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { defaultLook } from '@/core/avatars'
import { type Bot, botInitials, type BotSection, botSlug, knownSections, newSectionId } from '@/core/bots'
import { type Capability, capabilityCount } from '@/core/capabilities'
import { faultWords } from '@/core/format'
import { APPROVAL_MODES, type ApprovalMode, approvalModeLabel } from '@/core/approvals'
import { isReasoningLevel, modelLabel, REASONING_LABEL, REASONING_LEVELS, reasoningLabel } from '@/core/models'
import { providerRows } from '@/core/providers'
import { $botAvatars, $bots, $defaultBot, $filing, chooseBotPicture, setBotLook, deleteBot, describeBot, fileBot, loadBotApprovals, loadBotReasoning, loadBotSoul, setBotApprovals, renameBot, saveBotSoul, setBotModel, setBotReasoning, setBotSection, setDefaultBot } from '@/store/bots'
import { readSkills } from '@/store/capabilities'
import { $providers, loadProviders } from '@/store/providers'
import { type Palette, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { AvatarSheet } from './avatar-sheet'
import { BotFace } from './bot-face'
import { ChoiceSheet } from './choice'
import { Button, Field, IconButton } from './ui'

const say = (error: unknown) => Alert.alert('That did not work', faultWords(error))

export function BotAvatar({ bot, size, t }: { bot: Bot; size: number; t: Palette }) {
  const picture = useStore($botAvatars)[bot.name]
  const shape = { width: size, height: size, borderRadius: size / 2 }

  return picture ? (
    <Image accessibilityIgnoresInvertColors source={{ uri: picture }} style={shape} />
  ) : bot.look ? (
    // No photo: the drawn avatar of the bot, the same one the desktop app draws.
    <BotFace look={bot.look} size={size} />
  ) : (
    <View style={[shape, styles.initials, { backgroundColor: bot.isDefault ? t.accentBg : t.soft }]}>
      {/* In a small circle the letters are small too. */}
      <Text style={[type.label, size < 30 && { fontSize: size * 0.45 }, { color: bot.isDefault ? t.accent : t.muted }]}>{botInitials(bot.title)}</Text>
    </View>
  )
}

export function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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
        <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </View>
    </Modal>
  )
}

/** What a bot is: its picture, its model, its role, its own instructions, its name. Each part saves by itself. */
export function BotSheet({ bot, onClose, onTalk }: { bot: Bot; onClose: () => void; /** Absent inside the chat of the bot: the user is there already. */ onTalk?: () => void }) {
  const t = useTheme()
  const [description, setDescription] = useState(bot.description)
  const [soul, setSoul] = useState<string | null>(null)
  const [savedSoul, setSavedSoul] = useState('')
  const [name, setName] = useState(bot.name)
  const [busy, setBusy] = useState<string | null>(null)
  const [choosingModel, setChoosingModel] = useState(false)
  // Null until the host said it: the list of bots does not carry the level.
  const [reasoning, setReasoning] = useState<string | null>(null)
  const [choosingReasoning, setChoosingReasoning] = useState(false)
  const [approvals, setApprovals] = useState<ApprovalMode | null>(null)
  const [choosingApprovals, setChoosingApprovals] = useState(false)
  const [filing, setFiling] = useState(false)
  // The host counts the skills a bot has, not the skills that are on: the row reads the list for that.
  const [skills, setSkills] = useState<Capability[]>()
  const sections = knownSections(useStore($bots) ?? [], useStore($filing).sections)
  const isStart = useStore($defaultBot) === bot.name

  useEffect(() => {
    readSkills(bot.name).then(setSkills, () => undefined)
  }, [bot.name])

  useEffect(() => {
    loadBotReasoning(bot.name).then(setReasoning, () => undefined)
    loadBotApprovals(bot.name).then(setApprovals, () => undefined)
  }, [bot.name])

  useEffect(() => {
    loadBotSoul(bot.name).then(
      text => {
        setSoul(text)
        setSavedSoul(text)
      },
      () => setSoul('')
    )
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
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => run('delete', () => deleteBot(bot.name).then(onClose))
      }
    ])

  // The choice of an avatar, open over this sheet.
  const [avatar, setAvatar] = useState(false)
  const picture = useStore($botAvatars)[bot.name]

  return (
    <SheetFrame onClose={onClose} title={bot.title}>
      <View style={styles.who}>
        <Pressable accessibilityHint="Opens the choice of an avatar or a photo" accessibilityLabel={`Avatar of ${bot.title}`} accessibilityRole="button" onPress={() => setAvatar(true)}>
          <BotAvatar bot={bot} size={64} t={t} />
          <View style={[styles.camera, { backgroundColor: t.ink }]}>
            {busy === 'picture' ? <ActivityIndicator color={t.bg} size="small" /> : <Feather color={t.bg} name="edit-2" size={12} />}
          </View>
        </Pressable>
        <View style={styles.fill}>
          <Text style={[type.small, { color: t.muted }]}>
            {[bot.isDefault ? 'The main bot' : bot.name, bot.model ? modelLabel(bot.model) : '', `${bot.skillCount} skills`].filter(Boolean).join(' · ')}
          </Text>
          {onTalk ? (
            <Pressable
              accessibilityLabel="Talk to this bot"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                onClose()
                onTalk()
              }}
              style={({ pressed }) => [styles.talk, { backgroundColor: t.ink }, pressed && styles.pressed]}
            >
              <Feather color={t.bg} name="message-circle" size={14} />
              <Text style={[type.small, styles.talkLabel, { color: t.bg }]}>Talk</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <Pressable
        accessibilityHint="Opens the list of models"
        accessibilityLabel={`Model: ${bot.model ? modelLabel(bot.model) : 'The model of the host'}`}
        accessibilityRole="button"
        onPress={() => setChoosingModel(true)}
        style={({ pressed }) => [styles.setting, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
      >
        <Feather color={t.muted} name="cpu" size={20} />
        <View style={styles.fill}>
          <Text style={[type.small, { color: t.muted }]}>Model</Text>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {bot.model ? modelLabel(bot.model) : 'The model of the host'}
          </Text>
        </View>
        {busy === 'model' ? <ActivityIndicator color={t.muted} /> : <Feather color={t.muted} name="chevron-right" size={18} />}
      </Pressable>
      {choosingModel ? (
        <BotModelSheet
          current={bot.model}
          onClose={() => setChoosingModel(false)}
          onPick={(provider, model) => {
            setChoosingModel(false)
            run('model', () => setBotModel(bot.name, provider, model))
          }}
        />
      ) : null}

      <Pressable
        accessibilityHint="Opens the list of levels"
        accessibilityLabel={`Reasoning: ${reasoning === null ? 'not read yet' : reasoningLabel(reasoning)}`}
        accessibilityRole="button"
        disabled={reasoning === null}
        onPress={() => setChoosingReasoning(true)}
        style={({ pressed }) => [styles.setting, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
      >
        <Feather color={t.muted} name="zap" size={20} />
        <View style={styles.fill}>
          <Text style={[type.small, { color: t.muted }]}>Reasoning</Text>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {reasoning === null ? ' ' : reasoningLabel(reasoning)}
          </Text>
        </View>
        {busy === 'reasoning' || reasoning === null ? <ActivityIndicator color={t.muted} /> : <Feather color={t.muted} name="chevron-right" size={18} />}
      </Pressable>
      {choosingReasoning ? (
        <ChoiceSheet
          choices={REASONING_LEVELS.map(level => ({ id: level, label: REASONING_LABEL[level] }))}
          current={reasoning}
          footer={<Text style={[type.small, { color: t.muted }]}>How hard this bot thinks before it answers. A higher level is slower and costs more. A chat that is open keeps its level until its next start.</Text>}
          onClose={() => setChoosingReasoning(false)}
          onPick={level => {
            setChoosingReasoning(false)

            if (isReasoningLevel(level)) {
              run('reasoning', () => setBotReasoning(bot.name, level).then(() => setReasoning(level)))
            }
          }}
          title="Reasoning of this bot"
        />
      ) : null}

      <Pressable
        accessibilityHint="Opens the ways this bot asks before a command"
        accessibilityLabel={`Approvals: ${approvals === null ? 'not read yet' : approvalModeLabel(approvals)}`}
        accessibilityRole="button"
        disabled={approvals === null}
        onPress={() => setChoosingApprovals(true)}
        style={({ pressed }) => [styles.setting, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
      >
        <Feather color={t.muted} name="shield" size={20} />
        <View style={styles.fill}>
          <Text style={[type.small, { color: t.muted }]}>Before a dangerous command</Text>
          <Text numberOfLines={1} style={[type.label, { color: approvals === 'off' ? t.red : t.ink }]}>
            {approvals === null ? ' ' : approvalModeLabel(approvals)}
          </Text>
        </View>
        {busy === 'approvals' || approvals === null ? <ActivityIndicator color={t.muted} /> : <Feather color={t.muted} name="chevron-right" size={18} />}
      </Pressable>
      {choosingApprovals ? (
        <ChoiceSheet
          choices={APPROVAL_MODES.map(mode => ({ id: mode.id, label: mode.label, detail: mode.detail }))}
          current={approvals}
          footer={<Text style={[type.small, { color: t.muted }]}>A change applies to the chats of this bot from their next command.</Text>}
          onClose={() => setChoosingApprovals(false)}
          onPick={mode => {
            setChoosingApprovals(false)
            run('approvals', () => setBotApprovals(bot.name, mode as ApprovalMode).then(() => setApprovals(mode as ApprovalMode)))
          }}
          title="Before a dangerous command"
        />
      ) : null}

      <Pressable
        accessibilityHint="Opens the list of sections"
        accessibilityLabel={`Section: ${bot.section?.name ?? 'Unassigned'}`}
        accessibilityRole="button"
        onPress={() => setFiling(true)}
        style={({ pressed }) => [styles.setting, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
      >
        <Feather color={t.muted} name="folder" size={20} />
        <View style={styles.fill}>
          <Text style={[type.small, { color: t.muted }]}>Section of the Bots list</Text>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {bot.section?.name ?? 'Unassigned'}
          </Text>
        </View>
        {busy === 'section' ? <ActivityIndicator color={t.muted} /> : <Feather color={t.muted} name="chevron-right" size={18} />}
      </Pressable>
      {filing ? (
        <SectionSheet
          current={bot.section?.id ?? null}
          onClose={() => setFiling(false)}
          onPick={section => {
            setFiling(false)
            run('section', () => setBotSection(bot.name, section))
          }}
          sections={sections}
        />
      ) : null}
      <Pressable
        accessibilityHint="Opens the skills, tools, MCP servers and plugins of this bot"
        accessibilityLabel="Skills and tools"
        accessibilityRole="button"
        onPress={() => {
          onClose()
          router.push({ pathname: '/capabilities', params: { profile: bot.name } })
        }}
        style={({ pressed }) => [styles.setting, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
      >
        <Feather color={t.muted} name="tool" size={20} />
        <View style={styles.fill}>
          <Text style={[type.small, { color: t.muted }]}>Skills and tools</Text>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {capabilityCount(skills) || `${bot.skillCount} skills`}
          </Text>
        </View>
        <Feather color={t.muted} name="chevron-right" size={18} />
      </Pressable>
      <View style={styles.filing}>
        <Button
          busy={busy === 'pin'}
          icon="bookmark"
          label={bot.pinned ? 'Unpin' : 'Pin to the top'}
          onPress={() => run('pin', () => fileBot(bot.name, bot.pinned ? { pinned: false } : { pinned: true, hidden: false }))}
          style={styles.fill}
        />
        <Button
          busy={busy === 'hide'}
          icon={bot.hidden ? 'corner-up-left' : 'archive'}
          label={bot.hidden ? 'Bring back' : 'Put away'}
          onPress={() => run('hide', () => fileBot(bot.name, bot.hidden ? { hidden: false } : { hidden: true, pinned: false }))}
          style={styles.fill}
        />
      </View>

      <Field label="Role" multiline onChangeText={setDescription} placeholder="What this bot is for, in a sentence" style={styles.role} value={description} />
      <Button
        busy={busy === 'role'}
        disabled={description.trim() === bot.description}
        label="Save the role"
        onPress={() => run('role', () => describeBot(bot.name, description))}
      />

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

      {isStart ? (
        <Text style={[type.small, { color: t.muted }]}>This is the default bot. A new chat starts with it, and so does Hermes on the host when no bot is named.</Text>
      ) : (
        <>
          <Button busy={busy === 'default'} icon="star" label="Make this the default bot" onPress={() => run('default', () => setDefaultBot(bot.name))} />
          <Text style={[type.small, { color: t.muted }]}>A new chat starts with the default bot, and so does Hermes on the host when no bot is named.</Text>
        </>
      )}

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
      {avatar ? (
        <AvatarSheet
          busy={busy === 'picture'}
          onClose={() => setAvatar(false)}
          onPhoto={() => run('picture', () => chooseBotPicture(bot.name).then(() => setAvatar(false)))}
          onUse={look => run('picture', () => setBotLook(bot.name, look).then(() => setAvatar(false)))}
          photo={picture || null}
          start={bot.look ?? defaultLook(bot.name)}
        />
      ) : null}
    </SheetFrame>
  )
}

/** The sections the user made on the Bots list, to file one bot or one group chat. A new name makes a new section. */
export function SectionSheet({ sections, current, onPick, onClose }: { sections: readonly BotSection[]; current: string | null; onPick: (section: BotSection | null) => void; onClose: () => void }) {
  const t = useTheme()
  const [name, setName] = useState('')
  const typed = name.trim()
  const rows: (BotSection | null)[] = [null, ...sections]

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.sheetHead, { borderBottomColor: t.line }]}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Section</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <FlatList
          automaticallyAdjustKeyboardInsets
          ListFooterComponent={
            <View style={styles.newSection}>
              <Field label="A new section" onChangeText={setName} placeholder="Clients" value={name} />
              <Button
                disabled={!typed || sections.some(section => section.name.toLowerCase() === typed.toLowerCase())}
                icon="plus"
                label={typed ? `File under “${typed}”` : 'File under a new section'}
                onPress={() => onPick({ id: newSectionId(), name: typed })}
              />
            </View>
          }
          data={rows}
          keyExtractor={section => section?.id ?? 'none'}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`Section: ${item?.name ?? 'Unassigned'}`}
              accessibilityRole="button"
              accessibilityState={{ selected: (item?.id ?? null) === current }}
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.modelRow, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
            >
              <Feather color={t.muted} name={item ? 'folder' : 'minus'} size={18} />
              <Text style={[type.label, styles.fill, { color: t.ink }]}>{item?.name ?? 'Unassigned'}</Text>
              {(item?.id ?? null) === current ? <Feather color={t.accent} name="check" size={18} /> : null}
            </Pressable>
          )}
        />
      </View>
    </Modal>
  )
}

/** The models of the providers that are connected on the host, to choose the model of one bot. */
export function BotModelSheet({
  current,
  onPick,
  onClose,
  title = 'Model of this bot',
  auto
}: {
  current: string
  onPick: (provider: string, model: string) => void
  onClose: () => void
  title?: string
  /** The words of a first row that gives the choice back to the host. Absent: no such row. */
  auto?: string
}) {
  const t = useTheme()
  const options = useStore($providers)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void loadProviders().catch(() => undefined)
  }, [])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return (options ? providerRows(options) : [])
      .filter(provider => provider.connected)
      .flatMap(provider =>
        provider.models.map(model => ({
          provider: provider.slug,
          providerName: provider.name,
          model
        }))
      )
      .filter(row => !needle || `${row.model} ${row.providerName}`.toLowerCase().includes(needle))
  }, [options, query])

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.sheetHead, { borderBottomColor: t.line }]}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>{title}</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <TextInput
          accessibilityLabel="Search models"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search models"
          placeholderTextColor={t.muted}
          style={[styles.search, type.body, { color: t.ink, backgroundColor: t.soft }]}
          value={query}
        />
        <FlatList
          automaticallyAdjustKeyboardInsets
          ListHeaderComponent={
            auto && !query.trim() ? (
              <Pressable
                accessibilityLabel={`Model: ${auto}`}
                accessibilityRole="button"
                onPress={() => onPick('auto', '')}
                style={({ pressed }) => [styles.modelRow, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
              >
                <Text style={[type.label, styles.fill, { color: t.ink }]}>{auto}</Text>
                {current ? null : <Feather color={t.accent} name="check" size={18} />}
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            options ? (
              <Text style={[type.body, styles.empty, { color: t.muted }]}>No model of a connected provider matches.</Text>
            ) : (
              <ActivityIndicator color={t.muted} style={styles.empty} />
            )
          }
          data={rows}
          initialNumToRender={16}
          keyExtractor={row => `${row.provider}:${row.model}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`Model: ${modelLabel(item.model)}, ${item.providerName}`}
              accessibilityRole="button"
              accessibilityState={{ selected: item.model === current }}
              onPress={() => onPick(item.provider, item.model)}
              style={({ pressed }) => [styles.modelRow, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
            >
              <View style={styles.fill}>
                <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                  {modelLabel(item.model)}
                </Text>
                <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                  {item.providerName}
                </Text>
              </View>
              {item.model === current ? <Feather color={t.accent} name="check" size={18} /> : null}
            </Pressable>
          )}
          windowSize={7}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  initials: { alignItems: 'center', justifyContent: 'center' },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    paddingLeft: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  sheet: { padding: space.lg, gap: space.md },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  talk: { marginTop: space.sm, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 30, paddingHorizontal: space.md, borderRadius: radius.pill },
  talkLabel: { fontWeight: '600' },
  pressed: { opacity: 0.6 },
  camera: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  setting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH + 12,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth
  },
  role: { minHeight: 72, textAlignVertical: 'top', paddingTop: space.md },
  soul: {
    minHeight: 180,
    maxHeight: 320,
    textAlignVertical: 'top',
    paddingTop: space.md
  },
  search: {
    minHeight: TOUCH,
    margin: space.lg,
    marginBottom: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md
  },
  empty: { padding: space.xl, textAlign: 'center' },
  filing: { flexDirection: 'row', gap: space.md },
  newSection: { padding: space.lg, gap: space.md },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: TOUCH + 12,
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth
  }
})
