import { attachmentKind, roomFileKind, roomFileOf, roomFilesOf, dataUrl, fileGlyph, jpegName, pickedSize, previewMode, previewText, messageWords, promptWithAttachments, roomFileLine, sentAttachment, shrinkTarget, splitStoredPrompt, type Attachment } from '../attachments'

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
    for (const name of ['a.avif', 'a.ico', 'logo.svg', 'a.tif', 'a.webp', 'a.heif']) {
      expect(attachmentKind({ name })).toBe('image')
    }
    expect(attachmentKind({ name: 'paper.pdf', mimeType: 'application/pdf' })).toBe('pdf')
    expect(attachmentKind({ name: 'Paper.PDF', mimeType: null })).toBe('pdf')
    expect(attachmentKind({ name: 'notes.md', mimeType: 'text/markdown' })).toBe('file')
    // A picker can call a text file by an image-like name; the type wins.
    expect(attachmentKind({ name: 'photo.png', mimeType: 'text/plain' })).toBe('file')
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
  it('hides the routing note of a host plugin and shows the saved picture', () => {
    const stored = 'Which shop is open?\n\n[Image attached at: /h/cache/shot.jpg]\n[screenshot]\n[Tool routing for the browser and screen. Use the chrome tools.\nNever launch another browser.]'

    expect(splitStoredPrompt(stored)).toEqual({ text: 'Which shop is open?', attached: [{ name: 'shot.jpg', kind: 'image', path: '/h/cache/shot.jpg' }] })
  })

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

  it('reads the lines the desktop app puts over the words', () => {
    const stored = '@file:Users/me/.hermes/composer-pastes/pasted_content_2026-10-11_c8.txt\n@file:`/Users/me/my notes.md`\n\nread this\n\n--- Attached Context ---\n\n📄 @file:Users/me/x.txt (9 tokens)'

    expect(splitStoredPrompt(stored)).toEqual({
      text: 'read this',
      attached: [
        { name: 'pasted_content_2026-10-11_c8.txt', title: 'Pasted content', kind: 'file', path: 'Users/me/.hermes/composer-pastes/pasted_content_2026-10-11_c8.txt' },
        { name: 'my notes.md', kind: 'file', path: '/Users/me/my notes.md' }
      ]
    })
    // A message that is only a file.
    expect(splitStoredPrompt('@file:/up/a.pdf')).toEqual({ text: '', attached: [{ name: 'a.pdf', kind: 'pdf', path: '/up/a.pdf' }] })
  })

  // A picture the backend holds is stored as an `@image:` line and a `[screenshot]` line.
  it('reads the pictures of a stored message, with where they are on the host', () => {
    const stored = 'What is in here both\n@image:/h/images/upload_1.jpg\n@image:/h/images/upload_2.jpg\n[screenshot]\n[screenshot]'

    expect(splitStoredPrompt(stored)).toEqual({
      text: 'What is in here both',
      attached: [
        { name: 'upload_1.jpg', kind: 'image', path: '/h/images/upload_1.jpg' },
        { name: 'upload_2.jpg', kind: 'image', path: '/h/images/upload_2.jpg' }
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
    for (const name of ['a.mpeg', 'a.mpg', 'a.3gp', 'a.webm', 'a.mkv', 'a.avi', 'a.m4v']) {
      expect(fileGlyph(name, 'file')).toBe('video')
    }
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
    expect(previewMode('logo.svg', 'image')).toBe('web')
    expect(previewMode('a.avif', 'image')).toBe('image')
    expect(previewMode('clip.mpg', 'file')).toBe('web')
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

describe('a file too large for one frame', () => {
  const { attachProblem, needsStream, uploadTarget, ATTACH_MAX_BYTES, STREAM_MAX_BYTES } = jest.requireActual('../attachments') as typeof import('../attachments')

  it('goes up as a stream', () => {
    expect(needsStream(ATTACH_MAX_BYTES)).toBe(false)
    expect(needsStream(ATTACH_MAX_BYTES + 1)).toBe(true)
    expect(needsStream(null)).toBe(false)
  })

  it('is refused only over the limit of the host', () => {
    expect(attachProblem({ uri: 'file:///a.zip', name: 'a.zip', size: ATTACH_MAX_BYTES + 1 })).toBeNull()
    expect(attachProblem({ uri: 'file:///a.zip', name: 'a.zip', size: STREAM_MAX_BYTES + 1 })).toMatch(/too large/)
  })

  it('goes to a folder under the home folder of the host', () => {
    expect(uploadTarget({ path: '/Users/me' }, 'My video (1).mov', 36)).toBe('/Users/me/.hermes-phone-uploads/10-My_video_1_.mov')
  })

  it('uses the separator of a Windows host', () => {
    expect(uploadTarget({ path: 'C:\\Users\\me\\' }, 'a.zip', 36)).toBe('C:\\Users\\me\\.hermes-phone-uploads\\10-a.zip')
  })

  it('goes inside the locked root of a hosted install', () => {
    expect(uploadTarget({ path: '/opt/data', locked_root: '/opt/data' }, '..hidden', 36)).toBe('.hermes-phone-uploads/10-hidden')
  })
})

describe('a file in a message to a group chat', () => {
  it('is named by a line the app reads back as an attachment', () => {
    const text = promptWithAttachments('look at these', [
      { id: 'a1', kind: 'image', name: 'p.jpg', state: 'ready', heldPaths: [], promptText: roomFileLine('/Users/me/.hermes-phone-uploads/k1-p.jpg', 'image') },
      { id: 'a2', kind: 'file', name: 'my plan.pdf', state: 'ready', heldPaths: [], promptText: roomFileLine('/Users/me/up loads/k2-my_plan.pdf', 'pdf') }
    ] as Attachment[])

    expect(text).toBe('look at these\n@image:/Users/me/.hermes-phone-uploads/k1-p.jpg\n@file:"/Users/me/up loads/k2-my_plan.pdf"')
    expect(splitStoredPrompt(text)).toEqual({
      text: 'look at these',
      attached: [
        { name: 'k1-p.jpg', kind: 'image', path: '/Users/me/.hermes-phone-uploads/k1-p.jpg' },
        { name: 'k2-my_plan.pdf', kind: 'pdf', path: '/Users/me/up loads/k2-my_plan.pdf' }
      ]
    })
  })

  it('has words for a title when the message is only files', () => {
    expect(messageWords('look\n@image:/up/a.png')).toBe('look')
    expect(messageWords('@image:/up/a.png')).toBe('A picture')
    expect(messageWords('@image:/up/a.png\n@image:/up/b.png')).toBe('2 pictures')
    expect(messageWords('@image:/up/a.png\n@file:/up/n.txt')).toBe('2 files')
    expect(messageWords('')).toBe('')
  })
})

describe('files a group chat holds', () => {
  const ready = (extra: Partial<Attachment>): Attachment => ({ id: 'a1', kind: 'file', name: 'notes.txt', state: 'ready', heldPaths: [], promptText: '', ...extra })

  it('reads the answer of an upload, and nothing else', () => {
    expect(roomFileOf({ attachment_id: 'att_1', kind: 'image', name: 'a.jpg', mime: 'image/jpeg', size: 10 })).toEqual({ attachment_id: 'att_1', kind: 'image', name: 'a.jpg', mime: 'image/jpeg', size: 10 })
    expect(roomFileOf({ name: 'no id' })).toBeNull()
  })

  it('gives the kind the room engine takes', () => {
    expect(roomFileKind('image/png')).toBe('image')
    expect(roomFileKind('application/pdf')).toBe('pdf')
    expect(roomFileKind('text/plain')).toBe('file')
  })

  it('sends a held file with the message, not as a line of it', () => {
    const file = { attachment_id: 'att_1', kind: 'file', name: 'notes.txt', mime: 'text/plain' }
    const staged = [ready({ roomFile: file }), ready({ id: 'a2', promptText: '[file: /tmp/x]' }), ready({ id: 'a3', state: 'uploading', roomFile: file })]

    expect(roomFilesOf(staged)).toEqual([file])
    expect(promptWithAttachments('', [ready({ roomFile: file })])).toBe('')
    expect(promptWithAttachments('Read it', staged)).toBe('Read it\n[file: /tmp/x]')
  })
})
