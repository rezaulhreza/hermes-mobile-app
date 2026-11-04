import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router, useLocalSearchParams } from 'expo-router'
import { memo, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, AppState, FlatList, Image, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar, SheetFrame } from '@/components/bot-sheet'
import { ChoiceRow, ChoiceSheet } from '@/components/choice'
import { Button, Field, IconButton, Notice } from '@/components/ui'
import { aliasProblem, type ConnectorAccount, type ConnectorCard, connectorFaultWords, connectorStateWords, shownConnectors } from '@/core/connectors'
import { faultWords } from '@/core/format'
import { $bots } from '@/store/bots'
import { $connectorCards, $connectorProfile, $signIn, clearConnectors, connectApp, dropSignIn, loadConnectors, removeAccount, renameAccount, setAppOn, showConnectorsOf, wakeSignIn } from '@/store/connectors'
import { $linkState } from '@/store/link'
import { type Palette, radius, space, TOUCH, type } from '@/theme/tokens'
import { usePull } from '@/theme/use-pull'
import { useTheme } from '@/theme/use-theme'

const words = (error: unknown) => connectorFaultWords(error) ?? faultWords(error)

/**
 * Connected apps: Linear, Notion, Gmail and the other hosted apps a bot can
 * use after one sign-in in the browser. The list starts from the bot, the same
 * as Skills and tools.
 */
export default function Connectors() {
  const t = useTheme()
  const params = useLocalSearchParams<{ profile?: string }>()
  const linkState = useStore($linkState)
  const bots = useStore($bots)
  const profile = useStore($connectorProfile)
  const cards = useStore($connectorCards)
  const [query, setQuery] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const bot = bots?.find(known => known.name === profile)
  const shown = useMemo(() => shownConnectors(cards ?? [], query), [cards, query])
  const pull = usePull(() => loadConnectors().catch(error => setFault(words(error))))
  const card = cards?.find(known => known.slug === open) ?? null

  useEffect(() => {
    if (!profile && bots?.length) {
      showConnectorsOf(bots.find(known => known.name === params.profile)?.name ?? bots.find(known => known.isDefault)?.name ?? bots[0].name)
    }
  }, [profile, bots, params.profile])

  useEffect(() => {
    if (linkState === 'open' && profile && !$connectorCards.get()) {
      loadConnectors().catch(error => setFault(words(error)))
    }
  }, [linkState, profile])

  // Back from the browser: the host looks at the sign-in at once.
  useEffect(() => {
    const watch = AppState.addEventListener('change', state => state === 'active' && void wakeSignIn())

    return () => watch.remove()
  }, [])

  // The lists and the sign-in leave the memory of the phone with the screen.
  useEffect(() => clearConnectors, [])

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Connected apps</Text>
      </View>

      <FlatList
        automaticallyAdjustKeyboardInsets
        ListEmptyComponent={
          !cards ? (
            fault ? (
              <Notice detail={fault} icon="alert-triangle" title="Could not read the apps" />
            ) : (
              <ActivityIndicator color={t.muted} style={styles.wait} />
            )
          ) : (
            <Notice icon="grid" title={query.trim() ? 'Nothing matches' : 'This host offers no apps'} />
          )
        }
        ListHeaderComponent={
          <View style={styles.top}>
            <ChoiceRow icon="user" label="Bot" lead={bot ? <BotAvatar bot={bot} size={28} t={t} /> : undefined} onPress={() => setChoosing(true)} value={bot?.title ?? 'Choose a bot'} />
            {(cards?.length ?? 0) > 8 ? (
              <TextInput
                accessibilityLabel="Find an app"
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
                onChangeText={setQuery}
                placeholder="Find: an app or what it is for"
                placeholderTextColor={t.muted}
                style={[type.body, styles.search, { color: t.ink, backgroundColor: t.paper, borderColor: t.line }]}
                value={query}
              />
            ) : null}
            {fault && cards ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
            <Text style={[type.small, { color: t.muted }]}>Sign in to an app once, in the browser. Then {bot?.title ?? 'this bot'} can read and work in it for you.</Text>
          </View>
        }
        contentContainerStyle={styles.content}
        data={shown}
        initialNumToRender={14}
        keyboardShouldPersistTaps="handled"
        keyExtractor={item => item.slug}
        onRefresh={pull.onRefresh}
        refreshing={pull.refreshing}
        renderItem={({ item }) => <AppRow card={item} onOpen={setOpen} />}
        windowSize={7}
      />

      {choosing ? (
        <ChoiceSheet
          choices={(bots ?? []).map(known => ({ id: known.name, label: known.title, detail: known.description, lead: <BotAvatar bot={known} size={32} t={t} /> }))}
          current={profile}
          onClose={() => setChoosing(false)}
          onPick={name => (setChoosing(false), setQuery(''), setFault(null), showConnectorsOf(name))}
          title="Bot"
        />
      ) : null}
      {card ? <AppSheet card={card} onClose={() => setOpen(null)} /> : null}
    </SafeAreaView>
  )
}

function AppMark({ card, t, size }: { card: ConnectorCard; t: Palette; size: number }) {
  const [broken, setBroken] = useState(false)

  if (card.logoUrl && !broken) {
    return <Image accessibilityIgnoresInvertColors onError={() => setBroken(true)} source={{ uri: card.logoUrl }} style={[styles.mark, { width: size, height: size, backgroundColor: t.soft }]} />
  }

  return (
    <View style={[styles.mark, { width: size, height: size, backgroundColor: t.soft }]}>
      <Text style={[type.label, { color: t.ink }]}>{card.name.charAt(0).toUpperCase()}</Text>
    </View>
  )
}

const needsPerson = (card: ConnectorCard) => card.state === 'broken' || card.state === 'expired'

const AppRow = memo(function AppRow({ card, onOpen }: { card: ConnectorCard; onOpen: (slug: string) => void }) {
  const t = useTheme()

  return (
    <Pressable
      accessibilityHint="Opens the app: its accounts and its switch"
      accessibilityLabel={`${card.name}: ${connectorStateWords(card)}`}
      accessibilityRole="button"
      onPress={() => onOpen(card.slug)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
    >
      <AppMark card={card} size={36} t={t} />
      <View style={styles.fill}>
        <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
          {card.name}
        </Text>
        <Text numberOfLines={1} style={[type.small, { color: needsPerson(card) ? t.red : card.state === 'connected' ? t.green : t.muted }]}>
          {connectorStateWords(card)}
        </Text>
      </View>
      <Feather color={t.muted} name="chevron-right" size={20} />
    </Pressable>
  )
})

/** One app: its state, the way to connect it, its accounts and its switch. */
function AppSheet({ card, onClose }: { card: ConnectorCard; onClose: () => void }) {
  const t = useTheme()
  const signIn = useStore($signIn)
  const [busy, setBusy] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const [alias, setAlias] = useState('')
  const mine = signIn?.slug === card.slug ? signIn : null
  const repair = card.accounts.find(account => account.state !== 'active')

  const run = (what: string, work: () => Promise<unknown>) => {
    setBusy(what)
    setFault(null)
    work()
      .catch(error => setFault(words(error)))
      .finally(() => setBusy(null))
  }

  const close = () => {
    if (mine && mine.outcome !== 'waiting') {
      dropSignIn()
    }

    onClose()
  }

  return (
    <SheetFrame onClose={close} title={card.name}>
      <View style={styles.headline}>
        <AppMark card={card} size={48} t={t} />
        <View style={styles.fill}>
          <Text style={[type.label, { color: needsPerson(card) ? t.red : t.ink }]}>{connectorStateWords(card)}</Text>
          {card.category ? <Text style={[type.small, { color: t.muted }]}>{card.category}</Text> : null}
        </View>
      </View>
      {card.description ? <Text style={[type.body, { color: t.ink }]}>{card.description}</Text> : null}
      {card.reason && needsPerson(card) ? <Text style={[type.small, { color: t.muted }]}>{card.reason}</Text> : null}
      {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}

      {mine ? <SignInState onOpen={() => mine.link && void Linking.openURL(mine.link)} onStop={dropSignIn} outcome={mine.outcome} hasLink={Boolean(mine.link)} t={t} /> : null}

      {card.state === 'locked' ? (
        <Text style={[type.small, { color: t.muted }]}>Your organisation turned this app off. Ask the person who looks after your Nous account.</Text>
      ) : card.state === 'off' ? (
        <Button busy={busy === 'on'} icon="power" label="Let the bots use it" onPress={() => run('on', () => setAppOn(card.slug, true))} tone="primary" />
      ) : mine?.outcome === 'waiting' ? null : card.state === 'available' ? (
        <Button busy={busy === 'connect'} icon="log-in" label={`Connect ${card.name}`} onPress={() => run('connect', () => connectApp(card.slug))} tone="primary" />
      ) : needsPerson(card) ? (
        <Button busy={busy === 'connect'} icon="refresh-cw" label="Connect it again" onPress={() => run('connect', () => connectApp(card.slug, { reconnect: true, connectionId: repair?.id }))} tone="primary" />
      ) : null}

      {card.accounts.length ? (
        <>
          <Text style={[type.small, styles.heading, { color: t.muted }]}>Accounts · {card.accounts.length}</Text>
          {card.accounts.map(account => (
            <AccountRow account={account} key={account.id} others={card.accounts.filter(known => known.id !== account.id)} t={t} />
          ))}
        </>
      ) : null}

      {card.state === 'connected' && mine?.outcome !== 'waiting' ? (
        naming ? (
          <View style={styles.block}>
            <Field autoCapitalize="none" label="Name of the other account" onChangeText={setAlias} placeholder="work, home" value={alias} />
            {alias.trim() && aliasProblem(alias, card.accounts) ? <Text style={[type.small, { color: t.red }]}>{aliasProblem(alias, card.accounts)}</Text> : null}
            <View style={styles.line}>
              <Button label="Cancel" onPress={() => (setNaming(false), setAlias(''))} style={styles.fill} />
              <Button
                busy={busy === 'add'}
                disabled={Boolean(aliasProblem(alias, card.accounts))}
                label="Sign in"
                onPress={() => run('add', () => connectApp(card.slug, { alias }).then(() => (setNaming(false), setAlias(''))))}
                style={styles.fill}
                tone="primary"
              />
            </View>
          </View>
        ) : (
          <Button icon="user-plus" label="Add another account" onPress={() => setNaming(true)} />
        )
      ) : null}

      {card.state !== 'locked' && card.state !== 'off' ? (
        <View style={[styles.switchRow, { borderColor: t.line, backgroundColor: t.paper }]}>
          <View style={styles.fill}>
            <Text style={[type.label, { color: t.ink }]}>Bots can use it</Text>
            <Text style={[type.small, { color: t.muted }]}>Off keeps the accounts, and no bot can use the app.</Text>
          </View>
          <Switch accessibilityLabel={`${card.name}: bots can use it`} disabled={busy === 'off'} onValueChange={on => void (!on && run('off', () => setAppOn(card.slug, false)))} trackColor={{ true: t.accent }} value />
        </View>
      ) : null}
    </SheetFrame>
  )
}

function SignInState({ outcome, hasLink, onOpen, onStop, t }: { outcome: string; hasLink: boolean; onOpen: () => void; onStop: () => void; t: Palette }) {
  if (outcome === 'connected') {
    return (
      <View style={[styles.block, styles.notice, { backgroundColor: t.greenBg }]}>
        <Text style={[type.label, { color: t.ink }]}>Connected. The bots can use it from their next message.</Text>
      </View>
    )
  }

  if (outcome !== 'waiting') {
    return (
      <View style={[styles.block, styles.notice, { backgroundColor: t.redBg }]}>
        <Text style={[type.small, { color: t.ink }]}>{outcome === 'expired' ? 'The sign-in ran out of time. Start it again.' : 'The sign-in did not finish. Start it again.'}</Text>
      </View>
    )
  }

  return (
    <View style={[styles.block, styles.notice, { backgroundColor: t.soft }]}>
      <View style={styles.line}>
        <ActivityIndicator color={t.muted} />
        <Text style={[type.small, styles.fill, { color: t.ink }]}>{hasLink ? 'Finish the sign-in in the browser, then come back here.' : 'The host is getting the sign-in page ready.'}</Text>
      </View>
      <View style={styles.line}>
        <Button label="Stop waiting" onPress={onStop} style={styles.fill} />
        {hasLink ? <Button icon="external-link" label="Open it again" onPress={onOpen} style={styles.fill} /> : null}
      </View>
    </View>
  )
}

const ACCOUNT_WORDS: Record<ConnectorAccount['state'], string> = { active: 'Signed in', pending: 'Waiting for the sign-in', expired: 'The access ran out', failed: 'Could not connect' }

function AccountRow({ account, others, t }: { account: ConnectorAccount; others: ConnectorAccount[]; t: Palette }) {
  const [mode, setMode] = useState<'rename' | 'remove' | null>(null)
  const [alias, setAlias] = useState(account.alias)
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const problem = aliasProblem(alias, others)

  const run = (work: () => Promise<unknown>) => {
    setBusy(true)
    setFault(null)
    work().then(
      () => setMode(null),
      error => (setFault(words(error)), setBusy(false))
    )
  }

  return (
    <View style={[styles.account, { borderColor: t.line, backgroundColor: t.paper }]}>
      <View style={styles.line}>
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {account.title}
          </Text>
          <Text numberOfLines={1} style={[type.small, { color: account.state === 'active' ? t.muted : t.red }]}>
            {[account.alias && account.label ? account.label : '', ACCOUNT_WORDS[account.state]].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {mode ? null : (
          <>
            <IconButton icon="edit-2" label={`Rename ${account.title}`} onPress={() => setMode('rename')} />
            <IconButton icon="log-out" label={`Sign out of ${account.title}`} onPress={() => setMode('remove')} />
          </>
        )}
      </View>
      {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
      {mode === 'rename' ? (
        <>
          <Field autoCapitalize="none" label="Name" onChangeText={setAlias} value={alias} />
          {alias.trim() && problem ? <Text style={[type.small, { color: t.red }]}>{problem}</Text> : null}
          <View style={styles.line}>
            <Button label="Cancel" onPress={() => (setMode(null), setAlias(account.alias))} style={styles.fill} />
            <Button busy={busy} disabled={Boolean(problem) || alias.trim() === account.alias} label="Save" onPress={() => run(() => renameAccount(account.id, alias))} style={styles.fill} tone="primary" />
          </View>
        </>
      ) : null}
      {mode === 'remove' ? (
        <View style={[styles.block, styles.notice, { backgroundColor: t.redBg }]}>
          <Text style={[type.small, { color: t.ink }]}>Sign out of “{account.title}”? The bots lose this account at once. To use it again, sign in again.</Text>
          <View style={styles.line}>
            <Button label="Keep it" onPress={() => setMode(null)} style={styles.fill} />
            <Button busy={busy} label="Sign out" onPress={() => run(() => removeAccount(account.id))} style={styles.fill} tone="danger" />
          </View>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wait: { marginTop: space.xl },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { gap: space.sm, marginBottom: space.sm },
  content: { padding: space.lg, gap: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center', flexGrow: 1 },
  search: { minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 12, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  mark: { borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  headline: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  heading: { fontWeight: '700', marginTop: space.sm },
  block: { gap: space.sm },
  notice: { padding: space.md, borderRadius: radius.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  account: { gap: space.sm, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth }
})
