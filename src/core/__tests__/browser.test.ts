import { actionFromRequest, actScript, isLoopbackUrl, isNavKind, paneMessage, previewAddress, readAnswer, readScript, shortAddress } from '../preview/browser'

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

describe('local-development sites', () => {
  it('loads a site under a local domain through the host', () => {
    expect(isLoopbackUrl('http://app.test/')).toBe(true)
    expect(isLoopbackUrl('http://api.shop.localhost:8080/x')).toBe(true)
    expect(previewAddress('https://h.example', 'http://app.test')).toBe('https://h.example/api/preview/host?url=http%3A%2F%2Fapp.test')
  })

  it('does not take a public name for a local one', () => {
    expect(isLoopbackUrl('http://test.example.com/')).toBe(false)
    expect(isLoopbackUrl('http://my.test.evil.com/')).toBe(false)
  })
})

describe('pages, files and marks of the preview', () => {
  const { actScript, hostFilePath, previewAddress, shortAddress, withTab, withoutTab } = jest.requireActual('../preview/browser') as typeof import('../preview/browser')
  const a = { url: 'http://localhost:3000', label: 'App' }
  const b = { url: 'https://example.com', label: '' }
  const c = { url: '/Users/me/out/report.html', label: 'Report' }

  it('adds a new page and shows it', () => {
    expect(withTab([a], b)).toEqual({ tabs: [a, b], active: 1 })
  })

  it('brings a page that is open already to the front, with its new label', () => {
    expect(withTab([a, b], { ...a, label: 'App again' })).toEqual({ tabs: [{ ...a, label: 'App again' }, b], active: 0 })
  })

  it('closes one page and keeps the page on screen', () => {
    expect(withoutTab([a, b, c], 2, b.url)).toEqual({ tabs: [a, c], active: 1 })
    expect(withoutTab([a, b, c], 0, b.url)).toEqual({ tabs: [a, c], active: 0 })
  })

  it('shows the page before, when the page on screen closes', () => {
    expect(withoutTab([a, b, c], 1, b.url)).toEqual({ tabs: [a, c], active: 0 })
    expect(withoutTab([a, b], 0, a.url)).toEqual({ tabs: [b], active: 0 })
  })

  it('closes every page with no address, and nothing for an unknown address', () => {
    expect(withoutTab([a, b], 1, '').tabs).toEqual([])
    expect(withoutTab([a, b], 1, 'https://other.example')).toEqual({ tabs: [a, b], active: 1 })
  })

  it('knows a file of the host from a web address', () => {
    expect(hostFilePath('/Users/me/out/report.html')).toBe('/Users/me/out/report.html')
    expect(hostFilePath('file:///Users/me/my%20report.html')).toBe('/Users/me/my report.html')
    expect(hostFilePath('file:///C:/Users/me/a.pdf')).toBe('C:/Users/me/a.pdf')
    expect(hostFilePath('C:\\Users\\me\\a.pdf')).toBe('C:\\Users\\me\\a.pdf')
    expect(hostFilePath('https://example.com/a.html')).toBeNull()
  })

  it('loads a file of the host through the host, and shows its name', () => {
    expect(previewAddress('https://h.example', c.url)).toBe('https://h.example/api/fs/download?path=%2FUsers%2Fme%2Fout%2Freport.html')
    expect(shortAddress(c.url)).toBe('report.html')
  })

  it.each([
    [{ kind: 'pin', ref: 'btn-sign-in', text: 'Bug here' }, "watch('pin', \"Bug here\")"],
    [{ kind: 'unpin' }, 'cleared every pin'],
    [{ kind: 'unpin', ref: 'btn-sign-in' }, "'unpinned '"],
    [{ kind: 'hold' }, 'watch("hold")'],
    [{ kind: 'strobe' }, 'watch("strobe")'],
    [{ kind: 'click', ref: 'btn-sign-in' }, "watch('strike')"]
  ])('writes a script that parses for %j', (action, part) => {
    const script = actScript('a1', action)

    expect(script).toContain(part)
    expect(() => new Function(script)).not.toThrow()
  })
})
