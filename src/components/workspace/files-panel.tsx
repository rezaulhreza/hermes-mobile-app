import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'

import { AttachmentViewer, type ViewerTarget } from '@/components/attachment-viewer'
import { attachmentKind, fileGlyph, previewMode } from '@/core/attachments'
import { type FsEntry, parentPath, pathUnderRoot } from '@/core/workspace'
import { $folder, $root, showFolder } from '@/store/workspace'
import { space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { type IconName, Notice } from '../ui'

const GLYPH: Record<string, IconName> = { image: 'image', video: 'film', audio: 'music', code: 'file-text', archive: 'archive', pdf: 'file-text' }

/**
 * The files of the folder, one level at a time: a folder opens in the place
 * of its parent, so the list never holds a whole tree. A text file opens in
 * the editor; a picture or a document opens in the viewer.
 */
export function FilesPanel({ bottom }: { bottom: number }) {
  const t = useTheme()
  const root = useStore($root)
  const folder = useStore($folder)
  const [viewing, setViewing] = useState<ViewerTarget | null>(null)

  if (!root || !folder) {
    return null
  }

  const up = folder.path === root ? null : parentPath(folder.path)

  const open = (entry: FsEntry) => {
    if (entry.isDirectory) {
      void showFolder(entry.path)

      return
    }

    const kind = attachmentKind({ name: entry.name })
    const mode = previewMode(entry.name, kind)

    // A web page of the project is a file to edit. A picture, a PDF or a film is a file to look at.
    if (mode === 'image' || (mode === 'web' && !/\.html?$/i.test(entry.name))) {
      setViewing({ items: [{ name: entry.name, kind, path: entry.path }], index: 0 })
    } else {
      router.push({ pathname: '/file', params: { path: entry.path } })
    }
  }

  return (
    <View style={styles.fill}>
      <View style={[styles.crumbs, { borderBottomColor: t.line }]}>
        {up ? (
          <Pressable accessibilityLabel="Folder above" accessibilityRole="button" hitSlop={8} onPress={() => void showFolder(up)} style={styles.up}>
            <Feather color={t.ink} name="corner-left-up" size={18} />
          </Pressable>
        ) : null}
        <Text ellipsizeMode="head" numberOfLines={1} style={[type.small, styles.fill, { color: t.muted }]}>
          {pathUnderRoot(root, folder.path) || 'Top of the folder'}
        </Text>
        {folder.loading ? <ActivityIndicator color={t.muted} size="small" /> : null}
      </View>
      <FlatList
        ListEmptyComponent={
          folder.loading ? null : <Notice detail={folder.problem ?? undefined} icon={folder.problem ? 'alert-triangle' : 'folder'} title={folder.problem ? 'Could not read the folder' : 'This folder is empty'} />
        }
        contentContainerStyle={{ paddingBottom: bottom, flexGrow: 1 }}
        data={folder.entries}
        initialNumToRender={20}
        keyExtractor={entry => entry.path}
        refreshControl={<RefreshControl onRefresh={() => void showFolder(folder.path)} refreshing={false} tintColor={t.muted} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={`${item.isDirectory ? 'Folder' : 'File'}: ${item.name}`}
            accessibilityRole="button"
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
          >
            <Feather
              color={item.isDirectory ? t.accent : t.muted}
              name={item.isDirectory ? 'folder' : (GLYPH[fileGlyph(item.name, attachmentKind({ name: item.name }))] ?? 'file')}
              size={18}
            />
            <Text numberOfLines={1} style={[type.body, styles.fill, { color: t.ink }]}>
              {item.name}
            </Text>
            {item.isDirectory ? <Feather color={t.muted} name="chevron-right" size={16} /> : null}
          </Pressable>
        )}
        windowSize={9}
      />
      <AttachmentViewer onClose={() => setViewing(null)} target={viewing} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40, paddingHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  up: { paddingRight: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH, paddingHorizontal: space.lg, borderBottomWidth: StyleSheet.hairlineWidth }
})
