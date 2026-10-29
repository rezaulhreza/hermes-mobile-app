import { Platform } from 'react-native'

/**
 * Colour and shape tokens: cool graphite greys and one lime accent.
 *
 * Lime on a light ground cannot carry text (1.3:1), so the accent has two
 * roles. `accent` is for text, icons and lines: olive in light mode, lime in
 * dark mode. `accentFill` is the lime of a button, a badge or a mark, always
 * with `onAccent` (ink) on it.
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
  accentFill: string
  onAccent: string
  green: string
  greenBg: string
  red: string
  redBg: string
}

export const light: Palette = {
  bg: '#f5f6f8',
  paper: '#ffffff',
  ink: '#14171c',
  muted: '#5d6470',
  line: '#e2e5ea',
  soft: '#eceef2',
  accent: '#4d6a00',
  accentBg: '#eef7d4',
  accentFill: '#c6f432',
  onAccent: '#14171c',
  green: '#1d7a50',
  greenBg: '#e3f2e9',
  red: '#b3261e',
  redBg: '#fbe7e6'
}

export const dark: Palette = {
  bg: '#111317',
  paper: '#1a1d22',
  ink: '#eceef2',
  muted: '#9aa1ad',
  line: '#2a2e35',
  soft: '#22262c',
  accent: '#c6f432',
  accentBg: '#2a3312',
  accentFill: '#c6f432',
  onAccent: '#14171c',
  green: '#7dd3a8',
  greenBg: '#16302a',
  red: '#ff9ea6',
  redBg: '#3e1f24'
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
