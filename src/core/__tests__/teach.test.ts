import { TEACH_FROM_CHAT, teachCommand, teachRequest } from '../teach'
import { EMPTY_TRANSCRIPT, transcriptFromHistory, withUserMessage } from '../transcript'

// The instruction as `agent/learn_prompt.py::build_learn_prompt` of the host writes it.
const instruction = (request: string) =>
  `[/learn] The user wants you to learn a reusable skill from the request below, and save it.\n\nTHE REQUEST:\n${request}\n\nThe request is open-ended and may mix two kinds of content, in any order: SOURCES to gather. Do this:\n1. Inventory every source.`

describe('teaching a bot from its chat', () => {
  it('makes the command of the host', () => {
    expect(teachCommand('  how to write my weekly report ')).toBe('/learn how to write my weekly report')
    expect(teachCommand('read /Users/me/notes\nfocus on the plan')).toBe('/learn read /Users/me/notes focus on the plan')
    expect(teachCommand('  ')).toBe('/learn')
  })

  it('finds the request of the user in the instruction of the host', () => {
    expect(teachRequest(instruction('how to write my weekly report'))).toBe('how to write my weekly report')
    expect(teachRequest(instruction('the workflow we just went through in this conversation — review the steps taken and distill them into a reusable skill'))).toBe(TEACH_FROM_CHAT)
    expect(teachRequest('teach me how to learn')).toBeNull()
    expect(teachRequest('[/learn] is a command')).toBeNull()
  })

  it('shows the request in the chat, when it is sent and when the chat is read again', () => {
    const sent = withUserMessage(EMPTY_TRANSCRIPT, instruction('how to file an expense')).items[0]
    const read = transcriptFromHistory([{ role: 'user', text: instruction('how to file an expense') }]).items[0]

    expect(sent).toMatchObject({ kind: 'user', text: 'how to file an expense', teach: true })
    expect(read).toMatchObject({ kind: 'user', text: 'how to file an expense', teach: true })
    expect(withUserMessage(EMPTY_TRANSCRIPT, 'hello').items[0]).not.toHaveProperty('teach')
  })
})
