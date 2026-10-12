import { historyPagePath, HISTORY_PAGE, oldestRowId, pageMessages, rowsBefore, toolPreview } from '../history-page'
import { transcriptFromHistory, withOlderHistory } from '../transcript'

const call = (id: string, name: string, args: unknown) => ({ id, function: { name, arguments: JSON.stringify(args) } })

describe('historyPagePath', () => {
  it('asks for the newest rows, with no picture data', () => {
    expect(historyPagePath('a b', 120)).toBe(`/api/sessions/a%20b/messages?order=latest&limit=${HISTORY_PAGE}&offset=120&inline_images=false`)
  })
})

describe('pageMessages', () => {
  it('gives a tool row the name and the arguments of its call', () => {
    const messages = pageMessages([
      { id: 1, role: 'user', content: 'list the files' },
      { id: 2, role: 'assistant', content: '', tool_calls: [call('c1', 'terminal', { command: 'ls -la' })] },
      { id: 3, role: 'tool', tool_call_id: 'c1', tool_name: 'terminal', content: '{"output":"a\\nb"}' },
      { id: 4, role: 'assistant', content: 'Two files.' }
    ])

    expect(messages).toEqual([
      { role: 'user', text: 'list the files', row_id: 1 },
      { role: 'tool', name: 'terminal', context: 'ls -la', tool_call_id: 'c1', args: { command: 'ls -la' } },
      { role: 'assistant', text: 'Two files.', row_id: 4 }
    ])
  })

  it('reads tool calls stored as JSON text', () => {
    const messages = pageMessages([
      { role: 'assistant', tool_calls: JSON.stringify([call('c1', 'read_file', { path: '/tmp/a.txt' })]) },
      { role: 'tool', tool_call_id: 'c1' }
    ])

    expect(messages[0]).toMatchObject({ name: 'read_file', context: '/tmp/a.txt' })
  })

  it('keeps a tool row whose call is on an older page, with the stored name', () => {
    expect(pageMessages([{ role: 'tool', tool_call_id: 'c9', tool_name: 'patch' }])).toEqual([
      { role: 'tool', name: 'patch', context: '', tool_call_id: 'c9' }
    ])
  })

  it('leaves out rows that are for the model only', () => {
    const messages = pageMessages([
      { role: 'user', content: '[System: the stream was cut]', display_kind: 'hidden' },
      { role: 'user', content: '[Background process p1 heartbeat #3 still running]' },
      { role: 'system', content: 'You are an agent' },
      { role: 'assistant', content: '   ' }
    ])

    expect(messages).toEqual([])
  })

  it('shows the display text of a row in the place of its stored text', () => {
    expect(pageMessages([{ role: 'user', content: '[CONTEXT SUMMARY] long text', display_content: 'Earlier conversation, summarised' }])[0].text).toBe(
      'Earlier conversation, summarised'
    )
  })

  it('shows the command of a skill turn, not the body of the skill', () => {
    const stored =
      '[IMPORTANT: The user has invoked the "work" skill. The full skill content is loaded below.]\n\nbody\n\nThe user has provided the following instruction alongside the skill invocation: fix the leak\n\n[Runtime note: x]'

    expect(pageMessages([{ role: 'user', content: stored }])[0].text).toBe('/work fix the leak')
  })

  it('joins the text parts of a message and marks a picture', () => {
    expect(pageMessages([{ role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: {} }] }])[0].text).toBe(
      'what is this\n[image]'
    )
  })
})

describe('toolPreview', () => {
  it('takes the main argument and one line of it', () => {
    expect(toolPreview({ timeout: 5, description: 'x', command: 'echo a\necho b' })).toBe('echo a')
  })

  it('cuts a long value', () => {
    expect(toolPreview({ query: 'q'.repeat(200) })).toHaveLength(80)
  })

  it('is empty with no text argument', () => {
    expect(toolPreview({ count: 3 })).toBe('')
  })
})

describe('paging', () => {
  const rows = [{ id: 7 }, { id: 8 }, { id: 9 }]

  it('finds the oldest row of a page', () => {
    expect(oldestRowId(rows)).toBe(7)
    expect(oldestRowId([])).toBeNull()
  })

  it('drops the rows of an older page that the screen has already', () => {
    expect(rowsBefore([{ id: 5 }, { id: 6 }, { id: 7 }, { id: 8 }], 7)).toEqual([{ id: 5 }, { id: 6 }])
    expect(rowsBefore(rows, null)).toEqual(rows)
  })
})

describe('withOlderHistory', () => {
  it('puts older rows before the rows on screen, with keys that no other row has', () => {
    const newest = transcriptFromHistory([{ role: 'user', text: 'second' }, { role: 'assistant', text: 'answer' }])
    const first = withOlderHistory(newest, [{ role: 'user', text: 'first' }], 60)
    const both = withOlderHistory(first, [{ role: 'user', text: 'zero' }], 120)

    expect(both.items.map(item => (item.kind === 'user' || item.kind === 'assistant' ? item.text : ''))).toEqual(['zero', 'first', 'second', 'answer'])
    expect(new Set(both.items.map(item => item.key)).size).toBe(4)
    expect(both.nextKey).toBe(newest.nextKey)
  })

  it('keeps the state of a turn that runs', () => {
    const running = transcriptFromHistory([{ role: 'user', text: 'go' }], true)

    expect(withOlderHistory(running, [{ role: 'user', text: 'before' }], 60).running).toBe(true)
  })
})
