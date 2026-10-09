import type { GatewayEvent } from '../gateway/gateway-events'
import { EMPTY_TRANSCRIPT, reduceTranscript, transcriptFromHistory, withUserMessage } from '../transcript'

const run = (events: unknown[], start = EMPTY_TRANSCRIPT) =>
  events.reduce<typeof EMPTY_TRANSCRIPT>((t, e) => reduceTranscript(t, e as GatewayEvent), start)

const delta = (text: string) => ({ type: 'message.delta', payload: { text } })
const shape = (t: typeof EMPTY_TRANSCRIPT) => t.items.map(i => (i.kind === 'tool' ? `tool:${i.name}:${i.state}` : `${i.kind}:${i.text}`))

describe('transcript', () => {
  it('joins streamed deltas into one assistant message and settles it on complete', () => {
    const t = run([delta('Hel'), delta('lo'), { type: 'message.complete', payload: { text: 'Hello', status: 'complete' } }], withUserMessage(EMPTY_TRANSCRIPT, 'hi'))

    expect(shape(t)).toEqual(['user:hi', 'assistant:Hello'])
    expect(t.running).toBe(false)
    expect(t.items[1]).toMatchObject({ streaming: false })
  })

  it('keeps tool rows between the text that came before and after them', () => {
    const t = run([
      delta('Checking.'),
      { type: 'tool.start', payload: { tool_id: 't1', name: 'terminal', preview: 'ls' } },
      { type: 'tool.complete', payload: { tool_id: 't1', name: 'terminal', duration_s: 0.4 } },
      delta('Done.')
    ])

    expect(shape(t)).toEqual(['assistant:Checking.', 'tool:terminal:done', 'assistant:Done.'])
    expect(t.items[1]).toMatchObject({ durationS: 0.4, detail: 'ls' })
    expect(t.running).toBe(true)
  })

  it('shows the final text of a turn that sent no deltas', () => {
    const t = run([{ type: 'message.complete', payload: { text: 'Cached answer', status: 'complete' } }])

    expect(shape(t)).toEqual(['assistant:Cached answer'])
  })

  it('does not repeat the final text after it was streamed', () => {
    const t = run([delta('Answer'), { type: 'message.complete', payload: { text: 'Answer', status: 'complete' } }])

    expect(t.items).toHaveLength(1)
  })

  it('marks an interrupted turn and stops a tool that was still running', () => {
    const t = run([
      { type: 'tool.start', payload: { tool_id: 't1', name: 'browser' } },
      { type: 'message.complete', payload: { status: 'interrupted' } }
    ])

    expect(shape(t)).toEqual(['tool:browser:done', 'notice:Stopped'])
    expect(t.running).toBe(false)
  })

  it('shows the failure reason of a failed turn', () => {
    const t = run([{ type: 'message.complete', payload: { status: 'error', error: 'Rate limited' } }])

    expect(t.items[0]).toMatchObject({ kind: 'notice', tone: 'error', text: 'Rate limited' })
  })

  it('holds the backend status line until the turn ends', () => {
    const working = run([{ type: 'status.update', payload: { kind: 'compress', text: 'Compressing context' } }])

    expect(working.status).toBe('Compressing context')
    expect(run([{ type: 'message.complete', payload: { status: 'complete' } }], working).status).toBeNull()
  })

  it('rebuilds stored history and skips empty rows', () => {
    const t = transcriptFromHistory(
      [
        { role: 'user', text: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'tool', name: 'terminal', tool_call_id: 'c1', context: 'ls' },
        { role: 'assistant', text: '' },
        { role: 'system', text: 'hidden' }
      ],
      true
    )

    expect(shape(t)).toEqual(['user:hi', 'assistant:hello', 'tool:terminal:done'])
    expect(t.running).toBe(true)
    expect(new Set(t.items.map(i => i.key)).size).toBe(3)
  })
})
