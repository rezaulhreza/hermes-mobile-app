import { answerForMessage, withAnswer, withFailure, withQuestion, withTask } from '../side-chat'

describe('the side chat', () => {
  it('follows a question from the ask to the answer', () => {
    const asked = withQuestion([], 1, 'Which file joins the stream?')
    const taken = withTask(asked, 1, 't1')
    const answered = withAnswer(taken, 't1', ' stt_stream.py ')

    expect(asked[0]).toEqual({ key: 1, question: 'Which file joins the stream?', taskId: null, answer: null, failure: null })
    expect(answered?.[0]).toMatchObject({ taskId: 't1', answer: 'stt_stream.py' })
  })

  it('leaves an answer for another task alone', () => {
    expect(withAnswer(withTask(withQuestion([], 1, 'q'), 1, 't1'), 't2', 'a')).toBeNull()
  })

  it('takes an answer that came before the task id', () => {
    expect(withTask(withQuestion([], 1, 'q'), 1, 't1', 'early')[0].answer).toBe('early')
  })

  it('says when the side agent had no words, and keeps a refusal', () => {
    expect(withAnswer(withTask(withQuestion([], 1, 'q'), 1, 't1'), 't1', '  ')?.[0].answer).toBe('The side agent gave no answer.')
    expect(withFailure(withQuestion([], 1, 'q'), 1, 'No live session')[0].failure).toBe('No live session')
  })

  it('writes the question and the answer for the message field', () => {
    expect(answerForMessage({ question: ' Why? ', answer: 'Because.' })).toBe('From a side chat. Q: Why?\nA: Because.')
  })
})
