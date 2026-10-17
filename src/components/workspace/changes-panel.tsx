import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Linking, Modal, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { diffLines, type DiffLineKind } from '@/core/tools'
import { baseName, type GitBranch, type GitWorktree, changeGroups, commitLabel, commitProblem, type GitFile, statusWord } from '@/core/workspace'
import {
  $changes,
  $root,
  commitChanges,
  createPullRequest,
  loadBranches,
  loadChanges,
  loadDiff,
  loadShipInfo,
  loadWorktrees,
  openRoot,
  pushBranch,
  revertFile,
  type ShipInfo,
  stageAll,
  stageFile,
  switchBranch,
  unstageAll
} from '@/store/workspace'
import { lineOf, MONO, type Palette, radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button, IconButton, Notice } from '../ui'
import { ChoiceSheet } from '../choice'

function words(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^\d{3}: /, '').replace(/^\{"detail":"(.*)"\}$/, '$1')
}

/** The git changes of the folder: look at a diff, stage, commit and push. */
export function ChangesPanel({ bottom }: { bottom: number }) {
  const t = useTheme()
  const { status, files, loading, problem } = useStore($changes)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)
  const [open, setOpen] = useState<GitFile | null>(null)
  const root = useStore($root)
  const [reverting, setReverting] = useState<GitFile | null>(null)
  const [branches, setBranches] = useState<{ list: GitBranch[]; folders: GitWorktree[] } | null>(null)
  // Whether the branch has a pull request. One request for a branch; the answer is kept with the name of its branch.
  const [shipOf, setShipOf] = useState<{ branch: string; info: ShipInfo | null } | null>(null)
  const ship = shipOf && shipOf.branch === status?.branch ? shipOf.info : null
  const setShip = (info: ShipInfo | null) => setShipOf(status?.branch ? { branch: status.branch, info } : null)

  useEffect(() => {
    const branch = status?.branch

    if (branch) {
      loadShipInfo().then(info => setShipOf({ branch, info }), () => undefined)
    }
  }, [status?.branch])

  const openBranches = () => {
    setFault(null)
    Promise.all([loadBranches(), loadWorktrees().catch(() => [])]).then(
      ([list, folders]) => setBranches({ list, folders }),
      error => setFault(words(error))
    )
  }

  useEffect(() => {
    void loadChanges()
  }, [])

  const run = (name: string, work: () => Promise<void>, after?: () => void) => {
    setBusy(name)
    setFault(null)
    work()
      .then(after)
      .catch(error => setFault(words(error)))
      .finally(() => setBusy(null))
  }

  const commit = (push: boolean) => {
    const refusal = commitProblem(message, files)

    if (refusal) {
      setFault(refusal)
    } else {
      run(push ? 'push' : 'commit', () => commitChanges(message, push), () => setMessage(''))
    }
  }

  if (problem && !files.length) {
    return <Notice detail={problem} icon="git-branch" title="No changes to show" />
  }

  const { staged, unstaged } = changeGroups(files)
  const sections = [
    ...(staged.length ? [{ title: 'Staged', action: 'Unstage all', onAction: () => run('all', unstageAll), data: staged }] : []),
    ...(unstaged.length ? [{ title: 'Not staged', action: 'Stage all', onAction: () => run('all', stageAll), data: unstaged }] : [])
  ]

  return (
    <View style={styles.fill}>
      <SectionList
        automaticallyAdjustKeyboardInsets
        ListEmptyComponent={loading ? null : <Notice detail="Every change is committed." icon="check-circle" title="The folder is clean" />}
        ListHeaderComponent={
          <View style={styles.top}>
            <View style={styles.line}>
              <Pressable
                accessibilityHint="Opens the branches and the other folders of this repository"
                accessibilityLabel={`Branch: ${status?.branch ?? 'No branch'}`}
                accessibilityRole="button"
                disabled={!status?.branch}
                hitSlop={8}
                onPress={openBranches}
                style={[styles.line, styles.fill]}
              >
                <Feather color={t.muted} name="git-branch" size={16} />
                <Text numberOfLines={1} style={[type.label, styles.shrink, { color: t.ink }]}>
                  {status?.branch ?? 'No branch'}
                </Text>
                {status?.branch ? <Feather color={t.muted} name="chevron-down" size={14} /> : null}
              </Pressable>
              {status?.ahead ? <Text style={[type.small, { color: t.muted }]}>{`${status.ahead} to push`}</Text> : null}
              {status?.behind ? <Text style={[type.small, { color: t.muted }]}>{`${status.behind} behind`}</Text> : null}
              {loading ? <ActivityIndicator color={t.muted} size="small" /> : null}
            </View>
            {files.length ? (
              <>
                <TextInput
                  accessibilityLabel="Commit message"
                  multiline
                  onChangeText={setMessage}
                  placeholder="What is the change?"
                  placeholderTextColor={t.muted}
                  style={[styles.message, type.body, { color: t.ink, backgroundColor: t.soft }]}
                  value={message}
                />
                <View style={styles.line}>
                  <Button busy={busy === 'commit'} disabled={Boolean(busy)} label={commitLabel(files)} onPress={() => commit(false)} style={styles.fill} tone="primary" />
                  <Button busy={busy === 'push'} disabled={Boolean(busy)} icon="upload" label="and push" onPress={() => commit(true)} />
                </View>
              </>
            ) : status?.ahead ? (
              <Button busy={busy === 'push'} icon="upload" label={`Push ${status.ahead} ${status.ahead === 1 ? 'commit' : 'commits'}`} onPress={() => run('push', pushBranch)} tone="primary" />
            ) : null}
            {ship?.pr ? (
              <Button icon="git-pull-request" label={`Pull request${ship.pr.number ? ` #${ship.pr.number}` : ''}: open it`} onPress={() => ship.pr?.url && void Linking.openURL(ship.pr.url)} />
            ) : ship?.ghReady && status?.branch && !files.length && !status.ahead ? (
              <Button
                busy={busy === 'pr'}
                icon="git-pull-request"
                label="Open a pull request for this branch"
                onPress={() =>
                  run('pr', async () => {
                    const url = await createPullRequest()

                    setShip(await loadShipInfo().catch(() => null))

                    if (url) {
                      void Linking.openURL(url)
                    }
                  })
                }
              />
            ) : null}
            {fault ? (
              <Text accessibilityRole="alert" style={[type.small, { color: t.red }]}>
                {fault}
              </Text>
            ) : null}
            {reverting ? (
              <View style={[styles.confirm, { backgroundColor: t.redBg }]}>
                <Text style={[type.small, { color: t.ink }]}>{`Throw the changes of ${reverting.path} away? The file goes back to the last commit. This cannot be undone.`}</Text>
                <View style={styles.line}>
                  <Button label="Keep them" onPress={() => setReverting(null)} style={styles.fill} />
                  <Button label="Throw away" onPress={() => (setReverting(null), run(reverting.path, () => revertFile(reverting)))} style={styles.fill} tone="danger" />
                </View>
              </View>
            ) : null}
          </View>
        }
        contentContainerStyle={{ paddingBottom: bottom, flexGrow: 1 }}
        keyExtractor={file => `${file.staged}:${file.path}`}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl onRefresh={() => void loadChanges()} refreshing={false} tintColor={t.muted} />}
        renderItem={({ item }) => (
          <Pressable
            accessibilityHint="Opens the diff"
            accessibilityLabel={`${statusWord(item.status)}: ${item.path}`}
            accessibilityRole="button"
            onPress={() => setOpen(item)}
            style={({ pressed }) => [styles.row, { borderBottomColor: t.line }, pressed && { backgroundColor: t.soft }]}
          >
            <View style={styles.fill}>
              <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
                {baseName(item.path)}
              </Text>
              <Text ellipsizeMode="head" numberOfLines={1} style={[type.small, { color: t.muted }]}>
                {`${statusWord(item.status)}  ·  ${item.path}`}
              </Text>
            </View>
            <Text style={[type.small, { color: t.green }]}>{`+${item.added}`}</Text>
            <Text style={[type.small, { color: t.red }]}>{`−${item.removed}`}</Text>
            <IconButton
              disabled={Boolean(busy)}
              icon={item.staged ? 'minus' : 'plus'}
              label={`${item.staged ? 'Unstage' : 'Stage'} ${item.path}`}
              onPress={() => run(item.path, () => stageFile(item))}
            />
          </Pressable>
        )}
        renderSectionHeader={({ section }) => (
          <View style={[styles.section, { backgroundColor: t.bg }]}>
            <Text style={[type.small, styles.fill, { color: t.muted, fontWeight: '700' }]}>{`${section.title} (${section.data.length})`}</Text>
            <Pressable accessibilityLabel={section.action} accessibilityRole="button" disabled={Boolean(busy)} hitSlop={8} onPress={section.onAction}>
              <Text style={[type.small, { color: t.accent, fontWeight: '600' }]}>{section.action}</Text>
            </Pressable>
          </View>
        )}
        sections={sections}
        stickySectionHeadersEnabled={false}
      />
      <DiffSheet
        file={open}
        onClose={() => setOpen(null)}
        // The question shows in the panel, not as a system alert: the diff closes first.
        onRevert={file => (setOpen(null), setReverting(file))}
      />
      {branches ? (
        <ChoiceSheet
          choices={[
            ...branches.list.filter(branch => !branch.isRemote).map(branch => ({ id: `b:${branch.name}`, label: branch.name, detail: branch.checkedOut ? 'This folder is on it' : branch.worktreePath ? 'Open in another folder' : undefined })),
            ...branches.folders.filter(tree => tree.path !== root).map(tree => ({ id: `w:${tree.path}`, label: `Folder: ${baseName(tree.path)}`, detail: tree.branch ? `On ${tree.branch}` : undefined }))
          ]}
          current={`b:${status?.branch ?? ''}`}
          onClose={() => setBranches(null)}
          onPick={id => {
            setBranches(null)

            if (id.startsWith('w:')) {
              openRoot(id.slice(2))
            } else if (id.slice(2) !== status?.branch) {
              run('branch', () => switchBranch(id.slice(2)))
            }
          }}
          title="Branch"
        />
      ) : null}
    </View>
  )
}

function DiffSheet({ file, onClose, onRevert }: { file: GitFile | null; onClose: () => void; onRevert: (file: GitFile) => void }) {
  const t = useTheme()
  const insets = useSafeAreaInsets()

  return (
    <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={Boolean(file)}>
      <View style={[styles.fill, { backgroundColor: t.bg, paddingBottom: insets.bottom }]}>
        <View style={styles.head}>
          <View style={styles.fill}>
            <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
              {file ? baseName(file.path) : ''}
            </Text>
            <Text ellipsizeMode="head" numberOfLines={1} style={[type.small, { color: t.muted }]}>
              {file?.path}
            </Text>
          </View>
          {file ? <IconButton icon="rotate-ccw" label="Throw the changes away" onPress={() => onRevert(file)} /> : null}
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        {/* One body for one file: it asks for its diff when it mounts and holds it only while the sheet is open. */}
        {file ? <DiffBody file={file} key={`${file.staged}:${file.path}`} /> : null}
      </View>
    </Modal>
  )
}

function DiffBody({ file }: { file: GitFile }) {
  const t = useTheme()
  const [diff, setDiff] = useState<string | null>(null)
  const [fault, setFault] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    loadDiff(file)
      .then(text => !cancelled && setDiff(text))
      .catch(error => !cancelled && setFault(words(error)))

    return () => {
      cancelled = true
    }
  }, [file])

  if (fault) {
    return <Notice detail={fault} icon="alert-triangle" title="Could not read the diff" />
  }

  if (diff === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={t.muted} />
      </View>
    )
  }

  return diff.trim() ? (
    <ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.diff}>
          {diffLines(diff).map((line, index) => (
            <Text key={index} selectable style={[styles.mono, { color: diffColour(line.kind, t) }]}>
              {line.text || ' '}
            </Text>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  ) : (
    <Notice detail="A new or binary file has no line diff." icon="file" title="No lines to show" />
  )
}

function diffColour(kind: DiffLineKind, t: Palette): string {
  return kind === 'add' ? t.green : kind === 'remove' ? t.red : kind === 'context' ? t.ink : t.muted
}

const styles = StyleSheet.create({
  shrink: { flexShrink: 1 },
  confirm: { gap: space.sm, padding: space.md, borderRadius: radius.md },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { padding: space.lg, gap: space.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  message: { minHeight: 72, padding: space.md, borderRadius: radius.md, textAlignVertical: 'top' },
  section: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: TOUCH + space.md, paddingLeft: space.lg, paddingRight: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  head: { flexDirection: 'row', alignItems: 'center', padding: space.lg, gap: space.sm },
  diff: { padding: space.lg },
  mono: { fontFamily: MONO, fontSize: 12, lineHeight: lineOf(18) }
})
