import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { memo, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar } from '@/components/bot-sheet'
import { ChoiceRow, ChoiceSheet } from '@/components/choice'
import { IconButton, Notice } from '@/components/ui'
import { CAPABILITY_KINDS, type Capability, capabilityCount, type CapabilityKind, shownCapabilities } from '@/core/capabilities'
import { faultWords } from '@/core/format'
import { $bots } from '@/store/bots'
import { $capabilities, $capabilityProfile, clearCapabilities, loadCapabilities, setCapability, setSkillGuarded, showCapabilitiesOf } from '@/store/capabilities'
import { $linkState } from '@/store/link'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { usePull } from '@/theme/use-pull'
import { useTheme } from '@/theme/use-theme'

/**
 * What one bot can do. Hermes keeps skills, tools, MCP servers and plugins
 * for each bot by itself, so the screen starts from the bot: a row that opens
 * the list of bots, a row that opens the kinds, and the list of that kind
 * with a switch on each line.
 */
export default function Capabilities() {
  const t = useTheme()
  const params = useLocalSearchParams<{ profile?: string }>()
  const linkState = useStore($linkState)
  const bots = useStore($bots)
  const profile = useStore($capabilityProfile)
  const all = useStore($capabilities)
  const [kind, setKind] = useState<CapabilityKind>('skills')
  const [choosing, setChoosing] = useState<'bot' | 'kind' | null>(null)
  const [query, setQuery] = useState('')
  const [fault, setFault] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const bot = bots?.find(known => known.name === profile)
  const items = all[kind]
  const shown = useMemo(() => shownCapabilities(items ?? [], query), [items, query])
  const pull = usePull(() => loadCapabilities(kind))

  // The bot of the link that opened the screen, else the main bot.
  useEffect(() => {
    if (!profile && bots?.length) {
      showCapabilitiesOf(bots.find(known => known.name === params.profile)?.name ?? bots.find(known => known.isDefault)?.name ?? bots[0].name)
    }
  }, [profile, bots, params.profile])

  useEffect(() => {
    if (linkState === 'open' && profile && !$capabilities.get()[kind]) {
      loadCapabilities(kind).catch(error => setFault(faultWords(error)))
    }
  }, [linkState, profile, kind])

  // The lists leave the memory of the phone with the screen.
  useEffect(() => clearCapabilities, [])

  const flip = (item: Capability, on: boolean) => {
    setFault(null)
    setNote(null)
    setCapability(kind, item.id, on).then(
      restart => restart && setNote(`${item.title} changes when Hermes starts again.`),
      error => setFault(`${item.title}: ${faultWords(error)}`)
    )
  }

  const guard = (item: Capability, guarded: boolean) => {
    setFault(null)
    setNote(null)
    setSkillGuarded(item.id, guarded).then(
      () => setNote(guarded ? `${item.title} is locked. The agent cannot change it. You still can.` : `${item.title} is unlocked. The agent can improve it again.`),
      error => setFault(`${item.title}: ${faultWords(error)}`)
    )
  }

  const named = CAPABILITY_KINDS.find(known => known.kind === kind) ?? CAPABILITY_KINDS[0]

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Skills and tools</Text>
      </View>

      <FlatList
        automaticallyAdjustKeyboardInsets
        ListEmptyComponent={
          !items ? (
            fault ? (
              <Notice detail={fault} icon="alert-triangle" title="Could not read the list" />
            ) : (
              <ActivityIndicator color={t.muted} style={styles.wait} />
            )
          ) : (
            <Notice icon={named.icon} title={query.trim() ? 'Nothing matches' : kind === 'mcp' ? 'This bot has no MCP server' : 'Nothing here'} />
          )
        }
        ListHeaderComponent={
          <View style={styles.top}>
            <ChoiceRow icon="user" label="Bot" lead={bot ? <BotAvatar bot={bot} size={28} t={t} /> : undefined} onPress={() => setChoosing('bot')} value={bot?.title ?? 'Choose a bot'} />
            <ChoiceRow icon={named.icon} label="Show" onPress={() => setChoosing('kind')} value={[named.label, capabilityCount(items)].filter(Boolean).join(' · ')} />
            {(items?.length ?? 0) > 8 ? (
              <TextInput
                accessibilityLabel="Find in the list"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Find: a name or what it does"
                placeholderTextColor={t.muted}
                style={[type.body, styles.search, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
                value={query}
              />
            ) : null}
            {fault && items ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
            {note ? <Text style={[type.small, { color: t.ink }]}>{note}</Text> : null}
            <Text style={[type.small, { color: t.muted }]}>A change is for {bot?.title ?? 'this bot'} only. A chat that is open takes it with its next start.</Text>
          </View>
        }
        contentContainerStyle={styles.content}
        data={shown}
        initialNumToRender={12}
        keyboardShouldPersistTaps="handled"
        keyExtractor={item => item.id}
        refreshing={pull.refreshing}
        onRefresh={pull.onRefresh}
        renderItem={({ item }) => <Row item={item} onFlip={flip} onGuard={kind === 'skills' ? guard : undefined} />}
        windowSize={7}
      />

      {choosing === 'bot' ? (
        <ChoiceSheet
          choices={(bots ?? []).map(known => ({ id: known.name, label: known.title, detail: known.description, lead: <BotAvatar bot={known} size={32} t={t} /> }))}
          current={profile}
          onClose={() => setChoosing(null)}
          onPick={name => (setChoosing(null), setQuery(''), setFault(null), showCapabilitiesOf(name))}
          title="Bot"
        />
      ) : null}
      {choosing === 'kind' ? (
        <ChoiceSheet
          choices={CAPABILITY_KINDS.map(known => ({ id: known.kind, label: known.label, detail: [known.detail, capabilityCount(all[known.kind])].filter(Boolean).join(' · ') }))}
          current={kind}
          onClose={() => setChoosing(null)}
          onPick={picked => (setChoosing(null), setQuery(''), setFault(null), setKind(picked as CapabilityKind))}
          title="Show"
        />
      ) : null}
    </SafeAreaView>
  )
}

const Row = memo(function Row({ item, onFlip, onGuard }: { item: Capability; onFlip: (item: Capability, on: boolean) => void; /** Skills only: lock against rewrites by the agent. */ onGuard?: (item: Capability, guarded: boolean) => void }) {
  const t = useTheme()

  return (
    <View style={[styles.row, { backgroundColor: t.paper, borderColor: t.line }]}>
      <View style={styles.fill}>
        <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
          {item.title}
        </Text>
        {item.detail ? (
          <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
            {item.detail}
          </Text>
        ) : null}
        {item.locked || item.group ? (
          <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
            {item.locked || item.group}
          </Text>
        ) : null}
      </View>
      {onGuard ? (
        <IconButton
          icon={item.guarded ? 'lock' : 'unlock'}
          label={item.guarded ? `${item.title}: locked against changes by the agent. Unlock it` : `${item.title}: the agent can change it. Lock it`}
          onPress={() => onGuard(item, !item.guarded)}
        />
      ) : null}
      <Switch accessibilityLabel={`${item.title}: ${item.on ? 'on' : 'off'}`} disabled={Boolean(item.locked)} onValueChange={on => onFlip(item, on)} trackColor={{ true: t.accent }} value={item.on} />
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wait: { marginTop: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { gap: space.sm, marginBottom: space.sm },
  content: { padding: space.lg, gap: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center', flexGrow: 1 },
  search: { minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 12, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth }
})
