import { router, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { IconButton, Notice } from '@/components/ui'
import { fileSize } from '@/core/format'
import { baseName, editProblem, type TextFile } from '@/core/workspace'
import { readFile, saveFile } from '@/store/workspace'
import { MONO, space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

function words(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^\d{3}: /, '').replace(/^\{"detail":"(.*)"\}$/, '$1')
}

/**
 * One text file of the host: read it, change it, save it. The text is held
 * by this screen only, and is gone when the screen closes.
 */
export default function FileScreen() {
  const t = useTheme()
  const { path } = useLocalSearchParams<{ path: string }>()
  const [file, setFile] = useState<TextFile | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    readFile(path)
      .then(result => {
        if (!cancelled) {
          setFile(result)
          setDraft(result.text)
        }
      })
      .catch(error => !cancelled && setFailure(words(error)))

    return () => {
      cancelled = true
    }
  }, [path])

  const changed = file !== null && draft !== file.text
  const refusal = file ? editProblem(file) : null

  const save = () => {
    if (!file) {
      return
    }

    setSaving(true)
    saveFile(path, draft, file.text)
      .then(() => {
        // The host counts the size in bytes of UTF-8, not in characters.
        setFile({ ...file, text: draft, byteSize: new Blob([draft]).size })
        setEditing(false)
      })
      .catch(error => Alert.alert('Not saved', words(error)))
      .finally(() => setSaving(false))
  }

  const leave = () => {
    if (changed) {
      Alert.alert('Leave without saving?', 'Your changes to this file are lost.', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => router.back() }
      ])
    } else {
      router.back()
    }
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.fill, { backgroundColor: t.bg }]}>
      <View style={[styles.header, { borderBottomColor: t.line }]}>
        <IconButton icon="chevron-left" label="Back" onPress={leave} />
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[type.label, { color: t.ink }]}>
            {baseName(path)}
          </Text>
          <Text ellipsizeMode="head" numberOfLines={1} style={[type.small, { color: t.muted }]}>
            {file ? `${fileSize(file.byteSize)}${changed ? '  ·  not saved' : ''}` : path}
          </Text>
        </View>
        {saving ? <ActivityIndicator color={t.muted} /> : null}
        {file && !refusal && !editing ? <IconButton icon="edit-2" label="Edit the file" onPress={() => setEditing(true)} /> : null}
        {editing ? <IconButton disabled={!changed || saving} filled icon="check" label="Save the file" onPress={save} /> : null}
      </View>

      {failure ? (
        <Notice detail={failure} icon="alert-triangle" title="Could not read the file" />
      ) : !file ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.muted} />
        </View>
      ) : file.binary ? (
        <Notice detail="The app shows and edits text files." icon="file" title="This file is not text" />
      ) : editing ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
          <TextInput
            accessibilityLabel="File text"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            onChangeText={setDraft}
            scrollEnabled
            spellCheck={false}
            style={[styles.editor, { color: t.ink }]}
            textAlignVertical="top"
            value={draft}
          />
        </KeyboardAvoidingView>
      ) : (
        <ScrollView>
          {refusal ? <Text style={[type.small, styles.refusal, { color: t.muted }]}>{refusal}</Text> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text selectable style={[styles.mono, { color: t.ink }]}>
              {file.text}
            </Text>
          </ScrollView>
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  refusal: { paddingHorizontal: space.lg, paddingTop: space.md },
  mono: { fontFamily: MONO, fontSize: 12, lineHeight: 18, padding: space.lg },
  editor: { flex: 1, fontFamily: MONO, fontSize: 13, lineHeight: 19, padding: space.lg }
})
