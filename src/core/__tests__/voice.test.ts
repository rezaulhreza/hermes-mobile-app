import { advanceListen, audioExtension, base64Bytes, callTimer, dataUrlParts, isGoodbye, levelFraction, type Listen, NEW_LISTEN, recordingMime, speakable } from '../voice'

function feed(levels: number[], stepMs = 100, start: Listen = NEW_LISTEN) {
  let listen = start
  let last = advanceListen(listen, levels[0], 0)

  for (const level of levels) {
    last = advanceListen(listen, level, stepMs)
    listen = last.listen

    if (last.done) {
      break
    }
  }

  return last
}

const quiet = (count: number) => Array<number>(count).fill(-55)
const loud = (count: number) => Array<number>(count).fill(-20)

describe('advanceListen', () => {
  it('waits in a quiet room, however long', () => {
    expect(feed(quiet(300)).done).toBe(false)
  })

  it('ends after the user spoke and then was quiet', () => {
    const step = feed([...quiet(5), ...loud(10), ...quiet(20)])

    expect(step).toMatchObject({ done: true, reason: 'said' })
    expect(step.listen.totalMs).toBe(2800)
  })

  it('does not end on a pause inside a sentence', () => {
    expect(feed([...loud(10), ...quiet(8), ...loud(10), ...quiet(5)]).done).toBe(false)
  })

  it('does not take a click for speech', () => {
    expect(feed([...loud(2), ...quiet(40)]).done).toBe(false)
  })

  it('cuts one utterance that never stops', () => {
    expect(feed(loud(700))).toMatchObject({ done: true, reason: 'long' })
  })

  it('treats a missing level as silence', () => {
    expect(advanceListen(NEW_LISTEN, undefined, 100).listen.spoke).toBe(false)
  })
})

describe('what is on the screen', () => {
  it('formats the timer', () => {
    expect(callTimer(7)).toBe('00:07')
    expect(callTimer(760)).toBe('12:40')
    expect(callTimer(3723)).toBe('1:02:03')
  })

  it('maps the level to a fraction', () => {
    expect(levelFraction(0)).toBe(1)
    expect(levelFraction(-30)).toBe(0.5)
    expect(levelFraction(-120)).toBe(0)
    expect(levelFraction(undefined)).toBe(0)
  })
})

describe('speakable', () => {
  it('says the words and not the marks', () => {
    expect(speakable('## Plan\n\n- **First**, open the [docs](https://x.y/z).\n- Then run `npm test`.')).toBe('Plan First, open the docs. Then run npm test.')
  })

  it('names code and a table and does not read them', () => {
    expect(speakable('Run this:\n```sh\nrm -rf x\n```\nDone.')).toBe('Run this: (there is code on the screen) Done.')
    expect(speakable('Compare:\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\nPick A.')).toBe('Compare: (there is a table on the screen) Pick A.')
  })

  it('cuts a long answer at a sentence', () => {
    const said = speakable(`${'This is one sentence. '.repeat(100)}`)

    expect(said.length).toBeLessThan(1450)
    expect(said.endsWith('sentence. The rest is on the screen.')).toBe(true)
  })
})

describe('audio details', () => {
  it('names the type of a recording', () => {
    expect(recordingMime('file:///tmp/rec-1.m4a')).toBe('audio/mp4')
    expect(recordingMime('file:///tmp/rec.wav')).toBe('audio/wav')
  })

  it('splits a data address', () => {
    expect(dataUrlParts('data:audio/mpeg;base64,AAAA')).toEqual({ mime: 'audio/mpeg', base64: 'AAAA' })
    expect(dataUrlParts('https://x')).toBeNull()
    expect(audioExtension('audio/mpeg')).toBe('mp3')
    expect(audioExtension('audio/ogg; codecs=opus')).toBe('ogg')
    expect(audioExtension('audio/mp4')).toBe('m4a')
  })

  it('knows the words that end a call', () => {
    expect(isGoodbye(' Goodbye. ')).toBe(true)
    expect(isGoodbye('end the call')).toBe(true)
    expect(isGoodbye('stop the build and say goodbye to the old branch')).toBe(false)
  })
})

describe('base64Bytes', () => {
  it('decodes with and without padding', () => {
    expect([...base64Bytes('SGVsbG8=')]).toEqual([72, 101, 108, 108, 111])
    expect([...base64Bytes('SGk')]).toEqual([72, 105])
    expect([...base64Bytes('AAEC\n/w==')]).toEqual([0, 1, 2, 255])
    expect(base64Bytes('').length).toBe(0)
  })
})
