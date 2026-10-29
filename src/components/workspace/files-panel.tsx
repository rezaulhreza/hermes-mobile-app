import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { router } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'

import { AttachmentViewer, type ViewerTarget } from '@/components/attachment-viewer'
import { attachmentKind, fileGlyph, previewMode } from '@/core/attachments'
import { faultWords } from '@/core/format'
import { type FsEntry, joinPath, nameProblem, parentPath, pathUnderRoot, type SearchHit } from '@/core/workspace'
import { $folder, $root, deleteEntry, newFile, newFolder, renameEntry, searchFolder, showFolder } from '@/store/workspace'
import { MONO, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { ChoiceSheet } from '../choice'
import { Button, Field, IconButton, type IconName, Notice } from '../ui'

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
  // What the user does to the folder now: the list of actions, a name to type, a search, or a delete to confirm.
  const [menu, setMenu] = useState<'folder' | FsEntry | null>(null)
  const [naming, setNaming] = useState<{ kind: 'file' | 'folder' } | { kind: 'rename'; entry: FsEntry } | null>(null)
  const [removing, setRemoving] = useState<FsEntry | null>(null)
  const [searching, setSearching] = useState(false)
  const [fault, setFault] = useState<string | null>(null)

  const run = (work: () => Promise<unknown>) => {
    setFault(null)
    work().catch(error => setFault(faultWords(error)))
  }

  if (!root || !folder) {
    return null
  }

  // The opened folder is where the tab starts, not a wall: the user can go above it, to any folder of the host.
  const up = parentPath(folder.path)
  const inside = folder.path.startsWith(root)

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
      <View style={styles.crumbs}>
        {up ? (
          <Pressable accessibilityLabel="Folder above" accessibilityRole="button" hitSlop={8} onPress={() => void showFolder(up)} style={styles.up}>
            <Feather color={t.ink} name="corner-left-up" size={18} />
          </Pressable>
        ) : null}
        <Text ellipsizeMode="head" numberOfLines={1} style={[styles.path, styles.fill, { color: t.muted }]}>
          {inside ? pathUnderRoot(root, folder.path) || 'Top of the folder' : folder.path}
        </Text>
        {folder.loading ? <ActivityIndicator color={t.muted} size="small" /> : null}
        <Pressable accessibilityLabel="Search in the opened folder" accessibilityRole="button" hitSlop={8} onPress={() => setSearching(true)} style={styles.tool}>
          <Feather color={t.ink} name="search" size={18} />
        </Pressable>
        <Pressable accessibilityLabel="New file or folder" accessibilityRole="button" hitSlop={8} onPress={() => setMenu('folder')} style={styles.tool}>
          <Feather color={t.ink} name="plus" size={20} />
        </Pressable>
      </View>
      {fault ? (
        <Text accessibilityRole="alert" style={[type.small, styles.fault, { color: t.red }]}>
          {fault}
        </Text>
      ) : null}
      {removing ? (
        <View style={[styles.confirm, { backgroundColor: t.redBg }]}>
          <Text style={[type.small, { color: t.ink }]}>
            {removing.isDirectory ? `Delete the folder ${removing.name} and all that is in it? This cannot be undone.` : `Delete ${removing.name}? This cannot be undone.`}
          </Text>
          <View style={styles.line}>
            <Button label="Keep it" onPress={() => setRemoving(null)} style={styles.fill} />
            <Button label="Delete" onPress={() => (setRemoving(null), run(() => deleteEntry(removing)))} style={styles.fill} tone="danger" />
          </View>
        </View>
      ) : null}
      <FlatList
        ListEmptyComponent={
          folder.loading ? null : <Notice detail={folder.problem ?? undefined} icon={folder.problem ? 'alert-triangle' : 'folder'} title={folder.problem ? 'Could not read the folder' : 'This folder is empty'} />
        }
        contentContainerStyle={{ paddingBottom: bottom, flexGrow: 1, maxWidth: 760, width: '100%', alignSelf: 'center' }}
        data={folder.entries}
        initialNumToRender={20}
        keyExtractor={entry => entry.path}
        refreshControl={<RefreshControl onRefresh={() => void showFolder(folder.path)} refreshing={false} tintColor={t.muted} />}
        renderItem={({ item, index }) => (
          // The entries of the folder sit on one card, as the lists of the other tabs do.
          <View
            style={[
              styles.card,
              { backgroundColor: t.paper, borderColor: t.line },
              index === 0 && styles.cardFirst,
              index === folder.entries.length - 1 && styles.cardLast
            ]}
          >
          <Pressable
            accessibilityLabel={`${item.isDirectory ? 'Folder' : 'File'}: ${item.name}`}
            accessibilityHint="Hold for rename and delete"
            accessibilityRole="button"
            delayLongPress={350}
            onLongPress={() => setMenu(item)}
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, index === folder.entries.length - 1 && styles.rowLast, pressed && { backgroundColor: t.soft }]}
          >
            <Feather
              color={item.isDirectory ? t.accent : t.muted}
              name={item.isDirectory ? 'folder' : (GLYPH[fileGlyph(item.name, attachmentKind({ name: item.name }))] ?? 'file')}
              size={18}
            />
            <Text numberOfLines={1} style={[type.body, styles.fill, { color: t.ink, fontSize: 15 }]}>
              {item.name}
            </Text>
            {item.isDirectory ? <Feather color={t.muted} name="chevron-right" size={16} /> : null}
          </Pressable>
          </View>
        )}
        windowSize={9}
      />
      <AttachmentViewer onClose={() => setViewing(null)} target={viewing} />
      {menu === 'folder' ? (
        <ChoiceSheet
          choices={[
            { id: 'file', label: 'New file', lead: <Feather color={t.muted} name="file-plus" size={20} /> },
            { id: 'folder', label: 'New folder', lead: <Feather color={t.muted} name="folder-plus" size={20} /> }
          ]}
          onClose={() => setMenu(null)}
          onPick={id => (setMenu(null), setNaming({ kind: id === 'file' ? 'file' : 'folder' }))}
          title="In this folder"
        />
      ) : menu ? (
        <ChoiceSheet
          choices={[
            { id: 'rename', label: 'Rename', lead: <Feather color={t.muted} name="edit-2" size={20} /> },
            { id: 'delete', label: 'Delete', lead: <Feather color={t.red} name="trash-2" size={20} /> }
          ]}
          onClose={() => setMenu(null)}
          onPick={id => {
            const entry = menu

            setMenu(null)

            if (id === 'rename') {
              setNaming({ kind: 'rename', entry })
            } else {
              setRemoving(entry)
            }
          }}
          title={menu.name}
        />
      ) : null}
      {naming ? (
        <NameSheet
          initial={naming.kind === 'rename' ? naming.entry.name : ''}
          label={naming.kind === 'rename' ? 'New name' : naming.kind === 'file' ? 'Name of the file' : 'Name of the folder'}
          onClose={() => setNaming(null)}
          onSave={name => {
            const what = naming

            setNaming(null)
            run(async () => {
              if (what.kind === 'rename') {
                await renameEntry(what.entry, name)
              } else if (what.kind === 'folder') {
                await newFolder(name)
              } else {
                router.push({ pathname: '/file', params: { path: await newFile(name) } })
              }
            })
          }}
          taken={folder.entries.map(entry => entry.name).filter(name => naming.kind !== 'rename' || name !== naming.entry.name)}
          title={naming.kind === 'rename' ? `Rename ${naming.entry.name}` : naming.kind === 'file' ? 'New file' : 'New folder'}
        />
      ) : null}
      {searching ? <SearchSheet onClose={() => setSearching(false)} root={root} /> : null}
    </View>
  )
}

/** One name to type, with the reason when it cannot be used. */
function NameSheet({ title, label, initial, taken, onSave, onClose }: { title: string; label: string; initial: string; taken: readonly string[]; onSave: (name: string) => void; onClose: () => void }) {
  const t = useTheme()
  const [name, setName] = useState(initial)
  const problem = name === initial ? null : nameProblem(name, taken)

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <Text numberOfLines={1} style={[type.heading, styles.fill, { color: t.ink }]}>
            {title}
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <View style={styles.form}>
          <Field autoCapitalize="none" autoCorrect={false} autoFocus error={problem} label={label} onChangeText={setName} value={name} />
          <Button disabled={!name.trim() || name.trim() === initial || Boolean(problem)} label="Save" onPress={() => onSave(name.trim())} tone="primary" />
        </View>
      </View>
    </Modal>
  )
}

/** Find text in the files of the opened folder. A row opens its file. */
function SearchSheet({ root, onClose }: { root: string; onClose: () => void }) {
  const t = useTheme()
  const [words, setWords] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [fault, setFault] = useState<string | null>(null)

  const search = () => {
    if (words.trim().length < 2) {
      return
    }

    setBusy(true)
    setFault(null)
    searchFolder(words)
      .then(setHits, error => setFault(faultWords(error)))
      .finally(() => setBusy(false))
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible>
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={[styles.head, { borderBottomColor: t.line }]}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>Search in the folder</Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        <View style={styles.form}>
          <Field autoCapitalize="none" autoCorrect={false} autoFocus label="Text to find" onChangeText={setWords} onSubmitEditing={search} returnKeyType="search" value={words} />
          <Button busy={busy} disabled={words.trim().length < 2} icon="search" label="Search" onPress={search} tone="primary" />
          {fault ? <Text style={[type.small, { color: t.red }]}>{fault}</Text> : null}
        </View>
        <FlatList
          automaticallyAdjustKeyboardInsets
          ListEmptyComponent={hits && !busy ? <Text style={[type.body, styles.none, { color: t.muted }]}>No file of this folder has that text.</Text> : null}
          data={hits ?? []}
          initialNumToRender={14}
          keyExtractor={(hit, index) => `${hit.file}:${hit.line}:${index}`}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable
              accessibilityLabel={`${item.file}, line ${item.line}: ${item.text}`}
              accessibilityRole="button"
              onPress={() => {
                onClose()
                router.push({ pathname: '/file', params: { path: joinPath(root, item.file) } })
              }}
              style={({ pressed }) => [styles.hit, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
            >
              <Text numberOfLines={1} style={[type.small, { color: t.muted }]}>
                {item.file}
                <Text style={{ color: t.accent }}>{`  line ${item.line}`}</Text>
              </Text>
              <Text numberOfLines={2} style={[type.small, { color: t.ink }]}>
                {item.text}
              </Text>
            </Pressable>
          )}
          windowSize={7}
        />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  tool: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  fault: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  confirm: { gap: space.sm, margin: space.md, padding: space.md, borderRadius: radius.md },
  line: { flexDirection: 'row', gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingLeft: space.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  form: { padding: space.lg, gap: space.md },
  none: { padding: space.xl, textAlign: 'center' },
  hit: { gap: 2, paddingHorizontal: space.lg, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  fill: { flex: 1 },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 40, paddingHorizontal: space.lg },
  path: { fontFamily: MONO, fontSize: 12 },
  up: { paddingRight: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH + 4, paddingHorizontal: space.md + 2, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLast: { borderBottomWidth: 0 },
  card: { marginHorizontal: space.lg, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  cardFirst: { borderTopWidth: StyleSheet.hairlineWidth, borderTopLeftRadius: radius.md + 2, borderTopRightRadius: radius.md + 2 },
  cardLast: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomLeftRadius: radius.md + 2, borderBottomRightRadius: radius.md + 2 }
})
