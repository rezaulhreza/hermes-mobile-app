import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { useCallback, useState } from 'react'
import { router, useFocusEffect } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { Button, type IconName, Notice } from '@/components/ui'
import { ChangesPanel } from '@/components/workspace/changes-panel'
import { FilesPanel } from '@/components/workspace/files-panel'
import { PreviewPanel } from '@/components/workspace/preview-panel'
import { RootSheet } from '@/components/workspace/root-sheet'
import { baseName } from '@/core/workspace'
import { $linkState } from '@/store/link'
import { $shells, loadShells } from '@/store/shell'
import { $changes, $root } from '@/store/workspace'
import { dark, MONO, radius, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { TAB_BAR_CLEARANCE } from './_layout'

const PANELS = [
  { name: 'files', label: 'Files', icon: 'folder' },
  { name: 'changes', label: 'Changes', icon: 'git-branch' },
  { name: 'preview', label: 'Preview', icon: 'globe' }
] as const satisfies readonly { name: string; label: string; icon: IconName }[]

type Panel = (typeof PANELS)[number]['name']

/**
 * A folder on the Hermes host: its files, its git changes and a preview. Only
 * the panel on screen is mounted, so a panel that is not shown holds no list
 * and no web page. The terminal is a mode of its own: its button is in the
 * header in every state, also with no folder chosen.
 */
export default function Workspace() {
  const t = useTheme()
  const root = useStore($root)
  const linkState = useStore($linkState)
  const changed = useStore($changes).files.length
  const [panel, setPanel] = useState<Panel>('files')
  const [choosing, setChoosing] = useState(false)
  const shells = useStore($shells)
  // The panels leave room for the bar of the shells over the tab bar.
  const bottom = TAB_BAR_CLEARANCE + (shells.length ? 56 : 0)

  // The shells keep running on the host after the terminal closes: the bar under the panels says so.
  useFocusEffect(
    useCallback(() => {
      if (linkState === 'open') {
        void loadShells().catch(() => undefined)
      }
    }, [linkState])
  )

  return (
    <SafeAreaView edges={['top']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityHint="Opens the list of folders"
          accessibilityLabel={root ? `Folder: ${baseName(root)}` : 'Open a folder'}
          accessibilityRole="button"
          disabled={linkState !== 'open'}
          onPress={() => setChoosing(true)}
          style={styles.fill}
        >
          <Text style={[type.small, { color: t.muted }]}>Workspace</Text>
          <View style={styles.title}>
            <Text numberOfLines={1} style={[type.title, styles.shrink, { color: t.ink }]}>
              {root ? baseName(root) : 'No folder'}
            </Text>
            <Feather color={t.muted} name="chevron-down" size={18} />
          </View>
        </Pressable>
        <Pressable
          accessibilityHint="Opens the command line of the host"
          accessibilityRole="button"
          disabled={linkState !== 'open'}
          hitSlop={4}
          onPress={() => router.push('/terminal')}
          style={({ pressed }) => [styles.terminal, { backgroundColor: t.ink }, (pressed || linkState !== 'open') && styles.dim]}
        >
          <Feather color={t.accentFill} name="terminal" size={14} />
          <Text style={[type.small, { color: t.accentFill, fontWeight: '700' }]}>Terminal</Text>
        </Pressable>
      </View>

      {root ? (
        <>
          <View style={[styles.tabs, { backgroundColor: t.soft }]}>
            {PANELS.map(item => {
              const on = item.name === panel

              return (
                <Pressable
                  accessibilityLabel={`Panel: ${item.label}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  key={item.name}
                  onPress={() => setPanel(item.name)}
                  style={[styles.tab, on && { backgroundColor: t.paper }]}
                >
                  <Feather color={on ? t.ink : t.muted} name={item.icon} size={15} />
                  <Text numberOfLines={1} style={[type.small, { color: on ? t.ink : t.muted, fontWeight: '600' }]}>
                    {item.name === 'changes' && changed ? `${item.label} ${changed}` : item.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          {panel === 'files' ? <FilesPanel bottom={bottom} /> : null}
          {panel === 'changes' ? <ChangesPanel bottom={bottom} /> : null}
          {panel === 'preview' ? <PreviewPanel bottom={bottom} /> : null}
        </>
      ) : (
        <Notice
          action={<Button disabled={linkState !== 'open'} icon="folder" label="Open a folder" onPress={() => setChoosing(true)} tone="primary" />}
          detail="Choose a project or a folder on the Hermes host. You can read and edit its files, review and commit its changes, run commands and look at its pages."
          icon="folder"
          title="Work in a folder on the host"
        />
      )}
      {shells.length ? (
        // A shell runs on the host: one tap goes back to it.
        <Pressable accessibilityHint="Opens the terminal" accessibilityRole="button" onPress={() => router.push('/terminal')} style={[styles.runningBar, { backgroundColor: dark.bg }]}>
          <View style={[styles.runningDot, { backgroundColor: dark.accentFill }]} />
          <Text numberOfLines={1} style={[styles.runningText, { color: dark.ink }]}>
            {shells.length === 1 ? '1 shell runs on the host' : `${shells.length} shells run on the host`}
          </Text>
          <Text style={[type.small, { color: dark.accentFill, fontWeight: '700' }]}>Open</Text>
        </Pressable>
      ) : null}
      <RootSheet onClose={() => setChoosing(false)} visible={choosing} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.md },
  title: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dim: { opacity: 0.5 },
  // On the line of the title, as the button of the Chats header. The slop keeps the touch area at 44.
  terminal: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, marginBottom: 2, paddingHorizontal: space.md + 2, borderRadius: 18 },
  runningBar: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: TAB_BAR_CLEARANCE - space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 48,
    paddingHorizontal: space.md,
    borderRadius: radius.md
  },
  runningDot: { width: 8, height: 8, borderRadius: 4 },
  runningText: { flex: 1, fontFamily: MONO, fontSize: 12 },
  tabs: { flexDirection: 'row', marginHorizontal: space.lg, marginBottom: space.sm, padding: 3, borderRadius: radius.md },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 36, borderRadius: radius.md - 3 }
})
