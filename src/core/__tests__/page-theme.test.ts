import { type PageColours, pageThemeScript } from '../preview/page-theme'

const light: PageColours = { bg: '#f8f7f4', paper: '#ffffff', ink: '#22252c', muted: '#666c76', line: '#e6e4e0', soft: '#efeeeb', accent: '#a13e26', onAccent: '#ffffff' }
const dark: PageColours = { bg: '#18191d', paper: '#23252b', ink: '#f3f1ee', muted: '#b1b4bf', line: '#373940', soft: '#2c2e35', accent: '#f2ac91', onAccent: '#222222' }

interface Page {
  /** The computed background of the page and of the body. */
  background?: string
  body?: string
  colour?: string
  /** The page defines its own variables. */
  variables?: boolean
  meta?: boolean
  /** The backgrounds of the parts of the page. */
  parts?: string[]
  /** The page uses the theme variables of the host app. */
  themed?: boolean
}

const CLEAR = 'rgba(0, 0, 0, 0)'

/** Run the script against a small fake page. Gives the CSS the script added. */
function run(page: Page, isDark = true): string[] {
  const added: string[] = []
  const element = (css = ''): { textContent: string } => ({ textContent: css })
  const doc = {
    documentElement: { id: 'root', outerHTML: page.themed ? '<style>a{color:var(--foreground)}</style>' : '<p>plain</p>' },
    body: {
      querySelectorAll: () => (page.parts ?? []).map(background => ({ background }))
    },
    head: { appendChild: (node: { textContent: string }) => added.push(node.textContent) },
    querySelector: () => (page.meta ? {} : null),
    createElement: () => element()
  }
  const style = (target: { id?: string; background?: string }) => {
    if (target === doc.documentElement) {
      return { backgroundColor: page.background ?? CLEAR, getPropertyValue: () => (page.variables ? '#123' : '') }
    }

    if (target === doc.body) {
      return { backgroundColor: page.body ?? CLEAR, color: page.colour ?? 'rgb(0, 0, 0)' }
    }

    return { backgroundColor: target.background ?? CLEAR }
  }

  new Function('document', 'getComputedStyle', pageThemeScript(isDark ? dark : light, isDark))(doc, style)

  return added
}

describe('the theme of a page on the phone', () => {
  it('is a script that parses and ends with a value for the WebView', () => {
    const script = pageThemeScript(dark, true)

    expect(() => new Function(script)).not.toThrow()
    expect(script.trimEnd().endsWith('true;')).toBe(true)
  })

  it('defines the theme variables of the host app from the palette', () => {
    const [css] = run({ background: '#fff' }, false)

    expect(css).toContain(`--foreground: ${light.ink};`)
    expect(css).toContain(`--card: ${light.paper};`)
    expect(css).toContain(`--border: ${light.line};`)
    expect(css).toContain(`--muted-foreground: ${light.muted};`)
    expect(css).toContain(`--accent: ${light.accent};`)
  })

  it('leaves the variables of a page that defines its own', () => {
    expect(run({ variables: true, background: 'rgb(255, 255, 255)' })).toEqual([])
  })

  it('gives a page with the default black text a dark ground and light text', () => {
    const css = run({}).at(-1)

    expect(css).toContain(`background: ${dark.bg}`)
    expect(css).toContain(`color: ${dark.ink}`)
  })

  it('gives the ground and the text of the app to a page that uses the theme variables', () => {
    const css = run({ themed: true, parts: ['rgb(35, 37, 43)'] }).at(-1)

    expect(css).toContain(`background: ${dark.bg}`)
    expect(css).toContain(`color: ${dark.ink}`)
  })

  it('gives a white ground to a page with the default text and a part of its own background', () => {
    expect(run({ parts: [CLEAR, 'rgb(255, 255, 255)'] }).at(-1)).toBe(':root { background: #ffffff; }')
  })

  it('gives a white ground to a page with its own dark text', () => {
    expect(run({ colour: 'rgb(34, 34, 34)' }).at(-1)).toBe(':root { background: #ffffff; }')
  })

  it('leaves a page with its own light text', () => {
    expect(run({ colour: 'rgb(240, 240, 240)', variables: true })).toEqual([])
  })

  it('leaves a page that paints its own background or sets a colour scheme', () => {
    expect(run({ body: 'rgb(255, 255, 255)', variables: true })).toEqual([])
    expect(run({ background: 'rgb(0, 0, 0)', variables: true })).toEqual([])
    expect(run({ meta: true, variables: true })).toEqual([])
  })

  it('changes nothing about the ground in light mode', () => {
    expect(run({}, false)).toHaveLength(1)
  })
})
