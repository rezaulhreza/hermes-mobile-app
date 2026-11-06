import { texToText } from '../tex'

describe('inline math as text', () => {
  it('writes powers, indices and Greek letters as characters', () => {
    expect(texToText('x^2 + y^{10}')).toBe('x² + y¹⁰')
    expect(texToText('a_i + a_{n+1}')).toBe('aᵢ + aₙ₊₁')
    expect(texToText('\\alpha + \\beta = \\gamma')).toBe('α + β = γ')
  })

  it('writes fractions and roots in one line', () => {
    expect(texToText('\\frac{1}{2}')).toBe('1/2')
    expect(texToText('\\frac{a+b}{c}')).toBe('(a+b)/c')
    expect(texToText('\\sqrt{x^2 + 1}')).toBe('√(x² + 1)')
  })

  it('keeps the words of \\text and drops sizing commands', () => {
    expect(texToText('\\text{speed} = \\left( \\frac{d}{t} \\right)')).toBe('speed = ( d/t )')
    expect(texToText('E = mc^2')).toBe('E = mc²')
  })

  it('falls back to a mark when a character has no small form', () => {
    expect(texToText('e^{i\\pi}')).toBe('e^(iπ)')
    expect(texToText('x_{max}')).toBe('x_(max)')
  })

  it('never throws on broken TeX', () => {
    expect(texToText('\\frac{1}{')).toBe('1/')
    expect(texToText('x^')).toBe('x^')
    expect(texToText('')).toBe('')
  })
})
