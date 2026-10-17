import type { RoomMessage } from '../bots'
import { currentThread, THREAD_GAP_MS, threadRows, threadTitle } from '../threads'

const message = (id: string, at: number, thread?: string, text = id): RoomMessage => ({ id, from: '', mine: false, text, at, ...(thread ? { thread } : {}) })
const shape = (messages: RoomMessage[]) => threadRows(messages).map(row => `${row.message.id}:${row.thread}${row.first ? ':first' : ''}${row.last ? ':last' : ''}`)

describe('the threads of a group chat', () => {
  it('keeps a thread together, and puts the thread with the newest message last', () => {
    expect(shape([message('a', 1, 't1'), message('b', 2, 't1'), message('c', 3, 't2'), message('d', 4, 't1')])).toEqual(['c:t2:first:last', 'a:t1:first', 'b:t1', 'd:t1:last'])
  })

  it('gives one thread to old messages that are near in time, and cannot name it to the host', () => {
    const rows = threadRows([message('a', 0), message('b', 1000), message('c', THREAD_GAP_MS + 2000), message('d', THREAD_GAP_MS + 3000, 't9')])

    expect(rows.map(row => [row.message.id, row.thread, row.known])).toEqual([['a', 'old-1', false], ['b', 'old-1', false], ['c', 'old-2', false], ['d', 't9', true]])
  })

  it('has no row for a room with no message', () => {
    expect(threadRows([])).toEqual([])
  })

  it('goes on with the newest thread only while it is recent', () => {
    const messages = [message('a', 1000, 't1'), message('b', 2000, 't2')]

    expect(currentThread(messages, 2000 + THREAD_GAP_MS - 1)).toBe('t2')
    expect(currentThread(messages, 2000 + THREAD_GAP_MS)).toBeNull()
    expect(currentThread([message('a', 1000)], 1500)).toBeNull()
    expect(currentThread([], 0)).toBeNull()
  })

  it('names a thread by the start of its first message', () => {
    const messages = [message('a', 1, 't1', '  Plan for\nround one  '), message('b', 2, 't1', 'later'), message('c', 3, 't2', 'x'.repeat(60))]

    expect(threadTitle(messages, 't1')).toBe('Plan for round one')
    expect(threadTitle(messages, 't2')).toBe(`${'x'.repeat(48)}…`)
    expect(threadTitle(messages, 'none')).toBe('')
  })
})
