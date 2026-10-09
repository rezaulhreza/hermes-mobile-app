import { memo, useMemo } from 'react'
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native'

import { type Block, parseMarkdown, type Span } from '@/core/markdown'
import { radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' })
const HEADING_SIZE = { 1: 22, 2: 19, 3: 17 } as const

/**
 * An answer, drawn from its Markdown. The parse runs again on every streamed
 * delta, so it is memoised on the text and the blocks are keyed by position:
 * while an answer streams, only its last block changes.
 */
export const Markdown = memo(function Markdown({ text, muted = false }: { text: string; muted?: boolean }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])

  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) => (
        <BlockView block={block} key={index} muted={muted} />
      ))}
    </View>
  )
})

function BlockView({ block, muted }: { block: Block; muted: boolean }) {
  const t = useTheme()
  const colour = muted ? t.muted : t.ink

  switch (block.kind) {
    case 'heading':
      return (
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: colour, fontSize: HEADING_SIZE[block.level], fontWeight: '700', marginTop: space.xs }}
        >
          <Spans spans={block.spans} />
        </Text>
      )

    case 'paragraph':
      return (
        <Text selectable style={[type.body, { color: colour }]}>
          <Spans spans={block.spans} />
        </Text>
      )

    case 'quote':
      return (
        <View style={[styles.quote, { borderLeftColor: t.line }]}>
          <Text selectable style={[type.body, { color: t.muted }]}>
            <Spans spans={block.spans} />
          </Text>
        </View>
      )

    case 'item':
      return (
        <View style={[styles.item, { paddingLeft: block.depth * space.lg }]}>
          <Text style={[type.body, styles.marker, { color: t.muted }]}>{block.marker}</Text>
          <Text selectable style={[type.body, styles.fill, { color: colour }]}>
            <Spans spans={block.spans} />
          </Text>
        </View>
      )

    case 'code':
      return (
        <View style={[styles.code, { backgroundColor: t.soft }]}>
          {block.language ? <Text style={[styles.language, { color: t.muted }]}>{block.language}</Text> : null}
          {/* Code scrolls sideways: wrapping it would break its indentation. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={[styles.codeText, { color: t.ink }]}>
              {block.text}
            </Text>
          </ScrollView>
        </View>
      )

    case 'rule':
      return <View style={[styles.rule, { backgroundColor: t.line }]} />
  }
}

function Spans({ spans }: { spans: readonly Span[] }) {
  const t = useTheme()

  return (
    <>
      {spans.map((span, index) => {
        switch (span.kind) {
          case 'text':
            return span.text
          case 'strong':
            return (
              <Text key={index} style={styles.strong}>
                {span.text}
              </Text>
            )
          case 'em':
            return (
              <Text key={index} style={styles.em}>
                {span.text}
              </Text>
            )
          case 'code':
            return (
              <Text key={index} style={[styles.inlineCode, { backgroundColor: t.soft }]}>
                {span.text}
              </Text>
            )
          case 'link':
            return (
              <Text
                accessibilityRole="link"
                key={index}
                onPress={() => void Linking.openURL(span.url)}
                style={{ color: t.accent, textDecorationLine: 'underline' }}
              >
                {span.text}
              </Text>
            )
        }
      })}
    </>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  blocks: { gap: space.md },
  quote: { borderLeftWidth: 3, paddingLeft: space.md },
  item: { flexDirection: 'row', gap: space.sm, marginTop: -space.xs },
  marker: { minWidth: 16 },
  code: { borderRadius: radius.md, overflow: 'hidden' },
  language: { fontSize: 12, fontWeight: '600', paddingHorizontal: space.md, paddingTop: space.sm },
  codeText: { fontFamily: MONO, fontSize: 13, lineHeight: 19, padding: space.md },
  inlineCode: { fontFamily: MONO, fontSize: 14 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  rule: { height: StyleSheet.hairlineWidth }
})
