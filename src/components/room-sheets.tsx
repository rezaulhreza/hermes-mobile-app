import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { type Bot, knownSections, type Room, roomMembersProblem } from '@/core/bots'
import { faultWords } from '@/core/format'
import { $bots, $filing, setRoomSection } from '@/store/bots'
import { changeRoom, closeRoom, makeRoom } from '@/store/rooms'
import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { BotAvatar, SectionSheet, SheetFrame } from './bot-sheet'
import { ChoiceRow } from './choice'
import { Button, Field } from './ui'

/** The bots of the host as a list with a mark on each member. A tap puts a bot in or takes it out. */
function MemberList({ bots, chosen, onToggle }: { bots: readonly Bot[]; chosen: readonly string[]; onToggle: (name: string) => void }) {
  const t = useTheme()

  return (
    <View style={[styles.list, { borderColor: t.line, backgroundColor: t.paper }]}>
      {bots.map((bot, index) => {
        const checked = chosen.includes(bot.name)

        return (
          <Pressable
            accessibilityLabel={`Member: ${bot.title}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked }}
            key={bot.name}
            onPress={() => onToggle(bot.name)}
            style={({ pressed }) => [styles.member, index > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { backgroundColor: t.soft }]}
          >
            <BotAvatar bot={bot} size={32} t={t} />
            <View style={styles.fill}>
              <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                {bot.title}
              </Text>
              {bot.description ? (
                <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                  {bot.description}
                </Text>
              ) : null}
            </View>
            <Feather color={checked ? t.accent : t.line} name={checked ? 'check-circle' : 'circle'} size={22} />
          </Pressable>
        )
      })}
    </View>
  )
}

const toggled = (names: readonly string[], name: string) => (names.includes(name) ? names.filter(known => known !== name) : [...names, name])

/** A new group chat: its name and the bots in it. */
export function NewRoomSheet({ onClose, onMade }: { onClose: () => void; onMade: (id: string) => void }) {
  const t = useTheme()
  const bots = (useStore($bots) ?? []).filter(bot => !bot.hidden)
  const [name, setName] = useState('')
  const [members, setMembers] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)
  const problem = roomMembersProblem(members.length)

  const make = () => {
    setBusy(true)
    setFault(null)
    makeRoom(name, members)
      .then(onMade, error => setFault(faultWords(error)))
      .finally(() => setBusy(false))
  }

  return (
    <SheetFrame onClose={onClose} title="New group chat">
      <Text style={[type.small, { color: t.muted }]}>You write one message. Each bot of the group reads it and answers in turn, and reads what the others said.</Text>
      <Field autoCapitalize="sentences" label="Name" onChangeText={setName} placeholder="Launch plan" value={name} />
      <Text style={[type.small, styles.heading, { color: t.muted }]}>
        Bots in it{members.length ? ` · ${members.length}` : ''}
      </Text>
      <MemberList bots={bots} chosen={members} onToggle={bot => setMembers(toggled(members, bot))} />
      {fault || (members.length && problem) ? <Text style={[type.small, { color: t.red }]}>{fault ?? problem}</Text> : null}
      <Button busy={busy} disabled={!name.trim() || Boolean(problem)} icon="users" label="Make the group chat" onPress={make} tone="primary" />
    </SheetFrame>
  )
}

/** A group chat's name, its bots, and the way to close it. Each part saves by itself. */
export function RoomSettingsSheet({ room, onClose, onClosed }: { room: Room; onClose: () => void; onClosed: () => void }) {
  const t = useTheme()
  const all = useStore($bots) ?? []
  // The members come first. A bot that is put away shows only when it is a member already.
  const inRoom = (bot: Bot) => (room.members.includes(bot.name) ? 0 : 1)
  const bots = all.filter(bot => !bot.hidden || room.members.includes(bot.name)).sort((a, b) => inRoom(a) - inRoom(b))
  const [name, setName] = useState(room.name)
  const [members, setMembers] = useState<string[]>(room.members.filter(member => all.some(bot => bot.name === member)))
  const [busy, setBusy] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [filing, setFiling] = useState(false)
  const filed = useStore($filing)
  const sections = knownSections(all, filed.sections)
  const section = sections.find(known => known.id === filed.rooms[room.id])
  const problem = roomMembersProblem(members.length)
  const membersChanged = members.length !== room.members.length || members.some(member => !room.members.includes(member))

  const run = (what: string, work: () => Promise<unknown>) => {
    setBusy(what)
    setFault(null)
    work()
      .catch(error => setFault(faultWords(error)))
      .finally(() => setBusy(null))
  }

  return (
    <SheetFrame onClose={onClose} title="Group chat">
      {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
      <Field autoCapitalize="sentences" label="Name" onChangeText={setName} value={name} />
      <Button busy={busy === 'name'} disabled={!name.trim() || name.trim() === room.name} label="Save the name" onPress={() => run('name', () => changeRoom(room.id, { name }))} />

      <ChoiceRow disabled={busy === 'section'} icon="folder" label="Section of the Bots list" onPress={() => setFiling(true)} value={section?.name ?? 'Unassigned'} />
      {filing ? (
        <SectionSheet
          current={section?.id ?? null}
          onClose={() => setFiling(false)}
          onPick={picked => {
            setFiling(false)
            run('section', () => setRoomSection(room.id, picked))
          }}
          sections={sections}
        />
      ) : null}

      <Text style={[type.small, styles.heading, { color: t.muted }]}>Bots in it · {members.length}</Text>
      <MemberList bots={bots} chosen={members} onToggle={bot => setMembers(toggled(members, bot))} />
      {problem ? <Text style={[type.small, { color: t.red }]}>{problem}</Text> : null}
      <Text style={[type.small, { color: t.muted }]}>A bot that joins starts with the next message. It does not read what was said before.</Text>
      <Button busy={busy === 'members'} disabled={!membersChanged || Boolean(problem)} label="Save the bots" onPress={() => run('members', () => changeRoom(room.id, { members }))} />

      {closing ? (
        <View style={[styles.confirm, { backgroundColor: t.redBg }]}>
          <Text style={[type.small, { color: t.ink }]}>Close “{room.name}”? The group chat and its messages go away on every device. This cannot be undone.</Text>
          <View style={styles.line}>
            <Button label="Keep it" onPress={() => setClosing(false)} style={styles.fill} />
            <Button busy={busy === 'close'} label="Close it" onPress={() => run('close', () => closeRoom(room.id).then(onClosed))} style={styles.fill} tone="danger" />
          </View>
        </View>
      ) : (
        <Button icon="trash-2" label="Close this group chat" onPress={() => setClosing(true)} tone="danger" />
      )}
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  heading: { fontWeight: '700', marginTop: space.sm },
  list: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  member: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 8, paddingHorizontal: space.md, paddingVertical: space.sm },
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.md },
  line: { flexDirection: 'row', gap: space.md }
})
