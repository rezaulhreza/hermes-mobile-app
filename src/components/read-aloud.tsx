import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { Pressable } from 'react-native'

import { $reading, readAloud } from '@/store/voice'
import { useTheme } from '@/theme/use-theme'

/**
 * Reads the words of an answer aloud. The same button stops it. `id` names
 * the answer, so only the answer that is read shows the stop mark.
 */
export function ReadAloud({ id, text, size = 15 }: { id: string; text: string; size?: number }) {
  const t = useTheme()
  const reading = useStore($reading) === id

  return (
    <Pressable
      accessibilityLabel={reading ? 'Stop reading' : 'Read the answer aloud'}
      accessibilityRole="button"
      hitSlop={10}
      onPress={() => void readAloud(id, text).catch(() => undefined)}
    >
      <Feather color={reading ? t.accent : t.muted} name={reading ? 'square' : 'volume-2'} size={size} />
    </Pressable>
  )
}
