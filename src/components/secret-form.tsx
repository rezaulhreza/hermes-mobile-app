import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { Linking, StyleSheet, Text, View } from 'react-native'

import { space, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

import { Button, Field } from './ui'

interface Props {
  /** What the value is, for the label of the field: "OpenRouter API key". */
  label: string
  /** Where the user gets the value. */
  url?: string
  saveLabel?: string
  onSave: (value: string) => Promise<void>
}

/**
 * One secret: paste it, save it. The value is hidden while it is typed, never
 * goes into a suggestion bar, and is gone from the field after the save.
 */
export function SecretForm({ label, url, saveLabel = 'Save', onSave }: Props) {
  const t = useTheme()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setProblem(null)

    try {
      await onSave(value)
      setValue('')
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.form}>
      <Field
        accessibilityLabel={label}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect={false}
        error={problem}
        label={label}
        onChangeText={setValue}
        placeholder="Paste it here"
        secureTextEntry
        spellCheck={false}
        textContentType="none"
        value={value}
      />
      <View style={styles.row}>
        <Button icon="clipboard" label="Paste" onPress={() => void Clipboard.getStringAsync().then(text => text && setValue(text.trim()))} style={styles.fill} />
        <Button busy={busy} disabled={!value.trim()} label={saveLabel} onPress={() => void save()} style={styles.fill} tone="primary" />
      </View>
      {url ? (
        <Text accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={[type.small, { color: t.accent }]}>
          Get one at {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  form: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md }
})
