import { useStore } from '@nanostores/react'
import { useRef, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native'

import { baseName, type TerminalEntry } from '@/core/workspace'
import { $terminal, clearTerminal, runCommand } from '@/store/workspace'
import { MONO, radius, space, TOUCH } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { IconButton, Notice } from '../ui'

/**
 * A command line on the host. Each command is one process: it runs in the
 * terminal's folder, gets 30 seconds, and its output shows when it ends. A
 * program that waits for keys (an editor, a pager) does not work here.
 */
export function TerminalPanel({ bottom }: { bottom: number }) {
  const t = useTheme()
  const terminal = useStore($terminal)
  const [command, setCommand] = useState('')
  const list = useRef<FlatList<TerminalEntry>>(null)

  if (!terminal) {
    return null
  }

  const run = () => {
    if (command.trim() && !terminal.running) {
      void runCommand(command)
      setCommand('')
    }
  }

  // The newest command is next to the field: the list is upside down.
  const newestFirst = [...terminal.entries].reverse()

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={110} style={styles.fill}>
      <FlatList
        ListEmptyComponent={<Notice detail="A command runs on the Hermes host, in this folder. It gets 30 seconds." icon="terminal" title="Run a command" />}
        contentContainerStyle={styles.content}
        data={newestFirst}
        inverted={newestFirst.length > 0}
        keyExtractor={entry => String(entry.key)}
        keyboardShouldPersistTaps="handled"
        ref={list}
        renderItem={({ item }) => (
          <View style={styles.entry}>
            <Text selectable style={[styles.mono, { color: t.muted }]}>
              <Text style={{ color: t.accent }}>{`${baseName(item.cwd)} $ `}</Text>
              <Text style={{ color: t.ink }}>{item.command}</Text>
            </Text>
            {item.output === null ? (
              <ActivityIndicator color={t.muted} size="small" style={styles.spin} />
            ) : item.output ? (
              <Text selectable style={[styles.mono, { color: item.failed ? t.red : t.ink }]}>
                {item.output}
              </Text>
            ) : null}
          </View>
        )}
        windowSize={7}
      />
      <View style={[styles.bar, { borderTopColor: t.line, paddingBottom: bottom }]}>
        <Text numberOfLines={1} style={[styles.mono, styles.cwd, { color: t.accent }]}>
          {`${baseName(terminal.cwd)} $`}
        </Text>
        <TextInput
          accessibilityLabel="Command"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setCommand}
          onSubmitEditing={run}
          placeholder="command"
          placeholderTextColor={t.muted}
          returnKeyType="go"
          spellCheck={false}
          style={[styles.input, { color: t.ink, backgroundColor: t.soft }]}
          submitBehavior="submit"
          value={command}
        />
        <IconButton disabled={!command.trim() || terminal.running} icon="play" label="Run the command" onPress={run} />
        <IconButton disabled={!terminal.entries.length} icon="trash-2" label="Clear the terminal" onPress={clearTerminal} />
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.lg, gap: space.md, flexGrow: 1 },
  entry: { gap: 2 },
  spin: { alignSelf: 'flex-start', marginTop: space.xs },
  mono: { fontFamily: MONO, fontSize: 12, lineHeight: 18 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  cwd: { maxWidth: 110 },
  input: { flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.md, fontFamily: MONO, fontSize: 14 }
})
