import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useEffect, useRef } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { $dictation, $dictationNotice, $dictationWords, cancelDictation, dictate } from '@/store/voice'
import { space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton } from './ui'

// One button for the whole of a dictation: the words of a part are written down while the user talks on.
const BUTTON = {
  off: { icon: 'mic', label: 'Dictate a message' },
  starting: { icon: 'x', label: 'Cancel dictation' },
  listening: { icon: 'check', label: 'Done talking' },
  hearing: { icon: 'check', label: 'Done talking' },
  transcribing: { icon: 'check', label: 'Done talking' }
} as const

const LINE = {
  off: '',
  starting: 'Opening the microphone…',
  listening: 'Listening. Take your time. Tap ✓ to see the words, or the arrow to send them.',
  hearing: 'Hearing you…',
  transcribing: 'Writing it down…'
} as const

/**
 * Dictation for a message field, the same in a chat and in a group chat. A
 * pause does not end it: the user ends it. `speak()` starts a dictation, or
 * ends the one that runs and puts the words in the field, after what is
 * there, so the user reads them and sends. `speak(true)` ends it and gives
 * the words to `onSend`: no look at them.
 */
export function useDictation({ draft, setDraft, onSend, onFault }: { draft: string; setDraft: (text: string) => void; onSend: (text: string) => void; onFault: (error: unknown) => void }) {
  const state = useStore($dictation)
  // The user ended the dictation with the send button.
  const sendSpoken = useRef(false)
  const typed = useRef('')

  // The dictation that ends later needs the field as it is then, not as it was at its start.
  useEffect(() => {
    typed.current = draft
  }, [draft])

  const speak = (andSend = false) => {
    sendSpoken.current = andSend

    dictate()
      .then(words => {
        // The call that ended a dictation gets no words: the words come to the call that started it.
        if (!words) {
          return
        }

        const text = typed.current.trim() ? `${typed.current.trimEnd()} ${words}` : words

        if (sendSpoken.current) {
          sendSpoken.current = false
          setDraft('')
          onSend(text)
        } else {
          setDraft(text)
        }
      })
      .catch(onFault)
  }

  return { state, speak, running: state !== 'off' && state !== 'starting' }
}

/** The microphone of a message field. While a dictation runs it is the button that ends it. */
export function DictationButton({ state, onPress }: { state: keyof typeof BUTTON; onPress: () => void }) {
  return <IconButton icon={BUTTON[state].icon} label={BUTTON[state].label} onPress={() => onPress()} />
}

/** The short way out of a dictation: the words go as they are, with no look at them. */
export function SendSpokenButton({ onPress }: { onPress: () => void }) {
  return <IconButton filled icon="arrow-up" label="Send what I said" onPress={() => onPress()} />
}

/** Over the message field while a dictation runs: what it does, then the words, and a way to call it off. */
export function DictationLine() {
  const t = useTheme()
  const words = useStore($dictationWords)
  const state = useStore($dictation)
  const notice = useStore($dictationNotice)

  // A dictation that ended on its own says why for a short time.
  useEffect(() => {
    if (!notice) {
      return
    }

    const timer = setTimeout(() => $dictationNotice.set(null), NOTICE_MS)

    return () => clearTimeout(timer)
  }, [notice])

  if (state === 'off') {
    return notice ? (
      <View accessibilityLiveRegion="polite" style={[styles.line, { backgroundColor: t.soft }]}>
        <Feather color={t.muted} name="mic-off" size={14} />
        <Text style={[type.small, styles.words, { color: t.ink }]}>{notice}</Text>
        <Pressable accessibilityLabel="Close the message" accessibilityRole="button" hitSlop={10} onPress={() => $dictationNotice.set(null)}>
          <Feather color={t.muted} name="x" size={16} />
        </Pressable>
      </View>
    ) : null
  }

  return (
    <View accessibilityLiveRegion="polite" style={[styles.line, { backgroundColor: t.greenBg }]}>
      <Feather color={t.green} name="mic" size={14} />
      {/* A long dictation shows its newest words: the start is cut, not the end. */}
      <Text ellipsizeMode="head" numberOfLines={3} style={[type.small, styles.words, { color: words ? t.ink : t.muted }]}>
        {words || LINE[state]}
      </Text>
      <Pressable accessibilityLabel="Cancel dictation" accessibilityRole="button" hitSlop={10} onPress={cancelDictation}>
        <Feather color={t.muted} name="x" size={16} />
      </Pressable>
    </View>
  )
}

/** How long the reason for an automatic stop stays above the message field. */
const NOTICE_MS = 10_000

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  words: { flex: 1 }
})
