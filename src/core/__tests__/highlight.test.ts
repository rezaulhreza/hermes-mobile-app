import { highlightCode } from '../highlight'

const kinds = (code: string, language: string | null) => highlightCode(code, language).filter(token => token.kind !== 'plain').map(token => `${token.kind}:${token.text}`)

describe('highlightCode', () => {
  it('never changes the text', () => {
    const code = 'const a = "x" // note\nif (a) { return 12.5 }\n/* open'

    expect(highlightCode(code, 'ts').map(token => token.text).join('')).toBe(code)
  })

  it('finds comments, strings, numbers and common words', () => {
    expect(kinds('const a = "x" // note', 'ts')).toEqual(['keyword:const', 'string:"x"', 'comment:// note'])
    expect(kinds('return 12.5', 'js')).toEqual(['keyword:return', 'number:12.5'])
  })

  it('reads a hash as a comment only in a language that has it', () => {
    expect(kinds('x = 1  # set x', 'python')).toEqual(['number:1', 'comment:# set x'])
    expect(kinds('a #b', 'ts')).toEqual([])
  })

  it('does not colour a word inside a string or a comment', () => {
    expect(kinds('"return if" // for while', 'ts')).toEqual(['string:"return if"', 'comment:// for while'])
  })

  it('leaves plain text and a very long block alone', () => {
    expect(highlightCode('if true', 'text')).toEqual([{ kind: 'plain', text: 'if true' }])
    expect(highlightCode('x'.repeat(20_001), 'ts')).toHaveLength(1)
  })
})
