import { duration, previewLine, relativeTime } from '../format'

describe('previewLine', () => {
  it('removes terminal prompt glyphs and box drawing from pasted output', () => {
    expect(previewLine('╭─   ~/Developer ────╮\n  NameError: CASES')).toBe('~/Developer NameError: CASES')
  })

  it('leaves ordinary text, accents and emoji alone', () => {
    expect(previewLine('  Café  plan 🚀\nnext ')).toBe('Café plan 🚀 next')
  })
})

it('gives a short age for a list row', () => {
  const now = 1_000_000_000_000

  expect(relativeTime(now / 1000 - 30, now)).toBe('now')
  expect(relativeTime(now / 1000 - 15 * 3600, now)).toBe('15h')
  expect(relativeTime(now / 1000 - 3 * 86_400, now)).toBe('3d')
})

it('formats a tool duration', () => {
  expect(duration(0.42)).toBe('0.4s')
  expect(duration(125)).toBe('2m 5s')
})
