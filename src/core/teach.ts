/**
 * Teach a bot a task from its chat. Hermes has a command for it: `/learn`
 * writes a skill from what the user describes (a folder, a page, notes, or
 * the work of this chat) and saves it for the bot of the chat. The host turns
 * the command into a long instruction for the agent
 * (`agent/learn_prompt.py::build_learn_prompt`). The chat shows the request
 * of the user, not that instruction.
 */

/** What the host writes for a `/learn` with no words: the work of this chat. */
const FROM_CHAT = /^the workflow we just went through in this conversation\b/

const INSTRUCTION = /^\[\/learn\] The user wants you to learn a reusable skill[\s\S]*?\n\nTHE REQUEST:\n([\s\S]*?)\n\nThe request is open-ended/

/** The words a person reads for "learn from this chat". */
export const TEACH_FROM_CHAT = 'What we did in this chat'

/** The command that teaches the bot. No words: the work of this chat. */
export function teachCommand(request: string): string {
  // The command takes one line of words after its name. A new line would end it.
  const words = request.replace(/\s*\n+\s*/g, ' ').trim()

  return words ? `/learn ${words}` : '/learn'
}

/** What the user asked the bot to learn, when a message is the instruction of the host for it. Null for every other message. */
export function teachRequest(message: string): string | null {
  const request = INSTRUCTION.exec(message.trimStart())?.[1].trim()

  return request === undefined ? null : FROM_CHAT.test(request) ? TEACH_FROM_CHAT : request
}
