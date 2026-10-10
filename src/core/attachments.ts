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

/** Why this file cannot be attached, or null. Base64 length stands in for a size the picker did not give. */
export function attachProblem(file: PickedFile): string | null {
  const size = file.size ?? (file.base64 ? Math.floor((file.base64.length * 3) / 4) : null)

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
