import { useEffect, useState } from 'react'
import { Animated, Easing, StyleSheet, View } from 'react-native'

import { useTheme } from '@/theme/use-theme'

const DOTS = [0, 1, 2]
const STEP_MS = 160
const BEAT_MS = 420

/**
 * The mark of a running turn: three dots that rise in turn. It stands where
 * the host's drawn face was. The animation runs on the native side, so it
 * costs no JavaScript frame, and it stops when the mark leaves the screen.
 */
export function WorkingMark() {
  const t = useTheme()
  const [beats] = useState(() => DOTS.map(() => new Animated.Value(0)))

  useEffect(() => {
    const loop = Animated.loop(
      Animated.stagger(
        STEP_MS,
        beats.map(beat =>
          Animated.sequence([
            Animated.timing(beat, { toValue: 1, duration: BEAT_MS, easing: Easing.out(Easing.quad), useNativeDriver: true }),
            Animated.timing(beat, { toValue: 0, duration: BEAT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true })
          ])
        )
      )
    )

    loop.start()

    return () => loop.stop()
  }, [beats])

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.row}>
      {beats.map((beat, index) => (
        <Animated.View
          key={index}
          style={[
            styles.dot,
            {
              backgroundColor: t.accent,
              opacity: beat.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
              transform: [{ translateY: beat.interpolate({ inputRange: [0, 1], outputRange: [1.5, -1.5] }) }]
            }
          ]}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 12 },
  dot: { width: 5, height: 5, borderRadius: 2.5 }
})
