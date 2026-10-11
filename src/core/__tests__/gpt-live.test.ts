import { commentaryParts, contextWindow, delegationPrompt, liveHistory } from '../gpt-live'

describe('commentaryParts', () => {
  it('keeps a short answer whole', () => {
    expect(commentaryParts('  Done.\n All tests pass. ')).toEqual(['Done. All tests pass.'])
    expect(commentaryParts('   ')).toEqual([])
  })

  it('cuts a long answer at the ends of sentences', () => {
    const parts = commentaryParts('One two three. Four five six. Seven eight nine.', 30)

    expect(parts).toEqual(['One two three. Four five six.', 'Seven eight nine.'])
  })

  it('cuts a sentence that is longer than the limit', () => {
    expect(commentaryParts('a'.repeat(25), 10).map(part => part.length)).toEqual([10, 10, 5])
  })
})

describe('liveHistory', () => {
  it('keeps the newest turns inside the limits, oldest first', () => {
    const history = liveHistory(
      [
        { role: 'user', text: 'first' },
        { role: 'assistant', text: 'second' },
        { role: 'user', text: '   ' },
        { role: 'user', text: 'third' }
      ],
      2
    )

    expect(history.map(message => message.content[0].text)).toEqual(['second', 'third'])
    expect(history[0].content[0].type).toBe('output_text')
    expect(history[1].content[0].type).toBe('input_text')
  })
})

describe('delegationPrompt', () => {
  it('gives the last words of the user as the message and the exchange as context', () => {
    const { prompt, context } = delegationPrompt([
      { speaker: 'user', text: 'Hi. ', endMs: 1 },
      { speaker: 'assistant', text: 'Hello, what ', endMs: 2 },
      { speaker: 'assistant', text: 'do you need?', endMs: 3 },
      { speaker: 'user', text: 'Run the ', endMs: 4 },
      { speaker: 'user', text: 'tests.', endMs: 5 }
    ])

    expect(prompt).toBe('Run the tests.')
    expect(context).toBe('User: Hi.\nVoice assistant: Hello, what do you need?\nUser: Run the tests.')
  })

  it('falls back to the context when the user said nothing', () => {
    expect(delegationPrompt([{ speaker: 'assistant', text: 'Checking now.', endMs: 1 }]).prompt).toBe('Voice assistant: Checking now.')
  })
})

describe('contextWindow', () => {
  it('drops what was said more than five minutes before the last words', () => {
    const window = contextWindow([
      { speaker: 'user', text: 'old', endMs: 0 },
      { speaker: 'user', text: 'new', endMs: 6 * 60_000 }
    ])

    expect(window.map(fragment => fragment.text)).toEqual(['new'])
  })
})
