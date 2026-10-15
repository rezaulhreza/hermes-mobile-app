import { Feather } from "@expo/vector-icons";
import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { baseName, type FsEntry, parentPath } from "@/core/workspace";
import { $preferences } from "@/store/preferences";
import {
  $startPoints,
  hostHome,
  listFolders,
  loadStartPoints,
  openRoot,
} from "@/store/workspace";
import { MONO, radius, space, TOUCH, type } from "@/theme/tokens";
import { useTheme } from "@/theme/use-theme";

import { Button, IconButton } from "../ui";

/** Choose the folder on the host to work in: a project, the folder Hermes runs in, a recent one, or a typed path. */
export function RootSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const points = useStore($startPoints);
  const recent = useStore($preferences).roots;
  const [typed, setTyped] = useState("");
  // The folder the browse shows now. Null shows the start points.
  const [browsing, setBrowsing] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      void loadStartPoints().catch(() => undefined);
    }
  }, [visible]);

  const pick = (path: string) => {
    openRoot(path);
    setBrowsing(null);
    onClose();
  };

  const browse = () =>
    void hostHome().then((home) => setBrowsing(home ?? points[0]?.path ?? "/"));

  const known = new Set(points.map((point) => point.path));

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={[styles.fill, { backgroundColor: t.bg }]}>
        <View style={styles.head}>
          <Text style={[type.heading, styles.fill, { color: t.ink }]}>
            Open a folder
          </Text>
          <IconButton icon="x" label="Close" onPress={onClose} />
        </View>
        {browsing ? (
          <Browser
            bottom={insets.bottom}
            key={browsing}
            onOpen={pick}
            onShow={setBrowsing}
            path={browsing}
          />
        ) : (
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={[
              styles.content,
              { paddingBottom: insets.bottom + space.lg },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            <FolderRow
              icon="hard-drive"
              label="Browse the host"
              onPress={browse}
              path="Every folder, from the home folder"
            />
            {points.map((point) => (
              <FolderRow
                icon="folder"
                key={point.path}
                label={point.label}
                onPress={() => pick(point.path)}
                path={point.path}
              />
            ))}
            {recent
              .filter((path) => !known.has(path))
              .map((path) => (
                <FolderRow
                  icon="clock"
                  key={path}
                  label={baseName(path)}
                  onPress={() => pick(path)}
                  path={path}
                />
              ))}
            <Text style={[type.small, styles.label, { color: t.muted }]}>
              Or a path on the host
            </Text>
            <TextInput
              accessibilityLabel="Folder path"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setTyped}
              onSubmitEditing={() => typed.trim() && pick(typed.trim())}
              placeholder="/home/me/project"
              placeholderTextColor={t.muted}
              returnKeyType="go"
              style={[styles.input, { color: t.ink, backgroundColor: t.soft }]}
              value={typed}
            />
            <Button
              disabled={!typed.trim()}
              label="Open this folder"
              onPress={() => pick(typed.trim())}
              tone="primary"
            />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

/** One folder of the host and the folders in it. A tap goes in; the button opens the folder shown. */
function Browser({
  path,
  bottom,
  onShow,
  onOpen,
}: {
  path: string;
  bottom: number;
  onShow: (path: string | null) => void;
  onOpen: (path: string) => void;
}) {
  const t = useTheme();
  const [folders, setFolders] = useState<FsEntry[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const above = parentPath(path);

  useEffect(() => {
    let cancelled = false;

    listFolders(path)
      .then((found) => !cancelled && setFolders(found))
      .catch(
        (error) =>
          !cancelled &&
          setProblem(error instanceof Error ? error.message : String(error)),
      );

    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <View style={styles.fill}>
      <View style={[styles.where, { borderBottomColor: t.line }]}>
        <IconButton
          icon="arrow-left"
          label="Back to the start folders"
          onPress={() => onShow(null)}
        />
        <IconButton
          disabled={!above}
          icon="corner-left-up"
          label="Folder above"
          onPress={() => above && onShow(above)}
        />
        <Text
          ellipsizeMode="head"
          numberOfLines={1}
          style={[styles.path, { color: t.ink }]}
        >
          {path}
        </Text>
      </View>
      <FlatList
        automaticallyAdjustKeyboardInsets
        ListEmptyComponent={
          <View style={styles.note}>
            {folders || problem ? (
              <Text
                style={[type.body, { color: t.muted, textAlign: "center" }]}
              >
                {problem ?? "No folder in here."}
              </Text>
            ) : (
              <ActivityIndicator color={t.muted} />
            )}
          </View>
        }
        data={folders ?? []}
        initialNumToRender={20}
        keyExtractor={(entry) => entry.path}
        renderItem={({ item }) => (
          <Pressable
            accessibilityLabel={`Go into ${item.name}`}
            accessibilityRole="button"
            onPress={() => onShow(item.path)}
            style={({ pressed }) => [
              styles.entry,
              { borderBottomColor: t.line },
              pressed && { backgroundColor: t.soft },
            ]}
          >
            <Feather color={t.accent} name="folder" size={18} />
            <Text
              numberOfLines={1}
              style={[type.body, styles.fill, { color: t.ink }]}
            >
              {item.name}
            </Text>
            <Feather color={t.muted} name="chevron-right" size={16} />
          </Pressable>
        )}
      />
      <View
        style={[
          styles.foot,
          { borderTopColor: t.line, paddingBottom: bottom + space.md },
        ]}
      >
        <Button
          icon="check"
          label={`Open ${baseName(path)}`}
          onPress={() => onOpen(path)}
          tone="primary"
        />
      </View>
    </View>
  );
}

function FolderRow({
  icon,
  label,
  path,
  onPress,
}: {
  icon: "folder" | "clock" | "hard-drive";
  label: string;
  path: string;
  onPress: () => void;
}) {
  const t = useTheme();

  return (
    <Pressable
      accessibilityLabel={`Folder: ${label}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: t.paper, borderColor: t.line },
        pressed && styles.dim,
      ]}
    >
      <Feather color={t.muted} name={icon} size={18} />
      <View style={styles.fill}>
        <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
          {label}
        </Text>
        <Text
          ellipsizeMode="head"
          numberOfLines={1}
          style={[type.small, { color: t.muted }]}
        >
          {path}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dim: { opacity: 0.6 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    padding: space.lg,
    gap: space.md,
  },
  content: { paddingHorizontal: space.lg, gap: space.sm },
  label: { marginTop: space.md, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: TOUCH + space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  where: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.md,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  path: { flex: 1, fontFamily: MONO, fontSize: 12 },
  note: { padding: space.xl, alignItems: "center" },
  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: TOUCH,
    paddingHorizontal: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  foot: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    minHeight: TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    fontFamily: MONO,
    fontSize: 14,
  },
});
