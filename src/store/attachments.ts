/**
 * Attachments staged for the next message of each conversation. Picking a
 * file uploads it at once, so the send button only has to wait for the list
 * to settle.
 */

import * as Clipboard from 'expo-clipboard'
import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import { map } from 'nanostores'

import {
  type Attachment,
  attachmentKind,
  roomFileLine,
  attachProblem,
  dataUrl,
  jpegName,
  needsStream,
  type PickedFile,
  pickedSize,
  shrinkTarget,
  uploadTarget
} from '@/core/attachments'
import { HttpError } from '@/core/api'
import type { AttachedImageResult, FileAttachResult, PdfAttachResult } from '@/core/gateway/gateway-contract.generated'

import { $linkState, currentApi, rpc } from './link'

export const $attachments = map<Record<string, Attachment[]>>({})

export type AttachSource = 'photos' | 'camera' | 'files' | 'clipboard'

// A 12 MB file over a phone connection needs more than the default request time.
const UPLOAD_TIMEOUT_MS = 180_000
const PHOTO_LIMIT = 6
const PHOTO_QUALITY = 0.8

let lastId = 0

function update(sessionId: string, change: (list: Attachment[]) => Attachment[]): void {
  $attachments.setKey(sessionId, change($attachments.get()[sessionId] ?? []))
}

/** One picked photo or video. A photo larger than the model needs is made smaller first, so it uploads fast and fits the limit. */
async function fitted(asset: ImagePicker.ImagePickerAsset, index: number): Promise<PickedFile> {
  // A video goes up as the file it is: the picker gives its address and its size, and no bytes. It has no base64 to hold in memory.
  if (asset.type === 'video') {
    return { uri: asset.uri, name: asset.fileName || `video-${index + 1}.mov`, mimeType: asset.mimeType ?? 'video/quicktime', size: asset.fileSize }
  }

  const name = asset.fileName || `photo-${index + 1}.jpg`
  const target = shrinkTarget(asset.width, asset.height)

  if (target) {
    try {
      const image = await ImageManipulator.manipulate(asset.uri).resize(target).renderAsync()
      const saved = await image.saveAsync({ base64: true, compress: PHOTO_QUALITY, format: SaveFormat.JPEG })

      return { uri: saved.uri, name: jpegName(name), mimeType: 'image/jpeg', base64: saved.base64 }
    } catch {
      // The photo as it is can still be within the limit.
    }
  }

  return { uri: asset.uri, name, mimeType: asset.mimeType ?? 'image/jpeg', size: asset.fileSize, base64: asset.base64 }
}

function fromImages(result: ImagePicker.ImagePickerResult): Promise<PickedFile[]> {
  return Promise.all((result.assets ?? []).map(fitted))
}

let pasted = 0

async function fromClipboard(): Promise<PickedFile[]> {
  const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: PHOTO_QUALITY })

  if (!image) {
    throw new Error('The clipboard has no picture.')
  }

  // `data` is a data URL. The preview shows it as it is; the upload needs the part after the comma.
  return [{ uri: image.data, name: `pasted-${++pasted}.jpg`, mimeType: 'image/jpeg', base64: image.data.slice(image.data.indexOf(',') + 1) }]
}

/** True when the clipboard holds a picture. The attach menu offers "Paste" only then. */
export function clipboardHasImage(): Promise<boolean> {
  return Clipboard.hasImageAsync().catch(() => false)
}

async function pick(source: AttachSource): Promise<PickedFile[]> {
  if (source === 'photos') {
    return fromImages(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: PHOTO_LIMIT,
        quality: PHOTO_QUALITY,
        base64: true
      })
    )
  }

  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync()

    if (!permission.granted) {
      throw new Error('Hermes has no access to the camera. Turn it on in the Settings app.')
    }

    return fromImages(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: PHOTO_QUALITY, base64: true }))
  }

  if (source === 'clipboard') {
    return fromClipboard()
  }

  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })

  return (result.assets ?? []).map(asset => ({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size }))
}

/** Let the user pick files and stage them. Throws only when the picker itself cannot open. */
export async function addAttachments(sessionId: string, source: AttachSource): Promise<void> {
  for (const file of await pick(source)) {
    void stage(sessionId, file)
  }
}

/** Stage one picked file and upload it. Never throws: a failure is a state of the staged entry. */
export async function stage(sessionId: string, file: PickedFile): Promise<void> {
  const id = `a${++lastId}`
  const problem = attachProblem(file)
  const kind = attachmentKind(file)
  const size = pickedSize(file)
  const entry: Attachment = {
    id,
    kind,
    name: file.name,
    state: 'uploading',
    heldPaths: [],
    promptText: '',
    // The picker's copy stays on the phone: the thumbnail and the preview read it.
    uri: file.uri,
    ...(size ? { size } : {})
  }

  if (problem) {
    return update(sessionId, list => [...list, { ...entry, state: 'failed', error: problem }])
  }

  update(sessionId, list => [...list, entry])

  let settled: Partial<Attachment>

  try {
    settled = { state: 'ready', ...(await upload(sessionId, entry, file)) }
  } catch (error) {
    settled = { state: 'failed', error: error instanceof Error ? error.message : String(error) }
  }

  // The user can remove the chip while the upload runs, and a dropped link fails it. The backend must then let go of what it took.
  if (!($attachments.get()[sessionId] ?? []).some(item => item.id === id && item.state === 'uploading')) {
    return release(sessionId, settled.heldPaths ?? [])
  }

  update(sessionId, list => list.map(item => (item.id === id ? { ...item, ...settled } : item)))
}

type Uploaded = Pick<Attachment, 'heldPaths' | 'promptText' | 'size'>

/**
 * The key of the staged files of a group chat. A group chat has no session
 * that holds a file: Hermes gives a group text only. So its files go to the
 * upload folder of the host, and the message names each one by its path
 * (`roomFileLine`). Each bot of the group then opens the file itself.
 */
export const roomFilesKey = (roomId: string) => `room:${roomId}`

const forRoom = (key: string) => key.startsWith('room:')

/** A file for a group chat: on the host, and named in the message. Nothing holds it for a session. */
async function uploadForRoom(file: PickedFile): Promise<Uploaded> {
  const api = currentApi()

  if (!api || !file.uri) {
    throw new Error(`Could not send ${file.name}.`)
  }

  const listing = await api.request<{ path?: string; locked_root?: string | null }>({ path: '/api/files' })
  let stored: { path?: string }

  try {
    stored = await api.upload<{ path?: string }>('/api/files/upload-stream', { path: uploadTarget(listing, file.name, Date.now()), overwrite: 'true' }, new File(file.uri), file.name, STREAM_TIMEOUT_MS)
  } catch (error) {
    throw new Error(error instanceof HttpError && error.status === 413 ? `${file.name} is too large for this Hermes host.` : `Could not send ${file.name} to the Hermes host.`)
  }

  if (!stored.path) {
    throw new Error(`Could not send ${file.name} to the Hermes host.`)
  }

  return { heldPaths: [], promptText: roomFileLine(stored.path, attachmentKind(file)), size: file.size ?? undefined }
}

async function upload(sessionId: string, entry: Attachment, file: PickedFile): Promise<Uploaded> {
  if (forRoom(sessionId)) {
    return uploadForRoom(file)
  }

  const known = pickedSize(file) ?? (file.uri ? new File(file.uri).size : null)

  if (needsStream(known)) {
    return uploadLarge(sessionId, entry, { ...file, size: known ?? undefined })
  }

  const base64 = file.base64 || (await new File(file.uri).base64())
  const oversize = attachProblem({ ...file, base64 })

  if (oversize) {
    throw new Error(oversize)
  }

  // The size was not known before the bytes were read, and it is over the limit of one frame.
  if (needsStream(pickedSize({ ...file, base64 }))) {
    return uploadLarge(sessionId, entry, file)
  }

  // A picker can leave the size out. The bytes are here now, so the chip can show it.
  const size = pickedSize({ ...file, base64 }) ?? undefined

  if (entry.kind === 'image') {
    const result = await rpc<AttachedImageResult>(
      'image.attach_bytes',
      { session_id: sessionId, content_base64: base64, filename: file.name },
      UPLOAD_TIMEOUT_MS
    )

    if (!result.attached) {
      throw new Error(result.message || `Could not attach ${file.name}.`)
    }

    return { heldPaths: result.path ? [result.path] : [], promptText: '', size }
  }

  if (entry.kind === 'pdf') {
    try {
      const result = await rpc<PdfAttachResult>(
        'pdf.attach',
        { session_id: sessionId, content_base64: base64, filename: file.name },
        UPLOAD_TIMEOUT_MS
      )

      return { heldPaths: (result.pages ?? []).map(page => page.path), promptText: result.text ?? '', size }
    } catch {
      // The host cannot draw PDF pages without poppler. The agent can still
      // read the PDF with its own tools when it has the file, so send that.
    }
  }

  const result = await rpc<FileAttachResult>(
    'file.attach',
    { session_id: sessionId, data_url: dataUrl(file, base64), name: file.name },
    UPLOAD_TIMEOUT_MS
  )

  if (!result.attached || !result.ref_text) {
    throw new Error(`Could not attach ${file.name}.`)
  }

  return { heldPaths: [], promptText: result.ref_text, size }
}

// A file of 100 MB over a phone connection.
const STREAM_TIMEOUT_MS = 15 * 60_000

/**
 * A file too large for one frame of the gateway socket. It goes to a folder
 * of the host as a multipart stream, and the session then takes it by its
 * path on the host.
 */
async function uploadLarge(sessionId: string, entry: Attachment, file: PickedFile): Promise<Uploaded> {
  const api = currentApi()

  if (!api || !file.uri) {
    throw new Error(`Could not send ${file.name}.`)
  }

  const oversize = attachProblem(file)

  if (oversize) {
    throw new Error(oversize)
  }

  const listing = await api.request<{ path?: string; locked_root?: string | null }>({ path: '/api/files' })
  let stored: { path?: string }

  try {
    stored = await api.upload<{ path?: string }>('/api/files/upload-stream', { path: uploadTarget(listing, file.name, Date.now()), overwrite: 'true' }, new File(file.uri), file.name, STREAM_TIMEOUT_MS)
  } catch (error) {
    throw new Error(error instanceof HttpError && error.status === 413 ? `${file.name} is too large for this Hermes host.` : `Could not send ${file.name} to the Hermes host.`)
  }

  const path = stored.path

  if (!path) {
    throw new Error(`Could not send ${file.name} to the Hermes host.`)
  }

  const size = file.size ?? undefined

  if (entry.kind === 'image') {
    const result = await rpc<AttachedImageResult>('image.attach', { session_id: sessionId, path }, UPLOAD_TIMEOUT_MS)

    if (!result.attached) {
      throw new Error(result.message || `Could not attach ${file.name}.`)
    }

    return { heldPaths: result.path ? [result.path] : [], promptText: '', size }
  }

  if (entry.kind === 'pdf') {
    try {
      const result = await rpc<PdfAttachResult>('pdf.attach', { session_id: sessionId, path, filename: file.name }, UPLOAD_TIMEOUT_MS)

      return { heldPaths: (result.pages ?? []).map(page => page.path), promptText: result.text ?? '', size }
    } catch {
      // No page pictures on this host: the agent gets the file itself.
    }
  }

  const result = await rpc<FileAttachResult>('file.attach', { session_id: sessionId, path, name: file.name }, UPLOAD_TIMEOUT_MS)

  if (!result.attached || !result.ref_text) {
    throw new Error(`Could not attach ${file.name}.`)
  }

  // The session made its own copy. The upload must not stay on the host as a second one.
  if (result.path && result.path !== path) {
    void api.request({ path: '/api/files', method: 'DELETE', body: { path } }).catch(() => undefined)
  }

  return { heldPaths: [], promptText: result.ref_text, size }
}

function release(sessionId: string, paths: readonly string[]): void {
  // A group chat holds nothing for a session.
  for (const path of forRoom(sessionId) ? [] : paths) {
    // If this fails the image rides along with the next prompt. Nothing the user can do about it here.
    void rpc('image.detach', { session_id: sessionId, path }).catch(() => undefined)
  }
}

export function removeAttachment(sessionId: string, id: string): void {
  const found = ($attachments.get()[sessionId] ?? []).find(item => item.id === id)

  update(sessionId, list => list.filter(item => item.id !== id))
  release(sessionId, found?.heldPaths ?? [])
}

/** The attachments that go out with the message being sent. The staged list is empty after this. */
export function takeAttachments(sessionId: string): Attachment[] {
  const ready = ($attachments.get()[sessionId] ?? []).filter(item => item.state === 'ready')

  $attachments.setKey(sessionId, [])

  return ready
}

// A request in flight when the link drops gets no answer. Without this the chip would spin until the request times out.
$linkState.listen(state => {
  if (state === 'open') {
    return
  }

  for (const [sessionId, list] of Object.entries($attachments.get())) {
    if (list.some(item => item.state === 'uploading')) {
      $attachments.setKey(
        sessionId,
        list.map(item => (item.state === 'uploading' ? { ...item, state: 'failed', error: 'The connection dropped. Add it again.' } : item))
      )
    }
  }
})

export function clearAttachments(): void {
  $attachments.set({})
}
