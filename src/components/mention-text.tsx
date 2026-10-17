import { Text } from 'react-native'

import type { TextPart } from '@/core/mentions'
import { useTheme } from '@/theme/use-theme'

/**
 * A text with its mentions in the accent colour: the content of a `Text`, or
 * of a message field. A mention has the colour only when it reaches a bot, so
 * a name with no colour is a name that nobody answers to.
 */
export function MentionText({ parts }: { parts: readonly TextPart[] }) {
  const t = useTheme()

  return parts.map((part, index) =>
    part.mention ? (
      <Text key={index} style={{ color: t.accent, fontWeight: '600' }}>
        {part.text}
      </Text>
    ) : (
      part.text
    )
  )
}
