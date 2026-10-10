/**
 * Attachments staged for the next message of each conversation. Picking a
 * file uploads it at once, so the send button only has to wait for the list
 * to settle.
 */

import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { map } from 'nanostores'

import { type Attachment, attachmentKind, attachProblem, dataUrl, type PickedFile, pickedSize } from '@/core/attachments'
import type { AttachedImageResult, FileAttachResult, PdfAttachResult } from '@/core/gateway/gateway-contract.generated'

import { rpc } from './link'

export const $attachments = map<Record<string, Attachment[]>>({})

export type AttachSource = 'photos' | 'camera' | 'files'

// A 12 MB file over a phone connection needs more than the default request time.
const UPLOAD_TIMEOUT_MS = 180_000
const PHOTO_LIMIT = 6
// The backend resizes what the model sees. Full camera quality only costs upload time.
const PHOTO_QUALITY = 0.8

let lastId = 0

function update(sessionId: string, change: (list: Attachment[]) => Attachment[]): void {
  $attachments.setKey(sessionId, change($attachments.get()[sessionId] ?? []))
}

function fromImages(result: ImagePicker.ImagePickerResult): PickedFile[] {
  return (result.assets ?? []).map((asset, index) => ({
    uri: asset.uri,
    name: asset.fileName || `photo-${index + 1}.jpg`,
    mimeType: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize,
    base64: asset.base64
  }))
}

async function pick(source: AttachSource): Promise<PickedFile[]> {
  if (source === 'photos') {
    return fromImages(
      await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
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
    // Only an image has a picture to show. The picker's copy stays on the phone.
    ...(kind === 'image' ? { uri: file.uri } : {}),
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

  // The user can remove the chip while the upload runs. The backend must then let go of what it took.
  if (!($attachments.get()[sessionId] ?? []).some(item => item.id === id)) {
    return release(sessionId, settled.heldPaths ?? [])
  }

  update(sessionId, list => list.map(item => (item.id === id ? { ...item, ...settled } : item)))
}

type Uploaded = Pick<Attachment, 'heldPaths' | 'promptText' | 'size'>

async function upload(sessionId: string, entry: Attachment, file: PickedFile): Promise<Uploaded> {
  const base64 = file.base64 || (await new File(file.uri).base64())
  const oversize = attachProblem({ ...file, base64 })

  if (oversize) {
    throw new Error(oversize)
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
    const result = await rpc<PdfAttachResult>(
      'pdf.attach',
      { session_id: sessionId, content_base64: base64, filename: file.name },
      UPLOAD_TIMEOUT_MS
    )

    return { heldPaths: (result.pages ?? []).map(page => page.path), promptText: result.text ?? '', size }
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

function release(sessionId: string, paths: readonly string[]): void {
  for (const path of paths) {
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

export function clearAttachments(): void {
  $attachments.set({})
}
