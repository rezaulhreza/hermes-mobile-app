import { type Attachment, ATTACH_MAX_BYTES, attachmentKind, attachProblem, dataUrl, promptWithAttachments } from '../attachments'

const ready = (kind: Attachment['kind'], name: string, promptText = ''): Attachment => ({
  id: name,
  kind,
  name,
  state: 'ready',
  heldPaths: [],
  promptText
})

describe('attachmentKind', () => {
  it('reads the type first and falls back to the name', () => {
    expect(attachmentKind({ name: 'IMG_1.HEIC', mimeType: 'image/heic' })).toBe('image')
    expect(attachmentKind({ name: 'shot.PNG' })).toBe('image')
    expect(attachmentKind({ name: 'paper.pdf', mimeType: 'application/pdf' })).toBe('pdf')
    expect(attachmentKind({ name: 'Paper.PDF', mimeType: null })).toBe('pdf')
    expect(attachmentKind({ name: 'notes.md', mimeType: 'text/markdown' })).toBe('file')
    // A picker can call a text file by an image-like name; the type wins.
    expect(attachmentKind({ name: 'photo.png', mimeType: 'text/plain' })).toBe('file')
  })
})

describe('attachProblem', () => {
  it('refuses a file over the frame limit, by size or by encoded length', () => {
    expect(attachProblem({ uri: 'f', name: 'a.zip', size: ATTACH_MAX_BYTES + 1 })).toMatch(/too large/)
    expect(attachProblem({ uri: 'f', name: 'a.jpg', base64: 'x'.repeat(Math.ceil((ATTACH_MAX_BYTES * 4) / 3) + 8) })).toMatch(/too large/)
    expect(attachProblem({ uri: 'f', name: 'a.jpg', size: ATTACH_MAX_BYTES })).toBeNull()
    expect(attachProblem({ uri: 'f', name: 'a.jpg' })).toBeNull()
  })
})

describe('dataUrl', () => {
  it('names the type, or a neutral one when the picker gave none', () => {
    expect(dataUrl({ mimeType: 'text/plain' }, 'aGk=')).toBe('data:text/plain;base64,aGk=')
    expect(dataUrl({ mimeType: null }, 'aGk=')).toBe('data:application/octet-stream;base64,aGk=')
  })
})

describe('promptWithAttachments', () => {
  it('puts file references and PDF lines after the words', () => {
    const attachments = [ready('file', 'notes.md', '@file:/up/notes.md'), ready('image', 'a.jpg'), ready('pdf', 'p.pdf', '[User attached PDF: p.pdf (2 page(s))]')]

    expect(promptWithAttachments(' read these ', attachments)).toBe('read these\n@file:/up/notes.md\n[User attached PDF: p.pdf (2 page(s))]')
  })

  it('gives a prompt of images alone some text', () => {
    expect(promptWithAttachments('', [ready('image', 'a.jpg'), ready('image', 'b.png')])).toBe(
      '[User attached image: a.jpg]\n[User attached image: b.png]'
    )
  })

  it('leaves out attachments that did not arrive', () => {
    const failed: Attachment = { ...ready('file', 'x.md', '@file:/up/x.md'), state: 'failed' }

    expect(promptWithAttachments('hi', [failed])).toBe('hi')
  })
})
