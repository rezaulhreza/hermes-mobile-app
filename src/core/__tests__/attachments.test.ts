import { ATTACH_MAX_BYTES, attachmentKind, attachProblem, dataUrl, fileGlyph, jpegName, pickedSize, previewMode, previewText, promptWithAttachments, sentAttachment, shrinkTarget, splitStoredPrompt, type Attachment } from '../attachments'

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

describe('splitStoredPrompt', () => {
  it('cuts the context the backend added and keeps a reference inside a sentence', () => {
    const stored = 'Look at @file:a.yml and count\n\n--- Attached Context ---\n\n📄 @file:a.yml (864 tokens)\n```yaml\nx: 1\n```'

    expect(splitStoredPrompt(stored)).toEqual({ text: 'Look at @file:a.yml and count', attached: [] })
  })

  it('reads the attachment lines the app adds under the words', () => {
    const stored = 'read these\n@file:/up/notes.md\n@file:"/up/my plan.pdf"\n[User attached PDF: p.pdf (2 page(s))]'

    expect(splitStoredPrompt(stored)).toEqual({
      text: 'read these',
      attached: [
        { name: 'notes.md', kind: 'file', path: '/up/notes.md' },
        { name: 'my plan.pdf', kind: 'pdf', path: '/up/my plan.pdf' },
        { name: 'p.pdf', kind: 'pdf' }
      ]
    })
  })

  it('reads a message of images alone', () => {
    expect(splitStoredPrompt('[User attached image: a.jpg]\n[User attached image: b.png]')).toEqual({
      text: '',
      attached: [
        { name: 'a.jpg', kind: 'image' },
        { name: 'b.png', kind: 'image' }
      ]
    })
  })
})

describe('fileGlyph', () => {
  it('picks a picture by kind, then by extension', () => {
    expect(fileGlyph('a.heic', 'image')).toBe('image')
    expect(fileGlyph('plan.pdf', 'pdf')).toBe('text')
    expect(fileGlyph('clip.MOV', 'file')).toBe('video')
    expect(fileGlyph('app.tsx', 'file')).toBe('code')
    expect(fileGlyph('data.bin', 'file')).toBe('file')
  })
})

describe('sentAttachment', () => {
  it('keeps what the sent row shows', () => {
    const staged = { id: 'a1', kind: 'image' as const, name: 'a.jpg', state: 'ready' as const, heldPaths: ['/h/a.jpg'], promptText: '', uri: 'file:///a.jpg', size: 2048 }

    expect(sentAttachment(staged)).toEqual({ name: 'a.jpg', kind: 'image', uri: 'file:///a.jpg', size: 2048 })
    expect(pickedSize({ uri: 'x', name: 'x', base64: 'AAAA' })).toBe(3)
  })
})

describe('previewMode', () => {
  it('says how a phone can show each file', () => {
    expect(previewMode('a.jpg', 'image')).toBe('image')
    expect(previewMode('plan.pdf', 'pdf')).toBe('web')
    expect(previewMode('sheet.xlsx', 'file')).toBe('web')
    expect(previewMode('clip.mov', 'file')).toBe('web')
    expect(previewMode('notes.md', 'file')).toBe('text')
    expect(previewMode('app.tsx', 'file')).toBe('text')
    expect(previewMode('data.csv', 'file')).toBe('text')
    expect(previewMode('bundle.zip', 'file')).toBe('none')
  })

  it('cuts a very long text', () => {
    expect(previewText('short')).toEqual({ text: 'short', cut: false })
    expect(previewText('x'.repeat(200_001))).toMatchObject({ cut: true })
  })
})

describe('shrinkTarget', () => {
  it('sets the long side of a large photo and leaves a small one', () => {
    expect(shrinkTarget(4032, 3024)).toEqual({ width: 2048 })
    expect(shrinkTarget(3024, 4032)).toEqual({ height: 2048 })
    expect(shrinkTarget(2048, 1536)).toBeNull()
    expect(jpegName('IMG_0012.HEIC')).toBe('IMG_0012.jpg')
    expect(jpegName('photo')).toBe('photo.jpg')
  })
})
