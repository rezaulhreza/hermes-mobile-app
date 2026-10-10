import { Feather } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

import { fileGlyph, isMarkdown, previewMode, previewText, type SentAttachment } from '@/core/attachments'
import { fileSize } from '@/core/format'
import { localCopy, readText } from '@/store/preview'
import { MONO, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { GLYPH_ICON } from './attachments'
import { Markdown } from './markdown'
import { IconButton, Notice } from './ui'

export interface ViewerTarget {
  items: readonly SentAttachment[]
  index: number
}

interface Props {
  /** What to show. Null closes the viewer. */
  target: ViewerTarget | null
  onClose: () => void
}

/**
 * Opens an attachment. An image fills the screen, on black, with pinch to
 * zoom and a swipe to the other images of the same message. Any other file
 * opens in a sheet: a document is something to read and then put away.
 */
export function AttachmentViewer({ target, onClose }: Props) {
  const item = target?.items[target.index]

  if (!target || !item) {
    return null
  }

  if (previewMode(item.name, item.kind) === 'image') {
    const pictures = target.items.filter(other => previewMode(other.name, other.kind) === 'image')

    return <Pictures first={pictures.indexOf(item)} onClose={onClose} pictures={pictures} />
  }

  return <FileSheet item={item} onClose={onClose} />
}

type Copy = { state: 'loading' } | { state: 'ready'; uri: string } | { state: 'failed'; reason: string }

/** The copy of the file on the phone. A file from stored history downloads first. */
function useLocalCopy(item: SentAttachment): Copy {
  const [copy, setCopy] = useState<Copy>(item.uri ? { state: 'ready', uri: item.uri } : { state: 'loading' })

  useEffect(() => {
    let cancelled = false

    localCopy(item)
      .then(uri => !cancelled && setCopy({ state: 'ready', uri }))
      .catch(error => !cancelled && setCopy({ state: 'failed', reason: error instanceof Error ? error.message : String(error) }))

    return () => {
      cancelled = true
    }
  }, [item])

  return copy
}

function share(uri: string): void {
  // The share sheet takes a file address on iOS only.
  void Share.share({ url: uri }).catch(() => undefined)
}

const CAN_SHARE = Platform.OS === 'ios'
// A pull down past this distance, with no zoom, closes the picture.
const PULL_TO_CLOSE = 90

function Pictures({ pictures, first, onClose }: { pictures: SentAttachment[]; first: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [index, setIndex] = useState(first)
  const current = pictures[index] ?? pictures[0]

  const onPage = (event: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <View style={styles.dark}>
        <FlatList
          data={pictures}
          getItemLayout={(_, at) => ({ length: width, offset: width * at, index: at })}
          horizontal
          initialScrollIndex={first}
          keyExtractor={(picture, at) => `${picture.uri ?? picture.path}:${at}`}
          onMomentumScrollEnd={onPage}
          pagingEnabled
          renderItem={({ item }) => <Picture height={height} item={item} onClose={onClose} width={width} />}
          showsHorizontalScrollIndicator={false}
        />
        <View style={[styles.bar, { paddingTop: insets.top + space.xs }]}>
          <IconButton icon="x" label="Close" onPress={onClose} />
          <View style={styles.fill}>
            <Text numberOfLines={1} style={[type.label, styles.light]}>
              {current.name}
            </Text>
            <Text style={[type.small, styles.faint]}>
              {[pictures.length > 1 ? `${index + 1} of ${pictures.length}` : '', current.size ? fileSize(current.size) : ''].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {CAN_SHARE && current.uri ? <IconButton icon="share" label="Share" onPress={() => share(current.uri ?? '')} /> : null}
        </View>
      </View>
    </Modal>
  )
}

function Picture({ item, width, height, onClose }: { item: SentAttachment; width: number; height: number; onClose: () => void }) {
  const copy = useLocalCopy(item)
  const zoomed = useRef(false)

  if (copy.state !== 'ready') {
    return (
      <View style={[styles.center, { width, height }]}>
        {copy.state === 'loading' ? <ActivityIndicator color="#fff" /> : <Text style={[type.body, styles.light, styles.reason]}>{copy.reason}</Text>}
      </View>
    )
  }

  return (
    <ScrollView
      alwaysBounceVertical
      centerContent
      maximumZoomScale={4}
      minimumZoomScale={1}
      onScroll={event => {
        zoomed.current = event.nativeEvent.zoomScale > 1.01
      }}
      onScrollEndDrag={event => {
        if (!zoomed.current && event.nativeEvent.contentOffset.y < -PULL_TO_CLOSE) {
          onClose()
        }
      }}
      scrollEventThrottle={32}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      style={{ width, height }}
    >
      <Image accessibilityLabel={item.name} resizeMode="contain" source={{ uri: copy.uri }} style={{ width, height }} />
    </ScrollView>
  )
}

function FileSheet({ item, onClose }: { item: SentAttachment; onClose: () => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const copy = useLocalCopy(item)
  const mode = previewMode(item.name, item.kind)

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <Feather color={t.muted} name={GLYPH_ICON[fileGlyph(item.name, item.kind)]} size={22} />
          <View style={styles.fill}>
            <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
              {item.name}
            </Text>
            {item.size ? <Text style={[type.small, { color: t.muted }]}>{fileSize(item.size)}</Text> : null}
          </View>
          {CAN_SHARE && copy.state === 'ready' ? <IconButton icon="share" label="Share" onPress={() => share(copy.uri)} /> : null}
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>

        {copy.state === 'loading' ? (
          <View style={styles.center}>
            <ActivityIndicator color={t.muted} />
          </View>
        ) : copy.state === 'failed' ? (
          <Notice detail={copy.reason} icon="alert-triangle" title="Could not open this file" />
        ) : mode === 'web' ? (
          <WebView
            allowFileAccess
            allowingReadAccessToURL={copy.uri}
            originWhitelist={['*']}
            source={{ uri: copy.uri }}
            style={[styles.fill, { backgroundColor: t.bg }]}
          />
        ) : mode === 'text' ? (
          <TextPreview bottom={insets.bottom} name={item.name} uri={copy.uri} />
        ) : (
          <Notice
            detail={CAN_SHARE ? 'Use the share button to open it in another app.' : undefined}
            icon="file"
            title="The phone has no preview for this type of file"
          />
        )}
      </View>
    </Modal>
  )
}

function TextPreview({ uri, name, bottom }: { uri: string; name: string; bottom: number }) {
  const t = useTheme()
  const [loaded, setLoaded] = useState<{ text: string; cut: boolean } | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false

    readText(uri)
      .then(text => !cancelled && setLoaded(previewText(text)))
      .catch(() => !cancelled && setFailed(true))

    return () => {
      cancelled = true
    }
  }, [uri])

  if (failed) {
    return <Notice icon="alert-triangle" title="Could not read this file as text" />
  }

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.muted} />
      </View>
    )
  }

  return (
    <ScrollView contentContainerStyle={[styles.text, { paddingBottom: bottom + space.xl }]}>
      {isMarkdown(name) ? (
        <Markdown text={loaded.text} />
      ) : (
        <Text selectable style={[styles.mono, { color: t.ink }]}>
          {loaded.text}
        </Text>
      )}
      {loaded.cut ? <Text style={[type.small, { color: t.muted }]}>The preview stops here. Share the file to read the rest.</Text> : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  dark: { flex: 1, backgroundColor: '#000' },
  light: { color: '#fff' },
  faint: { color: 'rgba(255,255,255,0.7)' },
  reason: { textAlign: 'center', padding: space.xl },
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    backgroundColor: 'rgba(0,0,0,0.45)'
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    paddingLeft: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth
  },
  text: { padding: space.lg, gap: space.md },
  mono: { fontFamily: MONO, fontSize: 13, lineHeight: 19 }
})
