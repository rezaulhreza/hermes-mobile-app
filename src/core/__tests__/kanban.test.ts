import { boardColumns, boardRows, cardDetail, columnName, firstColumn } from '../kanban'

describe('boards and columns', () => {
  it('lists the boards that are not archived', () => {
    expect(boardRows({ boards: [{ slug: 'a', name: 'Alpha', total: 3, is_current: true }, { slug: 'b', name: '', archived: true }, { slug: 'c' }] })).toEqual([
      { slug: 'a', name: 'Alpha', description: '', total: 3, current: true },
      { slug: 'c', name: 'c', description: '', total: 0, current: false }
    ])
  })

  it('keeps a short row for each card, the highest priority first', () => {
    const [ready] = boardColumns({ columns: [{ name: 'ready', tasks: [{ id: 't1', title: 'Low', priority: 1, body: 'x'.repeat(5000) }, { id: 't2', title: 'High', priority: 5, assignee: 'qa', latest_summary: ' did\n it ' }, { title: 'no id' }] }] })

    expect(ready.cards).toEqual([
      { id: 't2', title: 'High', assignee: 'qa', priority: 5, summary: 'did it' },
      { id: 't1', title: 'Low', assignee: '', priority: 1, summary: '' }
    ])
  })

  it('names a column for a person', () => {
    expect(columnName('running')).toBe('In work')
    expect(columnName('needs_owner')).toBe('Needs owner')
  })

  it('opens a board on the column that needs a person', () => {
    const column = (key: string, count: number) => ({ key, cards: Array.from({ length: count }, (_, index) => ({ id: `${key}${index}`, title: '', assignee: '', priority: 0, summary: '' })) })

    expect(firstColumn([column('ready', 4), column('blocked', 1), column('done', 9)])).toBe('blocked')
    expect(firstColumn([column('triage', 0), column('done', 2)])).toBe('done')
    expect(firstColumn([column('triage', 0)])).toBe('triage')
    expect(firstColumn([])).toBe('')
  })
})

describe('cardDetail', () => {
  it('reads a card with its comments', () => {
    expect(cardDetail({ task: { id: 't1', title: 'Fix', body: 'Do it', status: 'blocked', assignee: 'qa', last_failure_error: 'no key' }, comments: [{ id: 3, author: 'qa', body: 'Stuck', created_at: 50 }, { body: ' ' }] })).toEqual({
      id: 't1',
      title: 'Fix',
      body: 'Do it',
      status: 'blocked',
      assignee: 'qa',
      note: 'no key',
      comments: [{ id: '3', author: 'qa', body: 'Stuck', at: 50 }]
    })
    expect(cardDetail({})).toBeNull()
  })
})
