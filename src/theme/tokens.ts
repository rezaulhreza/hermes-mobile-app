import { Platform } from 'react-native'

/**
 * Colour and shape tokens. The palette comes from the design prototype: warm
 * paper in light mode, soft charcoal in dark mode, one terracotta accent.
 */
export interface Palette {
  bg: string
  paper: string
  ink: string
  muted: string
  line: string
  soft: string
  accent: string
  accentBg: string
  onAccent: string
  purple: string
  purpleBg: string
  green: string
  greenBg: string
  red: string
  redBg: string
}

export const light: Palette = {
  bg: '#f8f7f4',
  paper: '#ffffff',
  ink: '#22252c',
  muted: '#666c76',
  line: '#e6e4e0',
  soft: '#efeeeb',
  accent: '#a13e26',
  accentBg: '#f9e9e2',
  onAccent: '#ffffff',
  purple: '#6550a4',
  purpleBg: '#efebf9',
  green: '#27765c',
  greenBg: '#e6f2eb',
  red: '#ad333a',
  redBg: '#f9e6e6'
}

export const dark: Palette = {
  bg: '#18191d',
  paper: '#23252b',
  ink: '#f3f1ee',
  muted: '#b1b4bf',
  line: '#373940',
  soft: '#2c2e35',
  accent: '#f2ac91',
  accentBg: '#442d28',
  onAccent: '#222222',
  purple: '#c2b2ff',
  purpleBg: '#353047',
  green: '#9cdbc0',
  greenBg: '#203e33',
  red: '#ffa0a5',
  redBg: '#4a2a2d'
}

/** A colour of the palette, part of the way to clear: for a fill or a line that must work on any ground. */
export function fade(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16)

  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

export const radius = { sm: 10, md: 14, lg: 22, pill: 999 } as const


/**
 * The height of a line of text, a hair under the whole number. iOS draws a
 * text in a box of the height that the layout gave it. In a tall list that
 * height comes out a fraction short (68.9998 for three lines of 23), and iOS
 * then leaves the last line out and lets the line before it run off the
 * edge. A line height that is not a whole number of pixels makes the layout
 * round the box up, so the box always has a little room. The 0.07 is small
 * enough not to be seen and does not add up to a whole pixel under a hundred
 * lines.
 */
export const lineOf = (height: number) => height - 0.07

export const type = {
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  heading: { fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: lineOf(23) },
  label: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 13 }
} as const

/** `Menlo` exists on iOS only. Android names its fixed-width font `monospace`. */
export const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' })

/** Minimum touch target, in points. */
export const TOUCH = 44

/** At this width and above, the app shows a list and a detail pane side by side. */
export { TABLET_MIN_WIDTH } from '@/core/layout'
