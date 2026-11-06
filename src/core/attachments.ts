/**
 * Files the user adds to a message. A file on the phone is not visible to the
 * backend, so its bytes travel in the attach request itself.
 *
 * The backend has three ways in, and each one reaches the model differently:
 * - an image is held on the session and joins the next prompt by itself;
 * - a PDF becomes page images, held the same way, plus a line of text;
 * - any other file is saved on the host and the prompt names it (`@file:`).
 */

import { withoutMentionNote } from './mentions'

export type AttachmentKind = 'image' | 'pdf' | 'file'

/** A file as a picker returns it. */
export interface PickedFile {
  uri: string
  name: string
  mimeType?: string | null
  size?: number | null
  /** Set when the picker already read the bytes (the image picker does). */
  base64?: string | null
}

export interface Attachment {
  id: string
  kind: AttachmentKind
  name: string
  state: 'uploading' | 'ready' | 'failed'
  error?: string
  /** Host paths of the images the backend holds for the next prompt. Needed to take them back. */
  heldPaths: string[]
  /** Text the prompt must carry for the model to see this attachment. */
  promptText: string
  /** Where the picker left an image on the phone. The preview reads it; nothing is downloaded. */
  uri?: string
  size?: number
  /** A file of a group chat that the room itself holds: every bot of the room can open it. */
  roomFile?: RoomFile
}

/** A file a group chat holds, as the room engine of Hermes describes it. No bytes: those are one request away. */
export interface RoomFile {
  attachment_id: string
  kind: string
  name: string
  mime: string
  size?: number
}

/** The largest file a room takes (the limit of the Hermes room engine). A larger one goes by its path on the host. */
export const ROOM_FILE_MAX_BYTES = 15_000_000

/** The kind the room engine takes for a type of file: image, pdf or file. */
export const roomFileKind = (mime: string): AttachmentKind => (mime.startsWith('image/') ? 'image' : mime === 'application/pdf' ? 'pdf' : 'file')

/** The room files of a list of staged files, ready for the message. */
export const roomFilesOf = (attachments: readonly Attachment[]): RoomFile[] =>
  attachments.flatMap(attachment => (attachment.state === 'ready' && attachment.roomFile ? [attachment.roomFile] : []))

/** The answer of the room for an upload. Null when it is not one. */
export function roomFileOf(answer: unknown): RoomFile | null {
  const { attachment_id, kind, name, mime, size } = (answer ?? {}) as Record<string, unknown>

  return typeof attachment_id === 'string' && attachment_id
    ? { attachment_id, kind: typeof kind === 'string' ? kind : 'file', name: typeof name === 'string' ? name : 'File', mime: typeof mime === 'string' ? mime : '', ...(typeof size === 'number' ? { size } : {}) }
    : null
}

/** An attachment as a sent message shows it. A message from stored history has the name only. */
export interface SentAttachment {
  name: string
  /** What a person reads in the place of the name, for a file whose name says nothing ("Pasted content"). */
  title?: string
  kind: AttachmentKind
  /** The copy on the phone. A message sent from this phone, in this run of the app, has one. */
  uri?: string
  /** Where the file is on the Hermes host. A message from stored history has only this. */
  path?: string
  size?: number
}

export function sentAttachment({ name, kind, uri, size }: Attachment): SentAttachment {
  return { name, kind, ...(uri ? { uri } : {}), ...(size ? { size } : {}) }
}

/**
 * How the phone can show a file. `image`: full screen, with zoom. `text`: the
 * app draws the text itself. `web`: the system web view draws it (PDF, office
 * documents, audio, video). `none`: nothing on a phone draws it; it can only
 * be shared to another app.
 */
export type PreviewMode = 'image' | 'text' | 'web' | 'none'

const WEB_PREVIEW = /\.(pdf|html?|rtf|docx?|xlsx?|pptx?|pages|numbers|key)$/i
const TEXT_PREVIEW = /\.(txt|md|markdown|log|csv|tsv|env|ini|conf|lock)$/i

export function previewMode(name: string, kind: AttachmentKind): PreviewMode {
  const glyph = fileGlyph(name, kind)

  // The picture view cannot draw an SVG. The system web view can.
  if (glyph === 'image' && /\.svg$/i.test(name)) {
    return 'web'
  }

  if (glyph === 'image') {
    return 'image'
  }

  if (WEB_PREVIEW.test(name) || glyph === 'video' || glyph === 'audio') {
    return 'web'
  }

  return glyph === 'code' || TEXT_PREVIEW.test(name) ? 'text' : 'none'
}

export function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name)
}

// A preview is for reading, not for loading a whole log into a text view.
const TEXT_PREVIEW_CHARS = 200_000

/** The text a preview shows, and whether the end was cut. */
export function previewText(text: string): { text: string; cut: boolean } {
  return text.length > TEXT_PREVIEW_CHARS ? { text: text.slice(0, TEXT_PREVIEW_CHARS), cut: true } : { text, cut: false }
}

/** The byte count of a picked file. Base64 length stands in for a size the picker did not give. */
export function pickedSize(file: PickedFile): number | null {
  return file.size ?? (file.base64 ? Math.floor((file.base64.length * 3) / 4) : null)
}

export type FileGlyph = 'image' | 'text' | 'video' | 'audio' | 'archive' | 'code' | 'file'

const GLYPH_BY_EXTENSION: readonly [FileGlyph, RegExp][] = [
  ['text', /\.(pdf|txt|md|rtf|docx?|pages|csv|xlsx?|numbers|pptx?|key)$/i],
  ['video', /\.(mp4|mov|m4v|webm|mkv|avi|mpe?g|3gp|3g2)$/i],
  ['audio', /\.(mp3|m4a|wav|aac|flac|ogg|opus)$/i],
  ['archive', /\.(zip|tar|gz|tgz|bz2|7z|rar)$/i],
  ['code', /\.(js|jsx|ts|tsx|py|rb|go|rs|swift|kt|java|c|h|cpp|cs|php|sh|json|ya?ml|toml|xml|html?|css|sql)$/i]
]

/** Which picture stands for this file in a list. */
export function fileGlyph(name: string, kind: AttachmentKind): FileGlyph {
  if (kind === 'image') {
    return 'image'
  }

  return GLYPH_BY_EXTENSION.find(([, pattern]) => pattern.test(name))?.[0] ?? (kind === 'pdf' ? 'text' : 'file')
}

/**
 * One attach request is one WebSocket frame, and the gateway caps a frame at
 * 16 MiB. Base64 makes the bytes a third larger, so 12 MiB of file is the limit.
 */
export const ATTACH_MAX_BYTES = 12 * 1024 * 1024

// The backend resizes what the model sees. More pixels than this only cost upload time.
export const PHOTO_LONG_SIDE = 2048

/**
 * The new size of a photo that is larger than the model needs, as the one
 * side to set (the other side follows). Null when the photo is small enough.
 */
export function shrinkTarget(width: number, height: number, longSide = PHOTO_LONG_SIDE): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= longSide) {
    return null
  }

  return width >= height ? { width: longSide } : { height: longSide }
}

/** A resized photo is saved as JPEG, so its name must say so. */
export function jpegName(name: string): string {
  return `${name.replace(/\.[^./]+$/, '')}.jpg`
}

// The pictures that Hermes reads: it opens HEIC and AVIF with its own decoders, and draws an SVG to a PNG first.
const IMAGE_NAME = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp|tiff?|ico|svg)$/i

export function attachmentKind(file: Pick<PickedFile, 'name' | 'mimeType'>): AttachmentKind {
  const mime = file.mimeType?.toLowerCase() ?? ''

  if (mime.startsWith('image/') || (!mime && IMAGE_NAME.test(file.name))) {
    return 'image'
  }

  return mime === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : 'file'
}

/** A larger file goes to the host as a stream, with no base64. The host takes up to this much. */
export const STREAM_MAX_BYTES = 100 * 1024 * 1024

/** A file over the frame limit cannot ride the gateway socket. It goes up by the REST upload. */
export function needsStream(size: number | null): boolean {
  return size !== null && size > ATTACH_MAX_BYTES
}

/** Why this file cannot be attached, or null. */
export function attachProblem(file: PickedFile): string | null {
  const size = pickedSize(file)

  if (size !== null && size > STREAM_MAX_BYTES) {
    return `${file.name} is too large to send from the phone (limit 100 MB).`
  }

  return null
}

/** The folder of the host that large uploads of the phone go to, under the folder the host lets the app write in. */
export const UPLOAD_FOLDER = '.hermes-phone-uploads'

/**
 * Where a streamed upload goes on the host. A host with a locked files root
 * takes a path inside it, written from the root. Any other host needs a whole
 * path: the folder its file routes start in (the home folder), with the
 * separator that host uses.
 */
export function uploadTarget(listing: { path?: string | null; locked_root?: string | null }, name: string, stamp: number): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '') || 'file'
  const file = `${stamp.toString(36)}-${safe}`

  if (listing.locked_root) {
    return `${UPLOAD_FOLDER}/${file}`
  }

  const base = (listing.path ?? '').replace(/[\\/]+$/, '')
  const slash = base.includes('\\') && !base.includes('/') ? '\\' : '/'

  return `${base}${slash}${UPLOAD_FOLDER}${slash}${file}`
}

export function dataUrl(file: Pick<PickedFile, 'mimeType'>, base64: string): string {
  return `data:${file.mimeType || 'application/octet-stream'};base64,${base64}`
}

/**
 * The text of a prompt with its attachments. File references and PDF lines go
 * after the user's words. A prompt of images alone still needs text, so it
 * names the images the way the backend does for a dropped image.
 */
/**
 * The line that names a file in a message to a group chat, in the form the
 * app reads back as an attachment (`splitStoredPrompt`). A bot of the group
 * reads the path and opens the file with its own tools.
 */
export function roomFileLine(path: string, kind: AttachmentKind): string {
  return `@${kind === 'image' ? 'image' : 'file'}:${/\s/.test(path) ? `"${path}"` : path}`
}

export function promptWithAttachments(text: string, attachments: readonly Attachment[]): string {
  const ready = attachments.filter(attachment => attachment.state === 'ready')
  const extra = ready.map(attachment => attachment.promptText).filter(Boolean)
  const words = text.trim()

  // A file the room holds goes with the message itself: it needs no line in the text.
  if (!words && !extra.length && ready.every(attachment => attachment.roomFile)) {
    return ''
  }

  if (!words && !extra.length) {
    return ready.map(attachment => `[User attached image: ${attachment.name}]`).join('\n')
  }

  return [words, ...extra].filter(Boolean).join('\n')
}

// The backend adds the content of every reference under this line before it stores the prompt.
const ATTACHED_CONTEXT = /(?:^|\n)--- (?:Attached Context|Context Warnings) ---[\s\S]*$/
const REF_LINE = /^@(file|image):(?:"([^"]+)"|'([^']+)'|`([^`]+)`|(\S+))$/
// The backend adds one such line per picture it holds for the prompt. The `@image:` line already names the picture.
const PICTURE_MARK = /^\[(screenshot|image)\]$/i
const HELD_LINE = /^\[User attached (image|PDF): (.+?)(?: \(\d+ page\(s\)\))?\]$/
// The backend names the file of a picture it saved for the prompt.
const IMAGE_AT_LINE = /^\[Image attached at: (.+)\]$/
// A note a host plugin adds under the words of a turn about the browser, for the agent only.
const ROUTING_NOTE = /\n*\[Tool routing for [\s\S]*\]\s*$/

/**
 * A stored user message, as the user wrote it: the words, and the names of
 * the files that went with them. The app sends each attachment as a line of
 * its own under the words (see `promptWithAttachments`), and the desktop app
 * puts its lines over the words, so only such lines at one of the two ends
 * count. A reference inside a sentence stays in the sentence.
 */
export function splitStoredPrompt(stored: string): { text: string; attached: SentAttachment[] } {
  // The note that says which bots a mention means is for the agent too.
  const lines = withoutMentionNote(stored.replace(ATTACHED_CONTEXT, '').replace(ROUTING_NOTE, '')).trimEnd().split('\n')
  const attached: SentAttachment[] = []

  while (lines.length) {
    const line = lines[lines.length - 1].trim()
    const ref = REF_LINE.exec(line)
    const held = HELD_LINE.exec(line)
    const saved = IMAGE_AT_LINE.exec(line)

    if (ref) {
      attached.unshift(referred(ref))
    } else if (PICTURE_MARK.test(line)) {
      // Nothing to show for it.
    } else if (held) {
      attached.unshift({ name: held[2], kind: held[1] === 'PDF' ? 'pdf' : 'image' })
    } else if (saved) {
      attached.unshift({ name: saved[1].split(/[\\/]/).pop() ?? 'picture', kind: 'image', path: saved[1] })
    } else if (line) {
      break
    }

    lines.pop()
  }

  // The desktop app: the files first, then the words.
  const over: SentAttachment[] = []

  while (lines.length) {
    const line = lines[0].trim()
    const ref = REF_LINE.exec(line)

    if (ref) {
      over.push(referred(ref))
    } else if (line) {
      break
    }

    lines.shift()
  }

  return { text: lines.join('\n').trim(), attached: [...over, ...attached] }
}

/** A stored message in one line of words, for a title or a row: its words, or what was sent when it has no words. */
export function messageWords(stored: string): string {
  const { text, attached } = splitStoredPrompt(stored)

  if (text || !attached.length) {
    return text
  }

  const what = attached.every(file => file.kind === 'image') ? 'picture' : 'file'

  return attached.length === 1 ? `A ${what}` : `${attached.length} ${what}s`
}

/** The file of a reference line. A text the desktop app saved from a long paste has the name the desktop app shows for it. */
function referred(ref: RegExpExecArray): SentAttachment {
  const path = ref[2] ?? ref[3] ?? ref[4] ?? ref[5]
  const name = path.split('/').pop() ?? ''
  const title = /^pasted_content_.*\.txt$/.test(name) ? { title: 'Pasted content' } : {}

  return { name, ...title, kind: ref[1] === 'image' ? 'image' : attachmentKind({ name }), path }
}
