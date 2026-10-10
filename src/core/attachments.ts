/**
 * Files the user adds to a message. A file on the phone is not visible to the
 * backend, so its bytes travel in the attach request itself.
 *
 * The backend has three ways in, and each one reaches the model differently:
 * - an image is held on the session and joins the next prompt by itself;
 * - a PDF becomes page images, held the same way, plus a line of text;
 * - any other file is saved on the host and the prompt names it (`@file:`).
 */

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
}

/** An attachment as a sent message shows it. A message from stored history has the name only. */
export interface SentAttachment {
  name: string
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
  ['video', /\.(mp4|mov|m4v|webm|mkv|avi)$/i],
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

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|heic|heif|bmp|tiff?)$/i

export function attachmentKind(file: Pick<PickedFile, 'name' | 'mimeType'>): AttachmentKind {
  const mime = file.mimeType?.toLowerCase() ?? ''

  if (mime.startsWith('image/') || (!mime && IMAGE_NAME.test(file.name))) {
    return 'image'
  }

  return mime === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'pdf' : 'file'
}

/** Why this file cannot be attached, or null. */
export function attachProblem(file: PickedFile): string | null {
  const size = pickedSize(file)

  if (size !== null && size > ATTACH_MAX_BYTES) {
    return `${file.name} is too large to send from the phone (limit 12 MB).`
  }

  return null
}

export function dataUrl(file: Pick<PickedFile, 'mimeType'>, base64: string): string {
  return `data:${file.mimeType || 'application/octet-stream'};base64,${base64}`
}

/**
 * The text of a prompt with its attachments. File references and PDF lines go
 * after the user's words. A prompt of images alone still needs text, so it
 * names the images the way the backend does for a dropped image.
 */
export function promptWithAttachments(text: string, attachments: readonly Attachment[]): string {
  const ready = attachments.filter(attachment => attachment.state === 'ready')
  const extra = ready.map(attachment => attachment.promptText).filter(Boolean)
  const words = text.trim()

  if (!words && !extra.length) {
    return ready.map(attachment => `[User attached image: ${attachment.name}]`).join('\n')
  }

  return [words, ...extra].filter(Boolean).join('\n')
}

// The backend adds the content of every reference under this line before it stores the prompt.
const ATTACHED_CONTEXT = /(?:^|\n)--- (?:Attached Context|Context Warnings) ---[\s\S]*$/
const FILE_REF_LINE = /^@file:(?:"([^"]+)"|'([^']+)'|`([^`]+)`|(\S+))$/
const HELD_LINE = /^\[User attached (image|PDF): (.+?)(?: \(\d+ page\(s\)\))?\]$/

/**
 * A stored user message, as the user wrote it: the words, and the names of
 * the files that went with them. The app sends each attachment as a line of
 * its own under the words (see `promptWithAttachments`), so only such lines
 * count. A reference inside a sentence stays in the sentence.
 */
export function splitStoredPrompt(stored: string): { text: string; attached: SentAttachment[] } {
  const lines = stored.replace(ATTACHED_CONTEXT, '').trimEnd().split('\n')
  const attached: SentAttachment[] = []

  while (lines.length) {
    const line = lines[lines.length - 1].trim()
    const file = FILE_REF_LINE.exec(line)
    const held = HELD_LINE.exec(line)

    if (file) {
      const path = file[1] ?? file[2] ?? file[3] ?? file[4]
      const name = path.split('/').pop() ?? ''

      attached.unshift({ name, kind: attachmentKind({ name }), path })
    } else if (held) {
      attached.unshift({ name: held[2], kind: held[1] === 'PDF' ? 'pdf' : 'image' })
    } else if (line) {
      break
    }

    lines.pop()
  }

  return { text: lines.join('\n').trim(), attached }
}
