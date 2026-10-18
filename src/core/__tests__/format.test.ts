import { clockWords, dateWords, dayWords, duration, fileSize, headLines, previewLine, readableDates, relativeTime, statusWords } from '../format'

describe('previewLine', () => {
  it('reads a date in a row as a date', () => {
    expect(previewLine('Checked production (server time 2020-10-11 00:59 UTC)')).toBe('Checked production (server time 11 Oct 2020 at 12:59 am UTC)')
  })

  it('shows words, not the marks of Markdown', () => {
    expect(previewLine('**Load Test** The bridge was *two* years older')).toBe('Load Test The bridge was two years older')
    expect(previewLine('## Plan\n\n- first `step`\n- second\n\n> a quote\n1. one')).toBe('Plan first step second a quote one')
    expect(previewLine('see [the page](https://h.example/a) and ~~not~~ this\n---\nend')).toBe('see the page and not this end')
    // The host cut the preview in the middle of a mark.
    expect(previewLine('Saved. **Skill: teach')).toBe('Saved. Skill: teach')
    // Not Markdown: a sum, a path with a star, a name with a line under it.
    expect(previewLine('2 * 3 * 4 and src/*.ts and my_file_name')).toBe('2 * 3 * 4 and src/*.ts and my_file_name')
  })

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

describe('faultWords', () => {
  const { faultWords } = jest.requireActual('../format') as typeof import('../format')

  it('gives the sentence of a refused request', () => {
    expect(faultWords(new Error('400: {"detail":"This provider is not connected."}'))).toBe('This provider is not connected.')
  })

  it('leaves other text as it is', () => {
    expect(faultWords(new Error('Not connected to a Hermes workspace.'))).toBe('Not connected to a Hermes workspace.')
    expect(faultWords('502: Bad Gateway')).toBe('Bad Gateway')
  })
})

describe('a date as a person reads it', () => {
  const now = new Date(2026, 9, 11, 12, 0)

  it('says the day, the month and the time of day', () => {
    expect(dayWords(new Date(2026, 10, 11), now)).toBe('11 Nov')
    expect(dayWords(new Date(2025, 10, 11), now)).toBe('11 Nov 2025')
    expect(clockWords(new Date(2026, 0, 1, 0, 5))).toBe('12:05 am')
    expect(clockWords(new Date(2026, 0, 1, 12, 0))).toBe('12:00 pm')
    expect(clockWords(new Date(2026, 0, 1, 20, 30))).toBe('8:30 pm')
    expect(dateWords(new Date(2026, 10, 10, 9, 0), now)).toBe('10 Nov at 9:00 am')
  })

  it('reads the technical dates in a text of the host', () => {
    expect(readableDates('Storage audit 2026-10-10', now)).toBe('Storage audit 10 Oct')
    expect(readableDates('once at 2026-10-07 20:00', now)).toBe('once at 7 Oct at 8:00 pm')
    expect(readableDates('Storage audit (read-only) · Oct 10 20:31', now)).toBe('Storage audit (read-only) · 10 Oct at 8:31 pm')
    expect(readableDates('ran 2026-10-06T02:01:52.479250+01:00 and 2025-12-31T23:59:00Z', now)).toBe('ran 6 Oct at 2:01 am and 31 Dec 2025 at 11:59 pm')
  })

  it('leaves a number that only looks like a date', () => {
    expect(readableDates('build 2026-13-45 and id 12026-10-07 and 2026-10-071', now)).toBe('build 2026-13-45 and id 12026-10-07 and 2026-10-071')
    expect(readableDates('feat/backup-2026-10-07', now)).toBe('feat/backup-2026-10-07')
    expect(readableDates('no date here', now)).toBe('no date here')
  })
})
