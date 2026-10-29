import { Feather } from '@expo/vector-icons'
import { useStore } from '@nanostores/react'
import { Redirect, Tabs } from 'expo-router'
import type { ComponentProps } from 'react'
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import type { IconName } from '@/components/ui'
import { listPaneWidth } from '@/core/layout'
import { useWide } from '@/store/pane'
import { $requests } from '@/store/requests'
import { $workspaces, $workspacesLoaded } from '@/store/workspaces'
import { radius, space } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Chats', icon: 'message-circle' },
  bots: { label: 'Bots', icon: 'users' },
  activity: { label: 'Activity', icon: 'activity' },
  workspace: { label: 'Workspace', icon: 'folder' },
  settings: { label: 'More', icon: 'settings' }
}

export default function TabsLayout() {
  const loaded = useStore($workspacesLoaded)
  const hasWorkspace = useStore($workspaces).workspaces.length > 0

  if (!loaded) {
    return null
  }

  if (!hasWorkspace) {
    return <Redirect href="/sign-in" />
  }

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={props => <FloatingTabBar {...props} />}>
      {Object.keys(TABS).map(name => (
        <Tabs.Screen key={name} name={name} />
      ))}
    </Tabs>
  )
}

/** The bar floats above the page, so content scrolls behind it. */
function FloatingTabBar({ state, navigation }: TabBarProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const waiting = useStore($requests).length
  const { width } = useWindowDimensions()
  // On a wide screen the Chats tab has a chat open on the right: the bar stays under the list.
  const beside = useWide() && state.routes[state.index]?.name === 'index'

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, space.md) }, beside && { alignItems: 'flex-start', paddingLeft: Math.max(insets.left, space.md) }]}>
      <View style={[styles.bar, { backgroundColor: t.paper, borderColor: t.line }, beside && { width: listPaneWidth(width) - 2 * space.md }]}>
        {state.routes.map((route, index) => {
          const tab = TABS[route.name]

          if (!tab) {
            return null
          }

          const focused = state.index === index
          const colour = focused ? t.ink : t.muted

          return (
            <Pressable
              accessibilityLabel={tab.label}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })

                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name)
                }
              }}
              style={styles.tab}
            >
              <View>
                <Feather color={colour} name={tab.icon} size={20} />
                {route.name === 'activity' && waiting > 0 ? (
                  <View style={[styles.badge, { backgroundColor: t.ink }]}>
                    <Text style={[styles.badgeText, { color: t.accentFill }]}>{waiting}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={[styles.label, { color: colour }, focused && styles.labelOn]}>
                {tab.label}
              </Text>
              {/* The ink of the label says which tab is open. The lime mark under it is the accent, not the only sign. */}
              {focused ? <View style={[styles.mark, { backgroundColor: t.accentFill }]} /> : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/**
 * Space a scrolling screen must leave at its end so the last row clears the
 * bar. On a phone with a home indicator the bar is 66 points high and 34
 * points above the edge: its top is at 100, and the last row stays 20 points
 * clear of it.
 */
export const TAB_BAR_CLEARANCE = 120

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 520,
    padding: 6,
    borderRadius: radius.lg + 4,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6
  },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: radius.lg },
  label: { fontSize: 11, fontWeight: '600' },
  labelOn: { fontWeight: '700' },
  mark: { position: 'absolute', bottom: 2, width: 18, height: 4, borderRadius: 2 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center'
  },
  badgeText: { fontSize: 10, fontWeight: '700' }
})
