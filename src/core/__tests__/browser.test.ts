import { actionFromRequest, actScript, isNavKind, paneMessage, previewAddress, readAnswer, readScript, shortAddress } from '../preview/browser'

describe('previewAddress', () => {
  it('sends a loopback address through the host proxy', () => {
    expect(previewAddress('https://h.example.com', 'http://localhost:5173/app?x=1')).toBe(
      'https://h.example.com/api/preview/host?url=http%3A%2F%2Flocalhost%3A5173%2Fapp%3Fx%3D1'
    )
    expect(previewAddress('https://h.example.com', 'http://127.0.0.1:8000')).toContain('/api/preview/host?url=')
  })

  it('loads any other address as it is', () => {
    expect(previewAddress('https://h.example.com', ' https://example.com/a ')).toBe('https://example.com/a')
    // A host that only starts like localhost is not the host machine.
    expect(previewAddress('https://h.example.com', 'http://localhost.evil.com')).toBe('http://localhost.evil.com')
    expect(shortAddress('https://example.com/a/')).toBe('example.com/a')
  })
})

describe('actionFromRequest', () => {
  it('keeps the fields that are set, with the engine names', () => {
    expect(actionFromRequest({ session_id: 's', action: 'type', ref: 'field-email', text: 'a@b.c', submit: true, allow_shortcut: true, key: null })).toEqual({
      kind: 'type',
      ref: 'field-email',
      text: 'a@b.c',
      submit: true,
      allowShortcut: true
    })
    expect(isNavKind('reload')).toBe(true)
    expect(isNavKind('click')).toBe(false)
  })
})

describe('scripts', () => {
  it('builds a script the WebView accepts, with the action inside', () => {
    const script = actScript('r1', { kind: 'click', ref: 'btn-sign-in' })

    expect(script).toContain('"btn-sign-in"')
    expect(script.trim().endsWith('true;')).toBe(true)
    // The script must parse: it is one of the few places a typing error shows only on a device.
    expect(() => new Function(script)).not.toThrow()
    expect(() => new Function(readScript('r2'))).not.toThrow()
  })

  it('takes only its own messages from the page', () => {
    expect(paneMessage('{"__hermesPane":"r1","result":{"success":true}}')).toEqual({ id: 'r1', result: { success: true } })
    expect(paneMessage('{"type":"analytics"}')).toBeNull()
    expect(paneMessage('not json')).toBeNull()
  })
})

describe('readAnswer', () => {
  const preview = { url: 'http://localhost:5173', label: 'Dev server' }

  it('gives one window of the text and the size of the whole', () => {
    const page = { title: 'App', url: 'http://localhost:5173/home', text: 'abcdefghij' }

    expect(readAnswer(preview, page, { start: 2, count: 3 })).toEqual({
      kind: 'url',
      title: 'App',
      url: 'http://localhost:5173/home',
      text: 'cde',
      start: 2,
      end: 5,
      total_chars: 10
    })
    expect(readAnswer(preview, page, { start: 99 })).toMatchObject({ text: '', start: 10, end: 10 })
  })

  it('names the page and says why when there is no text', () => {
    expect(readAnswer(preview, null, {}, 'loading')).toEqual({
      kind: 'url',
      title: 'Dev server',
      url: 'http://localhost:5173',
      text: '',
      start: 0,
      end: 0,
      total_chars: 0,
      note: 'loading'
    })
  })
})
