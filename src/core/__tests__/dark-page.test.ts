import { darkPageScript } from '../preview/dark-page'

const DARK_PAGE_SCRIPT = darkPageScript('#101114', '#f2efe9')

describe('the script for a page with no colours', () => {
  it('is a script that parses and ends with a value for the WebView', () => {
    expect(() => new Function(DARK_PAGE_SCRIPT)).not.toThrow()
    expect(DARK_PAGE_SCRIPT.trimEnd().endsWith('true;')).toBe(true)
  })

  it('gives the page the colours it is asked for', () => {
    expect(DARK_PAGE_SCRIPT).toContain('background: #101114')
    expect(DARK_PAGE_SCRIPT).toContain('color: #f2efe9')
  })

  it('asks for the dark defaults only when the page sets no colour', () => {
    const run = (page: { background: string; body: string; colour: string; meta?: boolean }) => {
      const added: unknown[] = []
      const element = { name: '', content: '' }
      const doc = {
        documentElement: { appendChild: (node: unknown) => added.push(node) },
        body: {},
        head: { appendChild: (node: unknown) => added.push(node) },
        querySelector: () => (page.meta ? {} : null),
        createElement: () => element
      }
      const style = (target: unknown) => (target === doc.body ? { backgroundColor: page.body, color: page.colour } : { backgroundColor: page.background, color: '' })

      new Function('document', 'getComputedStyle', DARK_PAGE_SCRIPT)(doc, style)

      return added.length
    }

    const clear = 'rgba(0, 0, 0, 0)'

    expect(run({ background: clear, body: clear, colour: 'rgb(0, 0, 0)' })).toBe(2)
    expect(run({ background: clear, body: 'rgb(255, 255, 255)', colour: 'rgb(0, 0, 0)' })).toBe(0)
    expect(run({ background: clear, body: clear, colour: 'rgb(34, 34, 34)' })).toBe(0)
    expect(run({ background: clear, body: clear, colour: 'rgb(0, 0, 0)', meta: true })).toBe(0)
  })
})
