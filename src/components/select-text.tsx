import { Feather } from '@expo/vector-icons'
import { useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput } from 'react-native'

import { type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { SheetFrame } from './bot-sheet'

/**
 * Opens the words of a message in a sheet where a part of them can be selected.
 * On iOS a `Text` copies as a whole only: a field that cannot be edited gives the handles of the system.
 */
export function SelectText({ text, size = 15 }: { text: string; size?: number }) {
  const t = useTheme()
  const [open, setOpen] = useState(false)

  return (
    <>
      <Pressable accessibilityLabel="Select text" accessibilityRole="button" hitSlop={10} onPress={() => setOpen(true)}>
        <Feather color={t.muted} name="type" size={size} />
      </Pressable>
      {open ? (
        <SheetFrame onClose={() => setOpen(false)} title="Select text">
          {Platform.OS === 'ios' ? (
            <TextInput editable={false} multiline scrollEnabled={false} style={[type.body, styles.field, { color: t.ink }]} value={text} />
          ) : (
            <Text selectable style={[type.body, { color: t.ink }]}>
              {text}
            </Text>
          )}
        </SheetFrame>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  // A field has a padding of its own on iOS: without it the text starts at the edge of the sheet's own padding.
  field: { padding: 0 }
})
