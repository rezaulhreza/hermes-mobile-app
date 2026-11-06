import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { BotAvatar, SheetFrame } from '@/components/bot-sheet'
import { type Choice, ChoiceRow, ChoiceSheet } from '@/components/choice'
import { Markdown } from '@/components/markdown'
import { Button, Field, IconButton, Notice } from '@/components/ui'
import { type Bot, botsByAnyName } from '@/core/bots'
import { faultWords, relativeTime } from '@/core/format'
import { type Card, type CardDetail, cardFault, columnName, firstColumn, moveChoices, moveDetail, moveQuestion } from '@/core/kanban'
import { $bots } from '@/store/bots'
import { $boards, $boardSlug, $columns, clearKanban, commentCard, createCard, deleteCard, loadBoard, loadBoards, loadCard, pinnedBoards, showBoard, togglePinnedBoard, updateCard } from '@/store/kanban'
import { $preferences } from '@/store/preferences'
import { boardsInOrder } from '@/core/kanban'
import { $linkState } from '@/store/link'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { usePull } from '@/theme/use-pull'
import { useTheme } from '@/theme/use-theme'

/**
 * The board of work cards. A phone shows one column at a time: the board and
 * the column are each a row that opens a list, and the cards of the column
 * are a list under them.
 */
export default function Kanban() {
  const t = useTheme()
  const linkState = useStore($linkState)
  const boards = useStore($boards)
  // The pins live in the preferences of this phone: a change draws the list again.
  useStore($preferences)
  const pinned = pinnedBoards()
  // The pinned boards that the host still has, in the order they were pinned.
  const tabs = boardsInOrder(boards ?? [], pinned).filter(item => pinned.includes(item.slug))
  const slug = useStore($boardSlug)
  const columns = useStore($columns)
  const bots = useStore($bots)
  const byName = useMemo(() => botsByAnyName(bots ?? []), [bots])
  const [column, setColumn] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<'board' | 'column' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const pull = usePull(loadBoard)
  const board = boards?.find(item => (slug ? item.slug === slug : item.current)) ?? boards?.[0]
  const shownKey = column && columns?.some(item => item.key === column) ? column : firstColumn(columns ?? [])
  const shown = columns?.find(item => item.key === shownKey)

  useEffect(() => {
    if (linkState === 'open') {
      loadBoards().catch(error => setFailure(faultWords(error)))
      loadBoard().catch(error => setFailure(faultWords(error)))
    }
  }, [linkState])

  // The cards leave the memory of the phone with the screen.
  useEffect(() => clearKanban, [])

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={() => router.back()} />
        <Text style={[type.heading, styles.fill, { color: t.ink }]}>Board</Text>
        <IconButton disabled={!columns} filled icon="plus" label="Add a card" onPress={() => setAdding(true)} />
      </View>

      {!columns ? (
        failure ? (
          <Notice detail={failure} icon="alert-triangle" title="Could not read the board" />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        )
      ) : (
        <FlatList
          ListEmptyComponent={<Notice icon="inbox" title={`No card in “${columnName(shownKey)}”`} />}
          ListHeaderComponent={
            <View style={styles.top}>
              {tabs.length > 1 || (tabs.length === 1 && tabs[0].slug !== board?.slug) ? (
                // The pinned boards, one tap away, as on the desktop. A long press unpins one.
                <ScrollView contentContainerStyle={styles.tabs} horizontal showsHorizontalScrollIndicator={false}>
                  {tabs.map(item => {
                    const on = item.slug === board?.slug

                    return (
                      <Pressable
                        accessibilityHint="Hold to unpin it"
                        accessibilityLabel={`Board: ${item.name}`}
                        accessibilityRole="tab"
                        accessibilityState={{ selected: on }}
                        key={item.slug}
                        onLongPress={() => togglePinnedBoard(item.slug)}
                        onPress={() => (setColumn(null), showBoard(item.slug))}
                        style={({ pressed }) => [styles.tab, { backgroundColor: on ? t.inverse : t.paper, borderColor: on ? t.inverse : t.line }, pressed && styles.dim]}
                      >
                        <Text numberOfLines={1} style={[type.label, { color: on ? t.onInverse : t.ink }]}>
                          {item.name}
                        </Text>
                      </Pressable>
                    )
                  })}
                </ScrollView>
              ) : null}
              <View style={styles.boardLine}>
                <View style={styles.fill}>
                  <ChoiceRow icon="layout" label="Board" onPress={() => setChoosing('board')} value={board?.name ?? 'The board of the host'} />
                </View>
                {board ? (
                  <IconButton
                    icon="bookmark"
                    filled={pinned.includes(board.slug)}
                    label={pinned.includes(board.slug) ? `Unpin ${board.name}` : `Pin ${board.name}: it comes first in the list of boards`}
                    onPress={() => togglePinnedBoard(board.slug)}
                  />
                ) : null}
              </View>
              <ChoiceRow icon="columns" label="Column" onPress={() => setChoosing('column')} value={`${columnName(shownKey)} · ${shown?.cards.length ?? 0}`} />
            </View>
          }
          contentContainerStyle={styles.content}
          data={shown?.cards ?? []}
          initialNumToRender={12}
          keyExtractor={card => card.id}
          refreshControl={<RefreshControl onRefresh={pull.onRefresh} refreshing={pull.refreshing} tintColor={t.muted} />}
          renderItem={({ item }) => <CardRow bot={byName.get(item.assignee)} card={item} onPress={() => setOpenId(item.id)} />}
          windowSize={7}
        />
      )}

      {choosing === 'board' ? (
        <ChoiceSheet
          choices={boardsInOrder(boards ?? [], pinned).map(item => ({
            id: item.slug,
            label: item.name,
            detail: [pinned.includes(item.slug) ? 'Pinned' : '', `${item.total} ${item.total === 1 ? 'card' : 'cards'}`, item.description].filter(Boolean).join(' · ')
          }))}
          current={board?.slug}
          onClose={() => setChoosing(null)}
          onPick={picked => (setChoosing(null), setColumn(null), showBoard(picked))}
          title="Board"
        />
      ) : null}
      {choosing === 'column' && columns ? (
        <ChoiceSheet
          choices={columns.map(item => ({ id: item.key, label: columnName(item.key), detail: `${item.cards.length} ${item.cards.length === 1 ? 'card' : 'cards'}` }))}
          current={shownKey}
          onClose={() => setChoosing(null)}
          onPick={key => (setChoosing(null), setColumn(key))}
          title="Column"
        />
      ) : null}
      {openId ? <CardSheet bots={bots ?? []} byName={byName} columns={(columns ?? []).map(item => item.key)} id={openId} onClose={() => setOpenId(null)} /> : null}
      {adding ? <NewCardSheet bots={bots ?? []} onClose={() => setAdding(false)} /> : null}
    </SafeAreaView>
  )
}

function CardRow({ card, bot, onPress }: { card: Card; bot?: Bot; onPress: () => void }) {
  const t = useTheme()

  return (
    <Pressable
      accessibilityHint="Opens the card"
      accessibilityLabel={`Card: ${card.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? t.soft : t.paper, borderColor: t.line }]}
    >
      <View style={styles.fill}>
        <Text numberOfLines={2} style={[type.label, { color: t.ink }]}>
          {card.title}
        </Text>
        {card.summary ? (
          <Text numberOfLines={2} style={[type.small, { color: t.muted }]}>
            {card.summary}
          </Text>
        ) : null}
        <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
          {bot?.title ?? (card.assignee || 'Nobody has it')}
        </Text>
      </View>
      {bot ? <BotAvatar bot={bot} size={30} t={t} /> : null}
    </Pressable>
  )
}

/** The choices of who has a card: nobody, or a bot with its picture. */
function botChoices(bots: readonly Bot[], t: ReturnType<typeof useTheme>): Choice[] {
  return [{ id: '', label: 'Nobody' }, ...bots.map(bot => ({ id: bot.name, label: bot.title, detail: bot.description, lead: <BotAvatar bot={bot} size={32} t={t} /> }))]
}

/** One card: what it asks, where it is, who has it, and what was said about it. Each change saves by itself. */
function CardSheet({ id, columns, bots, byName, onClose }: { id: string; columns: readonly string[]; bots: readonly Bot[]; byName: ReadonlyMap<string, Bot>; onClose: () => void }) {
  const t = useTheme()
  const [card, setCard] = useState<CardDetail | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<'column' | 'bot' | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  // The column the user chose, while the host's question for it waits for an answer.
  const [moving, setMoving] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const question = moving ? moveQuestion(moving) : null

  const read = () => loadCard(id).then(setCard, error => setFault(faultWords(error)))

  useEffect(() => {
    void read()
    // One card, read when its sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const run = (name: string, work: () => Promise<unknown>) => {
    setBusy(name)
    setFault(null)
    work()
      .then(read)
      .catch(error => setFault(cardFault(faultWords(error))))
      .finally(() => setBusy(null))
  }

  const move = (key: string, said = '') => {
    const asks = moveQuestion(key)

    setMoving(null)
    setAnswer('')
    run('column', () => updateCard(id, { status: key, ...(asks && said.trim() ? { [asks.field]: said.trim() } : {}) }))
  }

  return (
    <SheetFrame onClose={onClose} title={card?.title || 'Card'}>
      {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
      {!card ? (
        fault ? null : (
          <ActivityIndicator color={t.muted} />
        )
      ) : (
        <>
          <ChoiceRow disabled={Boolean(busy)} icon="columns" label="Column" onPress={() => setChoosing('column')} value={columnName(card.status)} />
          <ChoiceRow disabled={Boolean(busy)} icon="user" label="Who has it" onPress={() => setChoosing('bot')} value={byName.get(card.assignee)?.title ?? (card.assignee || 'Nobody')} />
          {moving && question ? (
            <View style={[styles.confirm, { backgroundColor: t.soft }]}>
              <Field label={question.label} multiline onChangeText={setAnswer} placeholder={question.placeholder} style={styles.commentField} value={answer} />
              <View style={styles.line}>
                <Button label="Leave it" onPress={() => (setMoving(null), setAnswer(''))} style={styles.fill} />
                <Button disabled={question.required && !answer.trim()} label={`Move to ${columnName(moving)}`} onPress={() => move(moving, answer)} style={styles.fill} tone="primary" />
              </View>
            </View>
          ) : null}
          {card.note ? <Text style={[type.small, styles.note, { color: t.ink, backgroundColor: card.status === 'blocked' ? t.redBg : t.soft }]}>{card.note}</Text> : null}
          {card.body ? <Markdown text={card.body} /> : <Text style={[type.small, { color: t.muted }]}>This card has no text.</Text>}

          <Text style={[type.small, styles.heading, { color: t.muted }]}>Comments</Text>
          {card.comments.length ? (
            card.comments.map(item => (
              <View key={item.id} style={[styles.comment, { borderColor: t.line }]}>
                <Text style={[type.small, { color: t.muted }]}>
                  <Text style={{ color: t.ink, fontWeight: '700' }}>{item.author === 'user' || item.author === 'dashboard' ? 'You' : (byName.get(item.author)?.title ?? item.author)}</Text>
                  {item.at ? `  ${relativeTime(item.at)}` : ''}
                </Text>
                <Markdown text={item.body} />
              </View>
            ))
          ) : (
            <Text style={[type.small, { color: t.muted }]}>Nobody said anything yet.</Text>
          )}
          <Field label="Your comment" multiline onChangeText={setComment} placeholder="What the bot must know" style={styles.commentField} value={comment} />
          <Button busy={busy === 'comment'} disabled={!comment.trim()} icon="send" label="Add the comment" onPress={() => run('comment', () => commentCard(id, comment).then(() => setComment('')))} />

          {removing ? (
            <View style={[styles.confirm, { backgroundColor: t.redBg }]}>
              <Text style={[type.small, { color: t.ink }]}>Delete this card with its comments? This cannot be undone.</Text>
              <View style={styles.line}>
                <Button label="Keep it" onPress={() => setRemoving(false)} style={styles.fill} />
                <Button busy={busy === 'delete'} label="Delete" onPress={() => run('delete', () => deleteCard(id).then(onClose))} style={styles.fill} tone="danger" />
              </View>
            </View>
          ) : (
            <Button icon="trash-2" label="Delete this card" onPress={() => setRemoving(true)} tone="danger" />
          )}

          {choosing === 'column' ? (
            <ChoiceSheet
              choices={moveChoices(columns, card.status).map(key => ({ id: key, label: columnName(key), detail: moveDetail(key) }))}
              current={card.status}
              onClose={() => setChoosing(null)}
              onPick={key => (setChoosing(null), key !== card.status && (moveQuestion(key) ? setMoving(key) : move(key)))}
              title="Column"
            />
          ) : null}
          {choosing === 'bot' ? (
            <ChoiceSheet
              choices={botChoices(bots, t)}
              current={byName.get(card.assignee)?.name ?? card.assignee}
              onClose={() => setChoosing(null)}
              onPick={name => (setChoosing(null), run('bot', () => updateCard(id, { assignee: name })))}
              title="Who has it"
            />
          ) : null}
        </>
      )}
    </SheetFrame>
  )
}

function NewCardSheet({ bots, onClose }: { bots: readonly Bot[]; onClose: () => void }) {
  const t = useTheme()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [assignee, setAssignee] = useState('')
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)

  const add = () => {
    setBusy(true)
    // A card with nobody on it waits to be sorted. A card with a bot on it is work for that bot.
    createCard(title, body, assignee, !assignee)
      .then(onClose, error => setFault(faultWords(error)))
      .finally(() => setBusy(false))
  }

  return (
    <SheetFrame onClose={onClose} title="Add a card">
      <Field label="What must be done" onChangeText={setTitle} placeholder="A short title" value={title} />
      <Field label="The details" multiline onChangeText={setBody} placeholder="What done looks like, where to look" style={styles.body} value={body} />
      <ChoiceRow icon="user" label="Who gets it" onPress={() => setChoosing(true)} value={bots.find(bot => bot.name === assignee)?.title ?? 'Nobody yet: it waits to be sorted'} />
      {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
      <Button busy={busy} disabled={!title.trim()} icon="plus" label="Add the card" onPress={add} tone="primary" />
      {choosing ? <ChoiceSheet choices={botChoices(bots, t)} current={assignee} onClose={() => setChoosing(false)} onPick={name => (setAssignee(name), setChoosing(false))} title="Who gets it" /> : null}
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  boardLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  tabs: { gap: space.sm, paddingVertical: space.xs },
  dim: { opacity: 0.6 },
  tab: { minHeight: 36, maxWidth: 220, justifyContent: 'center', paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  top: { gap: space.sm, marginBottom: space.sm },
  content: { padding: space.lg, gap: space.sm, maxWidth: 760, width: '100%', alignSelf: 'center', flexGrow: 1 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, padding: space.md, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  note: { padding: space.md, borderRadius: radius.md, overflow: 'hidden' },
  heading: { fontWeight: '700', marginTop: space.sm },
  comment: { gap: 2, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  commentField: { minHeight: 72, textAlignVertical: 'top', paddingTop: space.md },
  body: { minHeight: 120, textAlignVertical: 'top', paddingTop: space.md },
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.md },
  line: { flexDirection: 'row', gap: space.md }
})
