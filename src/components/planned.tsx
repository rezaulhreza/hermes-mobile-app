import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

/** A tab whose screens are not built yet. It names what will be there. See docs/CONTRIBUTING.md. */
export function Planned({ title, items }: { title: string; items: string[] }) {
  const t = useTheme()

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[type.title, { color: t.ink }]}>{title}</Text>
        <Text style={[type.body, { color: t.muted }]}>Not built yet. Planned here:</Text>
        <View style={styles.list}>
          {items.map(item => (
            <Text key={item} style={[type.body, { color: t.ink }]}>
              {item}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.lg, gap: space.md },
  list: { gap: space.sm }
})
