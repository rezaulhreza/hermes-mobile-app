import { useState } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'

import { AVATAR_COLOURS, AVATAR_SHAPES, type Look, paint } from '@/core/avatars'
import { space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { BotFace } from './bot-face'
import { SheetFrame } from './bot-sheet'
import { Button } from './ui'

const SHAPE_NAME = { circle: 'Circle', squircle: 'Soft square', pill: 'Pill', triangle: 'Triangle', hexagon: 'Hexagon', cloud: 'Cloud', drop: 'Drop' } as const
const COLOUR_NAME = ['Red', 'Orange', 'Yellow', 'Lime', 'Green', 'Mint', 'Teal', 'Sky', 'Blue', 'Violet', 'Purple', 'Pink']

/**
 * The avatar of a bot: a shape and a colour from the set the desktop app has
 * too, or a photo of the phone. The face at the top shows the choice as it
 * is made. Nothing is saved until the user says so.
 */
export function AvatarSheet({ start, photo, busy, onUse, onPhoto, onClose }: { /** The look to start from: the one the bot has. */ start: Look; /** The photo the bot has now, when it has one. */ photo?: string | null; busy: boolean; onUse: (look: Look) => void; onPhoto: () => void; onClose: () => void }) {
  const t = useTheme()
  const [look, setLook] = useState(start)
  // A bot with a photo shows the photo until the user touches a shape or a colour.
  const [drawn, setDrawn] = useState(!photo)
  const change = (next: Look) => (setLook(next), setDrawn(true))

  return (
    <SheetFrame onClose={onClose} title="Avatar">
      <View style={styles.preview}>{drawn || !photo ? <BotFace look={look} size={112} /> : <Image accessibilityIgnoresInvertColors source={{ uri: photo }} style={styles.photo} />}</View>

      <Text style={[type.small, { color: t.muted, fontWeight: '600' }]}>Shape</Text>
      <View accessibilityRole="radiogroup" style={styles.grid}>
        {AVATAR_SHAPES.map(shape => {
          const checked = drawn && look.shape === shape

          return (
            <Pressable
              accessibilityLabel={SHAPE_NAME[shape]}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              key={shape}
              onPress={() => change({ ...look, shape })}
              style={[styles.shape, { borderColor: checked ? t.ink : t.line, backgroundColor: t.paper }, checked && styles.checked]}
            >
              <BotFace look={{ ...look, shape }} size={44} />
            </Pressable>
          )
        })}
      </View>

      <Text style={[type.small, { color: t.muted, fontWeight: '600' }]}>Colour</Text>
      <View accessibilityRole="radiogroup" style={styles.grid}>
        {AVATAR_COLOURS.map((color, index) => {
          const checked = drawn && look.color === color

          return (
            <Pressable
              accessibilityLabel={COLOUR_NAME[index]}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              hitSlop={4}
              key={color}
              onPress={() => change({ ...look, color })}
              style={[styles.swatch, { borderColor: checked ? t.ink : 'transparent' }]}
            >
              <View style={[styles.colour, { backgroundColor: paint(color) }]} />
            </Pressable>
          )
        })}
      </View>

      <Button busy={busy} disabled={!drawn} label="Use this avatar" onPress={() => onUse(look)} tone="primary" />
      <Button disabled={busy} icon="image" label={photo ? 'Choose another photo' : 'Use a photo'} onPress={onPhoto} />
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', paddingVertical: space.md },
  photo: { width: 112, height: 112, borderRadius: 56 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  shape: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  checked: { borderWidth: 2 },
  swatch: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 2 },
  colour: { width: 32, height: 32, borderRadius: 16 }
})
