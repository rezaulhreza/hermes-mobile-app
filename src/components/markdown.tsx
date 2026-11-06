import { createContext, memo, useContext, useMemo, useState } from 'react'
import { Image, Linking, ScrollView, type StyleProp, StyleSheet, Text, type TextStyle, View } from 'react-native'

import { type CodeTokenKind, highlightCode } from '@/core/highlight'
import { type Block, columnWidths, parseMarkdown, type Span } from '@/core/markdown'
import type { TextPart } from '@/core/mentions'
import { answerSources, cardLines } from '@/core/sources'
import { fade, lineOf, MONO, type Palette, radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { DraftCard } from './draft-card'
import { InfoCardView } from './info-card'
import { MentionText } from './mention-text'
import { RenderedBlock } from './render/rendered-block'
import { OpenSource, SourcePill, SourcesSheet } from './sources'

const THUMB = 56
const HEADING_SIZE = { 1: 22, 2: 19, 3: 17 } as const

/** Splits the words of an answer into plain text and the mentions that reach a bot. */
type MentionSplit = (text: string) => readonly TextPart[]

const Mentions = createContext<MentionSplit | null>(null)

/**
 * An answer, drawn from its Markdown. The parse runs again on every streamed
 * delta, so it is memoised on the text and the blocks are keyed by position:
 * while an answer streams, only its last block changes. With `mentions`, the
 * names of bots in its words have the colour of a mention. Code keeps its own.
 */
export const Markdown = memo(function Markdown({ text, muted = false, mentions = null }: { text: string; muted?: boolean; mentions?: MentionSplit | null }) {
  const blocks = useMemo(() => parseMarkdown(text), [text])
  // The address of the source that was tapped, while the list of sources is up.
  const [source, setSource] = useState<string | null>(null)

  return (
    <OpenSource.Provider value={setSource}>
      <Mentions.Provider value={mentions}>
        <View style={styles.blocks}>
          {blocks.map((block, index) => (
            <BlockView after={blocks[index - 1]?.kind} block={block} key={index} muted={muted} />
          ))}
        </View>
      </Mentions.Provider>
      {source ? <SourcesSheet at={source} onClose={() => setSource(null)} sources={answerSources(blocks)} /> : null}
    </OpenSource.Provider>
  )
})

function BlockView({ block, muted, after }: { block: Block; muted: boolean; /** The kind of the block before this one. */ after?: Block['kind'] }) {
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
            <CodeText language={block.language} style={styles.codeText} text={block.text} />
          </ScrollView>
        </View>
      )

    case 'math':
    case 'diagram':
      // A block still streaming shows its source: drawing half a diagram would flash a fault.
      return block.done ? (
        <RenderedBlock kind={block.kind} source={block.kind === 'math' ? block.tex : block.code} />
      ) : (
        <View style={[styles.code, { backgroundColor: t.soft }]}>
          <Text style={[styles.language, { color: t.muted }]}>{block.kind === 'math' ? 'math' : 'mermaid'}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text style={[styles.codeText, { color: t.ink }]}>{block.kind === 'math' ? block.tex : block.code}</Text>
          </ScrollView>
        </View>
      )

    case 'table':
      return <Table colour={colour} table={block} />

    case 'rule':
      return <View style={[styles.rule, { backgroundColor: t.line }]} />

    case 'image':
      return <Image accessibilityLabel={block.picture.alt} resizeMode="cover" source={{ uri: block.picture.url }} style={[styles.picture, { backgroundColor: t.soft }]} />

    case 'draft':
      return <DraftCard draft={block.draft} />

    case 'info':
      return <InfoCardView card={block.card} />

    case 'card':
      return <Card card={block} colour={colour} first={after !== 'card'} />
  }
}

/** One result: its picture at the left, its words at the right. Results that follow each other have a line between them and no box. */
function Card({ card, colour, first }: { card: Extract<Block, { kind: 'card' }>; colour: string; first: boolean }) {
  const t = useTheme()
  const lines = useMemo(() => cardLines(card.lines), [card.lines])

  return (
    <View style={[styles.card, !first && { borderTopColor: fade(t.ink, 0.08), borderTopWidth: 1 }]}>
      <Image accessibilityLabel={card.picture.alt} resizeMode="cover" source={{ uri: card.picture.url }} style={styles.cardPicture} />
      <View style={styles.cardWords}>
        {lines.map((line, index) =>
          line.role === 'label' ? (
            <View key={index} style={[styles.status, { backgroundColor: fade(t.green, 0.15) }]}>
              <Text style={[type.small, styles.strong, { color: t.green }]}>{line.spans.map(span => span.text).join('')}</Text>
            </View>
          ) : (
            <Text key={index} selectable style={[type.body, { color: colour }, line.role === 'title' && styles.strong, line.role === 'price' && styles.price]}>
              <Spans spans={line.spans} />
            </Text>
          )
        )}
      </View>
    </View>
  )
}

/** A table scrolls sideways: a phone is narrower than most tables, and a squeezed column cannot be read. */
function Table({ table, colour }: { table: Extract<Block, { kind: 'table' }>; colour: string }) {
  const t = useTheme()
  const widths = useMemo(() => columnWidths(table), [table])

  const row = (cells: readonly (readonly Span[])[], key: number | string, head: boolean) => (
    <View key={key} style={[styles.tableRow, { borderTopColor: t.line }, head ? { backgroundColor: t.soft } : styles.tableLine]}>
      {cells.map((cell, column) => {
        const picture = cell.find(span => span.kind === 'image')

        // A cell that holds only a picture shows the picture, not its words.
        if (picture && cell.every(span => span.kind === 'image' || !span.text.trim())) {
          return (
            <View key={column} style={[styles.cell, { width: widths[column] }]}>
              <Image accessibilityLabel={picture.text} resizeMode="cover" source={{ uri: picture.url }} style={[styles.thumb, { backgroundColor: t.soft }]} />
            </View>
          )
        }

        return (
          <Text
            key={column}
            selectable
            style={[type.small, styles.cell, { width: widths[column], color: colour, textAlign: table.align[column] }, head && styles.strong]}
          >
            <Spans spans={cell} />
          </Text>
        )
      })}
    </View>
  )

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.table, { borderColor: t.line }]}>
      <View>
        {row(table.header, 'head', true)}
        {table.rows.map((cells, index) => row(cells, index, false))}
      </View>
    </ScrollView>
  )
}

function Spans({ spans }: { spans: readonly Span[] }) {
  const t = useTheme()
  const split = useContext(Mentions)
  const words = (text: string, key?: number) => (split ? <MentionText key={key} parts={split(text)} /> : text)

  return (
    <>
      {spans.map((span, index) => {
        switch (span.kind) {
          case 'text':
            return words(span.text, index)
          case 'strong':
            return (
              <Text key={index} style={styles.strong}>
                {words(span.text)}
              </Text>
            )
          case 'em':
            return (
              <Text key={index} style={styles.em}>
                {words(span.text)}
              </Text>
            )
          case 'code':
            return (
              <Text key={index} style={[styles.inlineCode, { backgroundColor: t.soft }]}>
                {span.text}
              </Text>
            )
          case 'link':
            // The colour of the words around it: the dotted line and the arrow say "link".
            return (
              <Text accessibilityRole="link" key={index} onPress={() => void Linking.openURL(span.url)}>
                <Text style={[styles.link, span.bold && styles.strong]}>{span.text}</Text>
                <Text style={styles.arrow}>{'\u202F\u2197'}</Text>
              </Text>
            )
          case 'source':
            return <SourcePill key={index} links={span.links} />
          case 'image':
            // A picture in the middle of a sentence has no place in a line of text. Its words stand for it.
            return span.text
          case 'math':
            // Typeset math cannot stand in a line of text: the TeX as the characters it means.
            return (
              <Text accessibilityLabel={span.tex} key={index} style={styles.math}>
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
  codeText: { fontFamily: MONO, fontSize: 13, lineHeight: lineOf(19), padding: space.md },
  inlineCode: { fontFamily: MONO, fontSize: 14 },
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  math: { fontFamily: 'Georgia', fontStyle: 'italic' },
  link: { textDecorationLine: 'underline', textDecorationStyle: 'dotted' },
  arrow: { fontSize: 11 },
  rule: { height: StyleSheet.hairlineWidth },
  picture: { width: '100%', aspectRatio: 4 / 3, borderRadius: 14 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md },
  cardPicture: { width: '36%', aspectRatio: 4 / 3, borderRadius: 14, backgroundColor: '#ffffff' },
  cardWords: { flex: 1, gap: space.xs },
  price: { fontSize: 18, fontWeight: '700' },
  status: { alignSelf: 'flex-start', paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill },
  table: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, flexGrow: 0 },
  tableRow: { flexDirection: 'row' },
  tableLine: { borderTopWidth: StyleSheet.hairlineWidth },
  cell: { paddingHorizontal: space.md, paddingVertical: space.sm },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.sm }
})

const CODE_COLOUR: Record<CodeTokenKind, keyof Palette> = { plain: 'ink', comment: 'muted', string: 'green', number: 'red', keyword: 'accent' }

/** Code with colour. The scan runs once for a text, not on every draw of the list. */
export function CodeText({ text, language, style }: { text: string; language: string | null; style: StyleProp<TextStyle> }) {
  const t = useTheme()
  const tokens = useMemo(() => highlightCode(text, language), [text, language])

  return (
    <Text selectable style={[style, { color: t.ink }]}>
      {tokens.map((token, index) =>
        token.kind === 'plain' ? (
          token.text
        ) : (
          <Text key={index} style={{ color: t[CODE_COLOUR[token.kind]] }}>
            {token.text}
          </Text>
        )
      )}
    </Text>
  )
}
