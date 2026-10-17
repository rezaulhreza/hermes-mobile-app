import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { SheetFrame } from './bot-sheet'
import { Button, Field } from './ui'

/**
 * Teach the bot of a chat a task. The user says what to learn, or gives the
 * work of this chat as the lesson. The bot writes it down as a skill and
 * says in the chat what it saved. `onTeach` gets the words; no words is the
 * work of this chat.
 */
export function TeachSheet({ bot, hasWork, onClose, onTeach }: { /** The name of the bot a person reads. */ bot: string; /** The chat has work the bot can learn from. */ hasWork: boolean; onClose: () => void; onTeach: (request: string) => void }) {
  const t = useTheme()
  const [request, setRequest] = useState('')

  return (
    <SheetFrame onClose={onClose} title={`Teach ${bot}`}>
      <Text style={[type.body, { color: t.muted }]}>
        {bot} writes the task down as a skill and uses it the next time the task comes. It tells you in this chat what it saved.
      </Text>
      <Field
        autoCapitalize="sentences"
        autoCorrect
        autoFocus
        label="What must it learn?"
        multiline
        onChangeText={setRequest}
        placeholder="How to write my weekly report. Or a folder, a page, or notes to learn from."
        style={styles.request}
        value={request}
      />
      <Button disabled={!request.trim()} icon="book-open" label="Teach this" onPress={() => onTeach(request)} tone="primary" />
      {hasWork ? (
        <View style={styles.other}>
          <Text style={[type.small, { color: t.muted }]}>Or make a skill of the work in this chat, as the bot did it.</Text>
          <Button icon="message-square" label="Learn from this chat" onPress={() => onTeach('')} />
        </View>
      ) : null}
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  request: { minHeight: 110, textAlignVertical: 'top' },
  other: { gap: space.sm, marginTop: space.md }
})
