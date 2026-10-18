/**
 * The drawn avatar of a bot: a shape with a face, in a colour. The desktop
 * app has the same ones, and both keep the choice in the record of the bot
 * (`ui_meta` of its profile, under "hermes-bots": `shape`, `color`), so a
 * bot looks the same on both. A photo is a different thing: it is a file of
 * the profile (the "avatar" asset), and it wins over the drawn avatar.
 *
 * The rules are copies of the desktop app's: `botAppearance` and
 * `defaultShapeFor` in its `hermes-bots` plugin, `profileColor` in
 * `lib/profile-color.ts`.
 */

/** The shapes the phone can draw. The desktop app has more (its "blob" faces come from a library the phone does not have). */
export const AVATAR_SHAPES = ['circle', 'squircle', 'pill', 'triangle', 'hexagon', 'cloud', 'drop'] as const

export type AvatarShape = (typeof AVATAR_SHAPES)[number]

/** The colours of the picker: twelve hues, in the text form the desktop app stores. */
export const AVATAR_COLOURS: readonly string[] = Array.from({ length: 12 }, (_, index) => `hsl(${index * 30} 68% 58%)`)

/** The colour of the main bot, and of a bot with no name yet. */
const MAIN_COLOUR = '#8b5cf6'

export interface Look {
  shape: AvatarShape
  /** A colour as the record holds it: "#8b5cf6" or "hsl(210 68% 58%)". */
  color: string
}

const isShape = (value: unknown): value is AvatarShape => AVATAR_SHAPES.includes(value as AvatarShape)

function hash(text: string): number {
  let sum = 0

  for (const letter of text) {
    sum = (sum * 31 + letter.charCodeAt(0)) >>> 0
  }

  return sum
}

/** The look a bot has when nobody chose one: a shape and a hue from its name, the same on every screen. */
export function defaultLook(name: string): Look {
  const key = name.trim()

  return key && key.toLowerCase() !== 'default'
    ? { shape: AVATAR_SHAPES[hash(key) % AVATAR_SHAPES.length], color: `hsl(${hash(key) % 360} 68% 58%)` }
    : { shape: 'squircle', color: MAIN_COLOUR }
}

/**
 * The drawn avatar of a bot, from its record. Null when the record names a
 * shape the phone cannot draw: the bot then shows its letters until the
 * desktop app sends a picture of that shape.
 */
export function lookOf(name: string, meta: Readonly<Record<string, unknown>>): Look | null {
  const fallback = defaultLook(name)

  // The main bot keeps its own look until the user gave it another.
  if (name.trim().toLowerCase() === 'default' && meta.custom !== true) {
    return fallback
  }

  if (typeof meta.shape === 'string' && meta.shape && !isShape(meta.shape)) {
    return null
  }

  return { shape: isShape(meta.shape) ? meta.shape : fallback.shape, color: typeof meta.color === 'string' && meta.color ? meta.color : fallback.color }
}

/** What goes into the record of a bot for a look the user chose. `custom` tells the desktop app that it was chosen. */
export function lookMeta(look: Look): { shape: string; color: string; custom: true } {
  return { shape: look.shape, color: look.color, custom: true }
}

/** A colour of the record in the form the phone draws: "hsl(210 68% 58%)" is "hsl(210, 68%, 58%)". */
export function paint(color: string): string {
  const hsl = /^hsl\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%\s*\)$/i.exec(color.trim())

  return hsl ? `hsl(${hsl[1]}, ${hsl[2]}%, ${hsl[3]}%)` : color.trim()
}

/** A dark body has light eyes, so the face still shows. */
export function isDarkColour(color: string): boolean {
  const hsl = /^hsl\(\s*[\d.]+(?:deg)?[\s,]+[\d.]+%[\s,]+([\d.]+)%\s*\)$/i.exec(color.trim())

  if (hsl) {
    return Number(hsl[1]) < 40
  }

  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())

  if (!hex) {
    return false
  }

  const value = parseInt(hex[1], 16)

  return 0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255) < 110
}
