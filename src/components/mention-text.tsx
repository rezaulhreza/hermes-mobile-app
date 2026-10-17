import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { StyleSheet, Text, View } from 'react-native'

import type { MentionTarget, ReferenceKind, TextPart } from '@/core/mentions'
import { $bots } from '@/store/bots'
import { fade, type Palette } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { BotAvatar } from './bot-sheet'

const FACE = 16

const REFERENCE_ICON: Record<ReferenceKind, keyof typeof Feather.glyphMap> = {
  file: 'file-text',
  folder: 'folder',
  url: 'link',
  git: 'git-commit',
  plugin: 'package'
}

/**
 * A text with its mentions: the content of a `Text`. A mention is drawn as
 * what it stands for, the picture of the bot and the name a person reads, not
 * as the "@" word that was typed. Only a mention that reaches something is
 * drawn so: a name that stays plain is a name that nobody answers to.
 *
 * `typed` is for a message field. A field holds text only, and every letter
 * must keep its place under the cursor, so there the mention keeps its "@"
 * word and has the accent colour.
 */
export function MentionText({ parts, typed = false }: { parts: readonly TextPart[]; typed?: boolean }) {
  const t = useTheme()

  return parts.map((part, index) =>
    !part.mention ? (
      part.text
    ) : part.target && !typed ? (
      <MentionChip key={index} t={t} target={part.target} />
    ) : (
      <Text key={index} style={{ color: t.accent, fontWeight: '600' }}>
        {part.text}
      </Text>
    )
  )
}

function MentionChip({ target, t }: { target: MentionTarget; t: Palette }) {
  const bots = useStore($bots)
  const bot = target.kind === 'bot' ? bots?.find(known => known.name === target.name) : undefined

  return (
    <View accessibilityLabel={target.title} accessible style={styles.line}>
      <View style={[styles.chip, { backgroundColor: fade(t.ink, 0.1) }]}>
        {bot ? (
          <BotAvatar bot={bot} size={FACE} t={t} />
        ) : (
          <Feather color={t.muted} name={target.kind === 'reference' ? REFERENCE_ICON[target.type] : target.kind === 'everyone' ? 'users' : 'user'} size={13} />
        )}
        <Text numberOfLines={1} style={[styles.name, { color: t.ink }]}>
          {target.title}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  // The chip is taller than the letters of a line: its row is a little lower, so its middle is the middle of the words.
  line: { height: 18, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, maxWidth: 220, paddingLeft: 4, paddingRight: 7, borderRadius: 7 },
  name: { flexShrink: 1, fontSize: 15, fontWeight: '600' }
})
