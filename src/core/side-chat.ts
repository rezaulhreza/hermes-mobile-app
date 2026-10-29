/**
 * The side chat of a conversation: questions to a side agent that reads a
 * snapshot of the conversation (`prompt.btw`). The bot goes on with its turn,
 * and nothing of the side chat goes into the conversation until the user puts
 * it there. The answer arrives as a `btw.complete` event with the task id.
 */

export interface SideTurn {
  /** Ours, from the moment of the question: the task id comes later. */
  key: number
  question: string
  taskId: string | null
  /** Null while the side agent works. */
  answer: string | null
  /** The host refused the question, in its words. */
  failure: string | null
}

export function withQuestion(turns: readonly SideTurn[], key: number, question: string): SideTurn[] {
  return [...turns, { key, question, taskId: null, answer: null, failure: null }]
}

/** The host took the question. An answer that came before its task id was known is in `early`. */
export function withTask(turns: readonly SideTurn[], key: number, taskId: string, early?: string): SideTurn[] {
  return turns.map(turn => (turn.key === key ? { ...turn, taskId, answer: early ?? turn.answer } : turn))
}

export function withFailure(turns: readonly SideTurn[], key: number, failure: string): SideTurn[] {
  return turns.map(turn => (turn.key === key ? { ...turn, failure } : turn))
}

/** The answer of a task. Null when no turn has this task: the answer is for another screen, or came early. */
export function withAnswer(turns: readonly SideTurn[], taskId: string, text: string): SideTurn[] | null {
  if (!turns.some(turn => turn.taskId === taskId)) {
    return null
  }

  return turns.map(turn => (turn.taskId === taskId ? { ...turn, answer: text.trim() || 'The side agent gave no answer.' } : turn))
}

/** The words that go into the message field of the conversation when the user takes an answer there. */
export function answerForMessage(turn: Pick<SideTurn, 'question' | 'answer'>): string {
  return `From a side chat. Q: ${turn.question.trim()}\nA: ${(turn.answer ?? '').trim()}`
}
