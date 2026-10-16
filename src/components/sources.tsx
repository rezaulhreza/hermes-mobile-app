import { createContext, useContext, useState } from 'react'
import { FlatList, Image, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { siteIconUrl, siteName, type Source } from '@/core/sources'
import { fade, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton } from './ui'

/** Opens the list of sources of the answer at one address. An answer gives it to the pills in its text. */
export const OpenSource = createContext<(url: string) => void>(url => void Linking.openURL(url))

const PILL_NAME_MAX = 12

/** The icon of a site in a circle. A site with no icon shows its first letter. */
export function SiteIcon({ url, size }: { url: string; size: number }) {
  const t = useTheme()
  const [failed, setFailed] = useState(false)
  const shape = { width: size, height: size, borderRadius: size / 2 }

  if (failed) {
    return (
      <View style={[styles.letter, shape, { backgroundColor: fade(t.ink, 0.18) }]}>
        <Text style={{ color: t.ink, fontSize: size * 0.6, fontWeight: '700', lineHeight: size }}>{siteName(url).charAt(0).toUpperCase()}</Text>
      </View>
    )
  }

  return <Image accessibilityIgnoresInvertColors onError={() => setFailed(true)} source={{ uri: siteIconUrl(url) }} style={[shape, { backgroundColor: '#ffffff' }]} />
}

/** A source in the line of the text: the icon and the name of the site. A tap opens the list of sources at this one. */
export function SourcePill({ links }: { links: readonly { text: string; url: string }[] }) {
  const t = useTheme()
  const open = useContext(OpenSource)
  const first = links[0]
  const name = first.text.length > PILL_NAME_MAX ? `${first.text.slice(0, PILL_NAME_MAX - 1).trimEnd()}…` : first.text

  return (
    <View style={styles.pillLine}>
      <Pressable
        accessibilityLabel={links.length > 1 ? `Source: ${first.text} and ${links.length - 1} more` : `Source: ${first.text}`}
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => open(first.url)}
        style={({ pressed }) => [styles.pill, { backgroundColor: fade(t.ink, pressed ? 0.2 : 0.12) }]}
      >
        <SiteIcon size={14} url={first.url} />
        <Text numberOfLines={1} style={[styles.pillName, { color: t.muted }]}>
          {name}
        </Text>
        {links.length > 1 ? <Text style={[styles.pillName, { color: fade(t.muted, 0.7) }]}>+{links.length - 1}</Text> : null}
      </Pressable>
    </View>
  )
}

const STACK = 3

/** Under an answer: the icons of its first sources, one over the edge of the next, and the word. */
export function SourcesButton({ sources, onPress }: { sources: readonly Source[]; onPress: () => void }) {
  const t = useTheme()

  return (
    <Pressable accessibilityLabel={`Sources: ${sources.length}`} accessibilityRole="button" hitSlop={10} onPress={onPress} style={styles.button}>
      <View style={styles.stack}>
        {sources.slice(0, STACK).map((source, index) => (
          <View key={source.url} style={[styles.stacked, { borderColor: t.bg, marginLeft: index ? -6 : 0, zIndex: STACK - index }]}>
            <SiteIcon size={18} url={source.url} />
          </View>
        ))}
      </View>
      <Text style={[type.small, { color: t.muted }]}>Sources</Text>
    </Pressable>
  )
}

/** Every source of an answer as a sheet. `at` is the source the person tapped: it is marked. A tap on a row opens the page. */
export function SourcesSheet({ sources, at, onClose }: { sources: readonly Source[]; at?: string | null; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Sources</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <FlatList
          data={sources}
          keyExtractor={source => source.url}
          renderItem={({ item }) => (
            <Pressable
              accessibilityHint="Opens the page"
              accessibilityLabel={`${item.title}, ${item.site}`}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(item.url)}
              style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, (pressed || item.url === at) && { backgroundColor: t.soft }]}
            >
              <SiteIcon size={28} url={item.url} />
              <View style={styles.fill}>
                <Text numberOfLines={1} style={[type.label, { color: t.ink, fontWeight: '700' }]}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                  {item.site}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  letter: { alignItems: 'center', justifyContent: 'center' },
  // The pill is taller than a line of text: it sits a little low, so its middle is the middle of the words.
  pillLine: { height: 18, justifyContent: 'center', paddingLeft: 6 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingLeft: 5, paddingRight: 9, borderRadius: 12 },
  pillName: { fontSize: 13, fontWeight: '500' },
  button: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  stack: { flexDirection: 'row' },
  stacked: { borderRadius: 11, borderWidth: 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 16, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth }
})
