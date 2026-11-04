import { agentRequestFrom, requestSummary, tellWords, wireResult } from '../requests'

describe('agentRequestFrom', () => {
  it('models an approval and keeps only the choices the backend allows', () => {
    const request = agentRequestFrom('approval', 'r1', {
      session_id: 's1',
      request_id: 'a1',
      command: 'rm -rf build',
      choices: ['once', 'deny', 'bogus']
    })

    expect(request).toMatchObject({ kind: 'approval', id: 'a1', sessionId: 's1', choices: ['once', 'deny'] })
  })

  it('offers the safe default choices when the backend names none', () => {
    expect(agentRequestFrom('approval', 'r1', { session_id: 's1' })).toMatchObject({ id: 'r1', choices: ['once', 'session', 'deny'] })
  })

  it('models a clarify request and drops malformed questions', () => {
    const request = agentRequestFrom('clarify', 'r2', {
      session_id: 's1',
      questions: [{ qid: 'q1', question: 'Which?', choices: ['A', 'B'], multi_select: true }, { question: 'no id' }]
    })

    expect(request).toMatchObject({ kind: 'clarify', questions: [{ qid: 'q1', choices: ['A', 'B'], multiSelect: true }] })
    expect(agentRequestFrom('clarify', 'r2', { questions: [] })).toBeNull()
  })

  it('models every credential request as a value request', () => {
    expect(agentRequestFrom('secret', 'r', { env_var: 'GITHUB_TOKEN', prompt: 'For the gh skill' })).toMatchObject({ kind: 'value', title: 'GITHUB_TOKEN', numeric: false })
    expect(agentRequestFrom('sudo', 'r', { command: 'apt install x' })).toMatchObject({ kind: 'value', detail: 'apt install x' })
    expect(agentRequestFrom('vault.code', 'r', { site: 'github.com' })).toMatchObject({ kind: 'value', numeric: true })
    expect(agentRequestFrom('vault.unlock_prompt', 'r', { display_name: '1Password' })).toMatchObject({ title: 'Unlock 1Password' })
  })

  it('declines a request that only a desktop window can answer', () => {
    expect(agentRequestFrom('preview.read', 'r', {})).toBeNull()
    expect(agentRequestFrom('window.read', 'r', {})).toBeNull()
  })
})

describe('wireResult', () => {
  it('answers in the shape each request expects', () => {
    expect(wireResult({ kind: 'approval', choice: 'deny' })).toEqual({ choice: 'deny' })
    expect(wireResult({ kind: 'clarify', answers: { q1: 'A' } })).toEqual({ answers: { q1: 'A' } })
    expect(wireResult({ kind: 'value', value: '123456' })).toEqual({ value: '123456' })
    expect(JSON.parse(wireResult({ kind: 'login', identifier: 'me', password: 'pw' }).value as string)).toEqual({ identifier: 'me', password: 'pw' })
  })
})

it('summarises a request for a list row', () => {
  const login = agentRequestFrom('vault.save_login', 'r', { site: 'github.com', origin: 'https://github.com' })

  expect(login && requestSummary(login)).toBe('Save a login for github.com')
})

describe('a message in the place of a form', () => {
  const { answerInOwnWords } = jest.requireActual('../requests') as typeof import('../requests')
  const question = (qid: string) => ({ qid, question: qid, choices: [], multiSelect: false })

  it('answers the one question of a form', () => {
    expect(answerInOwnWords([question('a')], ' Assay ')).toEqual({ a: 'Assay' })
  })

  it('gives the words to the first question and skips the others', () => {
    expect(answerInOwnWords([question('a'), question('b'), question('c')], 'Assay, and I am at the desk nine to five')).toEqual({
      a: 'Assay, and I am at the desk nine to five',
      b: null,
      c: null
    })
  })

  it('reads a Smart refusal: allow once or deny, never for the chat', () => {
    const request = agentRequestFrom('approval', 'r9', { session_id: 's1', command: 'rm -rf build', smart_denied: true })

    expect(request).toMatchObject({ smartDenied: true, choices: ['once', 'deny'] })
    expect(agentRequestFrom('approval', 'r9', { session_id: 's1' })).toMatchObject({ smartDenied: false })
  })

  it('sends a plain deny on the wire: the words for the agent go apart', () => {
    expect(wireResult({ kind: 'approval', choice: 'deny', tell: 'Use the staging folder' })).toEqual({ choice: 'deny' })
    expect(tellWords('  Use staging  ')).toBe('Use staging')
  })
})
