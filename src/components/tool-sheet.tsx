import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { duration } from '@/core/format'
import { diffLines, type DiffLineKind, type ToolDetail, toolPicture } from '@/core/tools'
import { loadToolOutput } from '@/store/chat'
import { localCopy } from '@/store/preview'
import { lineOf, MONO, type Palette, radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton } from './ui'

export interface ToolTarget extends ToolDetail {
  toolId: string
  name: string
  state: 'running' | 'done'
  durationS?: number
}

/** One tool call, opened: what the agent asked for, what changed, and what came back. */
export function ToolSheet({ tool, storedId, profile, onClose }: { tool: ToolTarget | null; storedId: string | undefined; /** The bot of the session, when the session is not open as a chat. */ profile?: string; onClose: () => void }) {
  if (!tool) {
    return null
  }

  return <Sheet key={tool.toolId} onClose={onClose} profile={profile} storedId={storedId} tool={tool} />
}

function Sheet({ tool, storedId, profile, onClose }: { tool: ToolTarget; storedId: string | undefined; profile?: string; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const [fetched, setFetched] = useState<string | null>(null)
  // A tool row from stored history has no output yet. Get it when the sheet opens.
  const missing = tool.state === 'done' && !tool.output && Boolean(storedId)
  const [loading, setLoading] = useState(missing)
  const output = tool.output ?? fetched
  // A stored row has the path of its capture only in its output.
  const picture = tool.picture ?? toolPicture(null, fetched)
  const [pictureUri, setPictureUri] = useState<string | null>(null)
  // The shape of the capture once it loads. Until then nothing shows: a capture that fails to load leaves no empty frame.
  const [pictureShape, setPictureShape] = useState<number | null>(null)

  useEffect(() => {
    if (!picture) {
      return
    }

    let cancelled = false

    localCopy({ name: picture.split(/[\\/]/).pop() ?? 'capture', kind: 'image', path: picture })
      .then(uri => !cancelled && setPictureUri(uri))
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [picture])

  useEffect(() => {
    if (!missing || !storedId) {
      return
    }

    let cancelled = false

    loadToolOutput(storedId, tool.toolId, profile)
      .then(text => !cancelled && setFetched(text ?? null))
      .catch(() => undefined)
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [missing, storedId, tool.toolId, profile])

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <View style={styles.fill}>
            <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
              {tool.name}
            </Text>
            <Text style={[type.small, { color: t.muted }]}>
              {tool.state === 'running' ? 'Running…' : tool.durationS !== undefined ? `Done in ${duration(tool.durationS)}` : 'Done'}
            </Text>
          </View>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xl }]}>
          {pictureUri ? (
            <Image
              accessibilityLabel="The capture of the screen"
              onError={() => setPictureUri(null)}
              onLoad={event => {
                const { width, height } = event.nativeEvent.source

                setPictureShape(width > 0 && height > 0 ? width / height : 16 / 10)
              }}
              resizeMode="contain"
              source={{ uri: pictureUri }}
              style={[styles.picture, pictureShape ? { aspectRatio: pictureShape } : styles.unloaded]}
            />
          ) : null}
          {tool.input ? <Section text={tool.input} title="Input" /> : null}
          {tool.diff ? <Section diff text={tool.diff} title="Changes" /> : null}
          {output ? (
            <Section text={output} title="Output" />
          ) : tool.state === 'running' ? (
            <Text style={[type.small, { color: t.muted }]}>The output shows here when the tool is done.</Text>
          ) : loading ? (
            <ActivityIndicator color={t.muted} />
          ) : (
            <Text style={[type.small, { color: t.muted }]}>This tool gave no output.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}

function diffColour(kind: DiffLineKind, t: Palette): string {
  return kind === 'add' ? t.green : kind === 'remove' ? t.red : kind === 'context' ? t.ink : t.muted
}

function Section({ title, text, diff = false }: { title: string; text: string; diff?: boolean }) {
  const t = useTheme()
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void Clipboard.setStringAsync(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[type.small, styles.fill, { color: t.muted, fontWeight: '700' }]}>{title}</Text>
        <Pressable accessibilityLabel={`Copy the ${title.toLowerCase()}`} accessibilityRole="button" hitSlop={12} onPress={copy}>
          <Text style={[type.small, { color: t.accent, fontWeight: '700' }]}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      {/* Like code: it scrolls sideways, because a wrapped line loses its shape. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.box, { backgroundColor: t.soft }]}>
        {diff ? (
          <View style={styles.pad}>
            {diffLines(text).map((line, index) => (
              <Text key={index} selectable style={[styles.mono, { color: diffColour(line.kind, t) }]}>
                {line.text || ' '}
              </Text>
            ))}
          </View>
        ) : (
          <Text selectable style={[styles.mono, styles.pad, { color: t.ink }]}>
            {text}
          </Text>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  picture: { width: '100%', borderRadius: radius.md },
  // Laid out but not seen until the capture loads and gives its shape.
  unloaded: { height: 1, opacity: 0 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    paddingLeft: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  body: { padding: space.lg, gap: space.lg },
  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  box: { borderRadius: radius.md },
  pad: { padding: space.md },
  mono: { fontFamily: MONO, fontSize: 12, lineHeight: lineOf(18) }
})
