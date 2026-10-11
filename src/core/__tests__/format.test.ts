import { duration, fileSize, headLines, previewLine, relativeTime, statusWords } from '../format'

describe('previewLine', () => {
  it('removes terminal prompt glyphs and box drawing from pasted output', () => {
    expect(previewLine('\u256D\u2500 \uE0B6 \uF115 ~/Developer \uE0B4\u2500\u2500\u2500\u2500\u256E\n  NameError: CASES')).toBe('~/Developer NameError: CASES')
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

it('cuts a long output to its first lines and counts the rest', () => {
  expect(headLines('a\nb\nc\nd\n\n', 2)).toEqual({ head: 'a\nb', hidden: 2 })
  expect(headLines('a\nb\n', 2)).toEqual({ head: 'a\nb', hidden: 0 })
})

describe('fileSize', () => {
  it('uses the unit a person reads', () => {
    expect(fileSize(640)).toBe('640 B')
    expect(fileSize(348_160)).toBe('340 KB')
    expect(fileSize(1_258_291)).toBe('1.2 MB')
    expect(fileSize(12 * 1024 * 1024)).toBe('12 MB')
  })
})

describe('statusWords', () => {
  it('cuts the drawn face off the working line', () => {
    expect(statusWords('\u25C9_\u25C9 analyzing...')).toBe('Analyzing\u2026')
    expect(statusWords('(o_o) pondering...')).toBe('Pondering\u2026')
    expect(statusWords('( \u2022_\u2022) thinking it over\u2026')).toBe('Thinking it over\u2026')
  })

  it('keeps a line that is only words', () => {
    expect(statusWords('Compressing context')).toBe('Compressing context')
  })

  it('returns a line with no plain words as it is', () => {
    expect(statusWords(' \u25C9_\u25C9 ')).toBe('\u25C9_\u25C9')
  })
})
