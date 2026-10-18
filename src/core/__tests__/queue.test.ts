import { EMPTY_QUEUE, enqueue, leaveQueue, pauseQueue, promoteQueued, removeQueued, resumeQueue, takeNext } from '../queue'

const two = enqueue(enqueue(EMPTY_QUEUE, 'first'), 'second', 'spoken before')

describe('the queue of messages on the phone', () => {
  it('keeps the messages in the order they were sent, each with its own id', () => {
    expect(two.items).toEqual([
      { id: 'q0', text: 'first' },
      { id: 'q1', text: 'second', voiceContext: 'spoken before' }
    ])
  })

  it('sends nothing while a turn runs', () => {
    expect(takeNext(two, true)).toEqual({ send: null, queue: two })
  })

  it('sends the oldest message when the turn ended', () => {
    const { send, queue } = takeNext(two, false)

    expect(send?.text).toBe('first')
    expect(queue.items.map(item => item.text)).toEqual(['second'])
  })

  it('takes one message out', () => {
    expect(removeQueued(two, 'q0').items.map(item => item.text)).toEqual(['second'])
  })

  it('puts a message first', () => {
    expect(promoteQueued(two, 'q1').items.map(item => item.text)).toEqual(['second', 'first'])
    expect(promoteQueued(two, 'missing')).toBe(two)
  })

  it('waits for the user after a Stop, and runs again when the user says so', () => {
    const paused = pauseQueue(two)

    expect(takeNext(paused, false).send).toBeNull()
    expect(takeNext(resumeQueue(paused), false).send?.text).toBe('first')
  })

  it('runs again when the user queues a new message', () => {
    expect(enqueue(pauseQueue(two), 'third').paused).toBe(false)
  })

  it('does not pause an empty queue', () => {
    expect(pauseQueue(EMPTY_QUEUE)).toBe(EMPTY_QUEUE)
  })

  it('gives a new id after a message was removed', () => {
    expect(enqueue(removeQueued(two, 'q1'), 'third').items.map(item => item.id)).toEqual(['q0', 'q2'])
  })
})

describe('a queue when its chat closes', () => {
  const queue = enqueue(enqueue(EMPTY_QUEUE, 'first'), 'second')

  it('goes to the host while a turn runs', () => {
    expect(leaveQueue(queue, true)).toEqual({ handOver: queue.items, keep: null })
  })

  it('is kept when it waits for the user, or when no turn runs', () => {
    expect(leaveQueue({ ...queue, paused: true }, true)).toEqual({ handOver: [], keep: { ...queue, paused: true } })
    expect(leaveQueue(queue, false)).toEqual({ handOver: [], keep: queue })
  })

  it('is nothing when it is empty', () => {
    expect(leaveQueue(EMPTY_QUEUE, true)).toEqual({ handOver: [], keep: null })
    expect(leaveQueue(undefined, true)).toEqual({ handOver: [], keep: null })
  })
})

