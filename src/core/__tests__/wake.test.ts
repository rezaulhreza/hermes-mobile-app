import { pcmBytes } from '../live-voice'
import { FeedQueue, FRAMES_PER_FEED, wakeNotice } from '../wake'

describe('wakeNotice', () => {
  it('names the app that holds the wake word', () => {
    expect(wakeNotice({ reason: 'owned', owner_surface: 'gui' })).toContain('desktop app')
    expect(wakeNotice({ reason: 'owned', owner_surface: 'tui' })).toContain('The tui listens')
  })

  it('uses the hint of the host for a reason it does not know', () => {
    expect(wakeNotice({ reason: 'new_reason', hint: 'Install the engine.' })).toBe('Install the engine.')
    expect(wakeNotice({ reason: 'new_reason' })).toBe('The host refused: new_reason.')
    expect(wakeNotice({})).toBe('')
  })
})

describe('FeedQueue', () => {
  const frame = (value: number) => new Uint8Array([value, value])

  it('gives nothing before a full group, then the frames joined in order', () => {
    const queue = new FeedQueue()

    for (let index = 1; index < FRAMES_PER_FEED; index++) {
      queue.push(frame(index))
      expect(queue.take()).toBeNull()
    }

    queue.push(frame(FRAMES_PER_FEED))
    expect([...pcmBytes(queue.take()!)]).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
    expect(queue.take()).toBeNull()
  })

  it('drops the oldest frames when the host is slow', () => {
    const queue = new FeedQueue()

    for (let index = 0; index < 30; index++) {
      queue.push(frame(index))
    }

    expect([...pcmBytes(queue.take()!)]).toEqual([6, 6, 7, 7, 8, 8, 9, 9])
  })
})
