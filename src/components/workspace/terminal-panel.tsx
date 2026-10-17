import { Feather } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { duration } from "@/core/format";
import { baseName, recentCommands, type TerminalEntry } from "@/core/workspace";
import { tap } from "@/native/haptics";
import { $terminal, clearTerminal, runCommand } from "@/store/workspace";
import { dark, lineOf, MONO, radius, space } from "@/theme/tokens";
import { useKeyboardOpen } from "@/theme/use-keyboard";

/** A terminal is dark in both appearances: that is what a terminal looks like, and its colours need the dark ground. */
const c = dark;

const STARTERS = ["ls", "git status", "git log --oneline -5", "pwd"];

/**
 * A command line on the host. Each command is one process: it runs in the
 * terminal's folder, gets 30 seconds, and its output shows when it ends. A
 * program that waits for keys (an editor, a pager) does not work here.
 */
export function TerminalPanel({ bottom }: { bottom: number }) {
  const terminal = useStore($terminal);
  const keyboardOpen = useKeyboardOpen();
  const [command, setCommand] = useState("");
  const input = useRef<TextInput>(null);
  const recent = useMemo(
    () => recentCommands(terminal?.entries ?? []),
    [terminal?.entries],
  );

  if (!terminal) {
    return null;
  }

  const run = (text = command) => {
    if (text.trim() && !terminal.running) {
      tap();
      void runCommand(text);
      setCommand("");
    }
  };

  // The newest command is next to the field: the list is upside down.
  const newestFirst = [...terminal.entries].reverse();
  const offers = recent.length ? recent : STARTERS;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 12 : 0}
      style={styles.fill}
    >
      {/* The keyboard view sets its own bottom padding, so the room for the tab bar is on a view inside it.
          With the keyboard open the tab bar is under the keyboard: the window then needs no room for the bar. */}
      <View
        style={[
          styles.fill,
          { paddingBottom: keyboardOpen ? space.sm : bottom },
        ]}
      >
        <View
          style={[
            styles.window,
            { backgroundColor: c.bg, borderColor: c.line },
          ]}
        >
          <View style={[styles.titleBar, { borderBottomColor: c.line }]}>
            <Feather color={c.green} name="terminal" size={14} />
            <Text
              ellipsizeMode="head"
              numberOfLines={1}
              style={[styles.mono, styles.fill, { color: c.muted }]}
            >
              {terminal.cwd}
            </Text>
            <Pressable
              accessibilityLabel="Clear the terminal"
              accessibilityRole="button"
              disabled={!terminal.entries.length}
              hitSlop={10}
              onPress={clearTerminal}
              style={!terminal.entries.length && styles.dim}
            >
              <Feather color={c.muted} name="trash-2" size={15} />
            </Pressable>
          </View>

          <FlatList
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={[styles.mono, { color: c.muted }]}>
                  A command runs on the Hermes host, in this folder.
                </Text>
                <Text style={[styles.mono, { color: c.muted }]}>
                  It gets 30 seconds. A program that waits for keys does not
                  work here.
                </Text>
              </View>
            }
            contentContainerStyle={styles.content}
            data={newestFirst}
            inverted={newestFirst.length > 0}
            keyExtractor={(entry) => String(entry.key)}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => <Entry entry={item} />}
            style={styles.fill}
            windowSize={7}
          />

          <ScrollView
            contentContainerStyle={styles.offers}
            horizontal
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
            style={[styles.offerBar, { borderTopColor: c.line }]}
          >
            {offers.map((text) => (
              <Pressable
                accessibilityHint="Runs this command"
                accessibilityLabel={`Run: ${text}`}
                accessibilityRole="button"
                disabled={terminal.running}
                key={text}
                onPress={() => run(text)}
                style={({ pressed }) => [
                  styles.offer,
                  { backgroundColor: c.soft },
                  pressed && styles.dim,
                ]}
              >
                <Text numberOfLines={1} style={[styles.mono, { color: c.ink }]}>
                  {text}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Pressable
            onPress={() => input.current?.focus()}
            style={[styles.prompt, { backgroundColor: c.paper }]}
          >
            <Text
              numberOfLines={1}
              style={[styles.mono, styles.cwd, { color: c.green }]}
            >
              {baseName(terminal.cwd)}
            </Text>
            <Text style={[styles.mono, { color: c.accent }]}>❯</Text>
            <TextInput
              accessibilityLabel="Command"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardAppearance="dark"
              onChangeText={setCommand}
              onSubmitEditing={() => run()}
              placeholder={terminal.running ? "running…" : "type a command"}
              placeholderTextColor={c.muted}
              ref={input}
              returnKeyType="go"
              selectionColor={c.accent}
              spellCheck={false}
              style={[styles.input, { color: c.ink }]}
              submitBehavior="submit"
              value={command}
            />
            {terminal.running ? (
              <ActivityIndicator
                color={c.accent}
                size="small"
                style={styles.run}
              />
            ) : (
              <Pressable
                accessibilityLabel="Run the command"
                accessibilityRole="button"
                disabled={!command.trim()}
                hitSlop={8}
                onPress={() => run()}
                style={[
                  styles.run,
                  { backgroundColor: command.trim() ? c.accent : c.soft },
                ]}
              >
                <Feather
                  color={command.trim() ? c.onAccent : c.muted}
                  name="corner-down-left"
                  size={16}
                />
              </Pressable>
            )}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Entry({ entry }: { entry: TerminalEntry }) {
  const done = entry.output !== null;

  return (
    <View style={styles.entry}>
      <View style={styles.commandLine}>
        <Text selectable style={[styles.mono, styles.fill, { color: c.ink }]}>
          <Text style={{ color: c.green }}>{baseName(entry.cwd)}</Text>
          <Text style={{ color: c.accent }}>{" ❯ "}</Text>
          {entry.command}
        </Text>
        {done ? (
          <Text
            style={[styles.mono, { color: entry.failed ? c.red : c.muted }]}
          >{`${entry.failed ? "✗" : "✓"} ${duration(entry.seconds ?? 0)}`}</Text>
        ) : (
          <ActivityIndicator color={c.muted} size="small" />
        )}
      </View>
      {entry.output ? (
        <Text
          selectable
          style={[styles.mono, { color: entry.failed ? c.red : c.muted }]}
        >
          {entry.output}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { opacity: 0.5 },
  window: {
    flex: 1,
    marginHorizontal: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  titleBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 38,
    paddingHorizontal: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  content: { padding: space.md, gap: space.md, flexGrow: 1 },
  empty: { gap: space.xs },
  entry: { gap: 3 },
  commandLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.sm,
  },
  mono: { fontFamily: MONO, fontSize: 12.5, lineHeight: lineOf(18) },
  offerBar: { flexGrow: 0, borderTopWidth: StyleSheet.hairlineWidth },
  offers: {
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  offer: {
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
  },
  prompt: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    minHeight: 52,
    paddingLeft: space.md,
    paddingRight: space.sm,
  },
  cwd: { maxWidth: 96 },
  input: {
    flex: 1,
    minHeight: 44,
    fontFamily: MONO,
    fontSize: 14,
    paddingVertical: 0,
  },
  run: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
