import { Feather } from '@expo/vector-icons'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'

import type { IconName } from '@/components/ui'
import { type Attachment, type FileGlyph, fileGlyph, type SentAttachment } from '@/core/attachments'
import { fileSize } from '@/core/format'
import { radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export const GLYPH_ICON: Record<FileGlyph, IconName> = {
  image: 'image',
  text: 'file-text',
  video: 'film',
  audio: 'music',
  archive: 'archive',
  code: 'code',
  file: 'file'
}

const STAGED_SIZE = 56
const SENT_SIZE = 96
const SENT_ALONE_SIZE = 184

/**
 * One staged attachment above the composer. An image shows itself; a file
 * shows an icon for its type, its name and its size. A failed one stays, with
 * its reason, until the user removes it.
 */
export function StagedAttachment({ item, onRemove, onOpen }: { item: Attachment; onRemove: () => void; onOpen: () => void }) {
  const t = useTheme()
  const failed = item.state === 'failed'
  const uploading = item.state === 'uploading'
  // A picture shows itself. Every other file shows an icon.
  const picture = item.kind === 'image' && item.uri && !failed ? item.uri : null

  const remove = (
    <Pressable
      accessibilityLabel={`Remove ${item.name}`}
      accessibilityRole="button"
      hitSlop={12}
      onPress={onRemove}
      style={picture ? [styles.badge, { backgroundColor: t.ink }] : undefined}
    >
      <Feather color={picture ? t.bg : failed ? t.red : t.muted} name="x" size={picture ? 12 : 16} />
    </Pressable>
  )

  if (picture) {
    return (
      <View style={styles.thumbBox}>
        <Pressable accessibilityHint="Opens the picture" accessibilityLabel={uploading ? `${item.name}, uploading` : item.name} accessibilityRole="imagebutton" onPress={onOpen}>
          <Image source={{ uri: picture }} style={[styles.thumb, { backgroundColor: t.soft }, uploading && styles.dim]} />
          {uploading ? <ActivityIndicator color={t.ink} size="small" style={StyleSheet.absoluteFill} /> : null}
        </Pressable>
        {remove}
      </View>
    )
  }

  return (
    <Pressable
      accessibilityHint={failed ? undefined : 'Opens a preview'}
      accessibilityLabel={failed ? item.error : item.name}
      accessibilityRole="button"
      disabled={failed}
      onPress={onOpen}
      style={[styles.chip, { backgroundColor: failed ? t.redBg : t.soft }]}
    >
      {uploading ? (
        <ActivityIndicator color={t.muted} size="small" />
      ) : (
        <Feather color={failed ? t.red : t.muted} name={failed ? 'alert-triangle' : GLYPH_ICON[fileGlyph(item.name, item.kind)]} size={18} />
      )}
      <View style={styles.shrink}>
        <Text numberOfLines={1} style={[type.small, { color: failed ? t.red : t.ink, fontWeight: '600' }]}>
          {failed ? item.error : item.name}
        </Text>
        {!failed && item.size ? <Text style={[type.small, { color: t.muted }]}>{fileSize(item.size)}</Text> : null}
      </View>
      {remove}
    </Pressable>
  )
}

/** The attachments of a sent message, inside its bubble: pictures first, then one row per file. */
export function SentAttachments({ items, onOpen }: { items: readonly SentAttachment[]; onOpen: (index: number) => void }) {
  const t = useTheme()
  const pictures = items.filter(item => item.kind === 'image' && item.uri)
  const files = items.filter(item => !pictures.includes(item))
  const side = pictures.length === 1 ? SENT_ALONE_SIZE : SENT_SIZE

  return (
    <View style={styles.sent}>
      {pictures.length ? (
        <View style={styles.pictures}>
          {pictures.map((item, index) => (
            <Pressable
              accessibilityHint="Opens the picture"
              accessibilityLabel={item.name}
              accessibilityRole="imagebutton"
              key={`${item.uri}:${index}`}
              onPress={() => onOpen(items.indexOf(item))}
            >
              <Image source={{ uri: item.uri }} style={[styles.picture, { width: side, height: side, backgroundColor: t.line }]} />
            </Pressable>
          ))}
        </View>
      ) : null}
      {files.map((item, index) => (
        <Pressable
          accessibilityHint="Opens a preview"
          accessibilityLabel={item.name}
          accessibilityRole="button"
          hitSlop={6}
          key={`${item.name}:${index}`}
          onPress={() => onOpen(items.indexOf(item))}
          style={({ pressed }) => [styles.file, { backgroundColor: t.paper }, pressed && styles.dim]}
        >
          <Feather color={t.muted} name={GLYPH_ICON[fileGlyph(item.name, item.kind)]} size={18} />
          <Text numberOfLines={1} style={[type.small, styles.shrink, { color: t.ink, fontWeight: '600' }]}>
            {item.name}
          </Text>
          {item.size ? <Text style={[type.small, { color: t.muted }]}>{fileSize(item.size)}</Text> : null}
        </Pressable>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  dim: { opacity: 0.45 },
  // Room at the top and the right for the remove badge, which sits on the corner.
  thumbBox: { paddingTop: 6, paddingRight: 6 },
  thumb: { width: STAGED_SIZE, height: STAGED_SIZE, borderRadius: radius.md },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center'
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: space.sm,
    maxWidth: 240,
    minHeight: STAGED_SIZE,
    paddingHorizontal: space.md,
    borderRadius: radius.md
  },
  sent: { gap: space.sm },
  pictures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  picture: { borderRadius: radius.md },
  // A row of its own, with a surface: it must read as something to tap.
  file: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40, paddingHorizontal: space.md, borderRadius: radius.md }
})
