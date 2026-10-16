import { Feather, MaterialCommunityIcons } from '@expo/vector-icons'
import type { ComponentProps, ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle
} from 'react-native'

import { radius, space, TOUCH, type } from '@/theme/tokens'
import { useTheme } from '@/theme/use-theme'

export type IconName = ComponentProps<typeof Feather>['name']

interface ButtonProps {
  label: string
  onPress: () => void
  icon?: IconName
  tone?: 'primary' | 'plain' | 'danger'
  busy?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
}

export function Button({ label, onPress, icon, tone = 'plain', busy, disabled, style }: ButtonProps) {
  const t = useTheme()
  const background = tone === 'primary' ? t.ink : t.paper
  const colour = tone === 'primary' ? t.bg : tone === 'danger' ? t.red : t.ink

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, borderColor: tone === 'primary' ? t.ink : t.line },
        (pressed || disabled) && styles.dim,
        style
      ]}
    >
      {busy ? <ActivityIndicator color={colour} /> : icon ? <Feather color={colour} name={icon} size={18} /> : null}
      <Text style={[type.label, { color: colour }]}>{label}</Text>
    </Pressable>
  )
}

interface IconButtonProps {
  /** `waveform` is the sign of Live voice. The line icons have no waveform, so it comes from another set. */
  icon: IconName | 'waveform'
  label: string
  onPress: () => void
  filled?: boolean
  disabled?: boolean
}

export function IconButton({ icon, label, onPress, filled, disabled }: IconButtonProps) {
  const t = useTheme()

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: filled ? t.ink : t.soft },
        (pressed || disabled) && styles.dim
      ]}
    >
      {icon === 'waveform' ? (
        <MaterialCommunityIcons color={filled ? t.bg : t.ink} name="waveform" size={22} />
      ) : (
        <Feather color={filled ? t.bg : t.ink} name={icon} size={20} />
      )}
    </Pressable>
  )
}

interface FieldProps extends TextInputProps {
  label: string
  error?: string | null
}

export function Field({ label, error, style, ...input }: FieldProps) {
  const t = useTheme()

  return (
    <View style={styles.field}>
      <Text style={[type.small, { color: t.muted, fontWeight: '600' }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={t.muted}
        style={[
          styles.input,
          type.body,
          { backgroundColor: t.paper, borderColor: error ? t.red : t.line, color: t.ink },
          style
        ]}
        {...input}
      />
      {error ? <Text style={[type.small, { color: t.red }]}>{error}</Text> : null}
    </View>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme()

  return <View style={[styles.card, { backgroundColor: t.paper, borderColor: t.line }, style]}>{children}</View>
}

/** A full-area message for the empty, loading and error states of a screen. */
export function Notice({ icon, title, detail, action }: { icon: IconName; title: string; detail?: string; action?: ReactNode }) {
  const t = useTheme()

  return (
    <View style={styles.notice}>
      <Feather color={t.muted} name={icon} size={28} />
      <Text style={[type.heading, { color: t.ink, textAlign: 'center' }]}>{title}</Text>
      {detail ? <Text style={[type.body, { color: t.muted, textAlign: 'center' }]}>{detail}</Text> : null}
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth
  },
  iconButton: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center'
  },
  dim: { opacity: 0.55 },
  field: { gap: space.xs + 2 },
  input: {
    minHeight: TOUCH + 4,
    paddingHorizontal: space.md + 2,
    borderRadius: radius.md,
    borderWidth: 1
  },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl }
})
