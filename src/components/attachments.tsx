import { Feather } from '@expo/vector-icons'
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native'

import type { IconName } from '@/components/ui'
import { type Attachment, type FileGlyph, fileGlyph, type SentAttachment } from '@/core/attachments'
import { fileSize } from '@/core/format'
import { radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

const GLYPH_ICON: Record<FileGlyph, IconName> = {
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
export function StagedAttachment({ item, onRemove }: { item: Attachment; onRemove: () => void }) {
  const t = useTheme()
  const failed = item.state === 'failed'
  const uploading = item.state === 'uploading'

  const remove = (
    <Pressable
      accessibilityLabel={`Remove ${item.name}`}
      accessibilityRole="button"
      hitSlop={12}
      onPress={onRemove}
      style={item.uri && !failed ? [styles.badge, { backgroundColor: t.ink }] : undefined}
    >
      <Feather color={item.uri && !failed ? t.bg : failed ? t.red : t.muted} name="x" size={item.uri && !failed ? 12 : 16} />
    </Pressable>
  )

  if (item.uri && !failed) {
    return (
      <View accessibilityLabel={uploading ? `${item.name}, uploading` : item.name} style={styles.thumbBox}>
        <Image source={{ uri: item.uri }} style={[styles.thumb, { backgroundColor: t.soft }, uploading && styles.dim]} />
        {uploading ? <ActivityIndicator color={t.ink} size="small" style={StyleSheet.absoluteFill} /> : null}
        {remove}
      </View>
    )
  }

  return (
    <View style={[styles.chip, { backgroundColor: failed ? t.redBg : t.soft }]}>
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
    </View>
  )
}

/** The attachments of a sent message, inside its bubble: pictures first, then one row per file. */
export function SentAttachments({ items }: { items: readonly SentAttachment[] }) {
  const t = useTheme()
  const pictures = items.filter(item => item.uri)
  const files = items.filter(item => !item.uri)
  const side = pictures.length === 1 ? SENT_ALONE_SIZE : SENT_SIZE

  return (
    <View style={styles.sent}>
      {pictures.length ? (
        <View style={styles.pictures}>
          {pictures.map((item, index) => (
            <Image
              accessibilityLabel={item.name}
              key={`${item.uri}:${index}`}
              source={{ uri: item.uri }}
              style={[styles.picture, { width: side, height: side, backgroundColor: t.line }]}
            />
          ))}
        </View>
      ) : null}
      {files.map((item, index) => (
        <View key={`${item.name}:${index}`} style={styles.file}>
          <Feather color={t.muted} name={GLYPH_ICON[fileGlyph(item.name, item.kind)]} size={16} />
          <Text numberOfLines={1} style={[type.small, styles.shrink, { color: t.ink }]}>
            {item.name}
          </Text>
          {item.size ? <Text style={[type.small, { color: t.muted }]}>{fileSize(item.size)}</Text> : null}
        </View>
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
  file: { flexDirection: 'row', alignItems: 'center', gap: space.sm }
})
