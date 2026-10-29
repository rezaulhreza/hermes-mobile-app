import type { GatewayEvent } from '../gateway/gateway-events'
import { agentsHeading, currentTodo, helperEnded, NO_WORK, reduceWork, shownAgents, withSnapshots, withTodos, workSummary } from '../work'

const event = (type: string, payload: Record<string, unknown>) => ({ type, session_id: 's', payload }) as unknown as GatewayEvent
const run = (events: GatewayEvent[]) => events.reduce((work, next) => reduceWork(work, next, 1000), NO_WORK)

describe('todos', () => {
  it('takes a snapshot and never goes back to an older one', () => {
    const first = withTodos(NO_WORK, [{ id: 'a', content: 'Read the code', status: 'completed' }, { id: 'b', content: 'Write the fix', status: 'in_progress' }], 2)
    const stale = withTodos(first, [{ id: 'a', content: 'Read the code', status: 'pending' }], 1)

    expect(first.todos.map(todo => todo.status)).toEqual(['completed', 'in_progress'])
    expect(stale).toBe(first)
  })

  it('drops an item with no text and reads an unknown status as pending', () => {
    expect(withTodos(NO_WORK, [{ id: 1, content: ' ' }, { id: 2, content: 'Ship', status: 'odd' }, 'x'], 1).todos).toEqual([{ id: '2', content: 'Ship', status: 'pending' }])
  })

  it('reads the list from a todo tool result', () => {
    expect(run([event('tool.complete', { name: 'todo', todos: [{ id: 'a', content: 'One', status: 'pending' }], revision: 1 })]).todos).toHaveLength(1)
    expect(run([event('tool.complete', { name: 'terminal' })])).toBe(NO_WORK)
  })

  it('names the step the agent is on', () => {
    const work = withTodos(NO_WORK, [{ id: 'a', content: 'One', status: 'completed' }, { id: 'b', content: 'Two', status: 'pending' }, { id: 'c', content: 'Three', status: 'in_progress' }], 1)

    expect(currentTodo(work)?.content).toBe('Three')
    expect(currentTodo(NO_WORK)).toBeNull()
  })
})

describe('helpers', () => {
  it('follows a helper from its start to its end', () => {
    const work = run([
      event('subagent.spawn_requested', { subagent_id: 'h1', goal: 'Find the bug', task_index: 0, task_count: 1 }),
      event('subagent.start', { subagent_id: 'h1', goal: 'Find the bug', model: 'small' }),
      event('subagent.tool', { subagent_id: 'h1', goal: 'Find the bug', tool_name: 'terminal', tool_preview: 'npm test', tool_count: 3 }),
      event('subagent.thinking', { subagent_id: 'h1', goal: 'Find the bug', text: ' The test fails in auth. ' })
    ])

    expect(work.helpers).toEqual([expect.objectContaining({ id: 'h1', status: 'running', model: 'small', toolCount: 3, activity: 'The test fails in auth.', startedAt: 1000 })])

    const ended = reduceWork(work, event('subagent.complete', { subagent_id: 'h1', goal: 'Find the bug', summary: 'Fixed.', duration_seconds: 12 }), 2000)

    expect(ended.helpers[0]).toMatchObject({ status: 'completed', summary: 'Fixed.', durationS: 12, acceptsSteer: false })
    expect(helperEnded(ended.helpers[0])).toBe(true)
  })

  it('keeps a failure as a failure', () => {
    expect(run([event('subagent.complete', { subagent_id: 'h1', goal: 'x', status: 'timeout' })]).helpers[0].status).toBe('timeout')
  })

  it('names a helper by its place when the host sends no id', () => {
    expect(run([event('subagent.start', { goal: 'a', task_index: 0 }), event('subagent.start', { goal: 'b', task_index: 1 })]).helpers.map(helper => helper.id)).toEqual(['task-0', 'task-1'])
  })

  it('joins the list of the host with what the events said', () => {
    const work = run([event('subagent.tool', { subagent_id: 'h1', goal: 'Find the bug', tool_name: 'terminal' })])
    const joined = withSnapshots(work, [
      { subagent_id: 'h1', status: 'running', tool_count: 5, accepting_steer: false },
      { subagent_id: 'h2', goal: 'Write docs', status: 'queued', started_at: 5 }
    ])

    expect(joined.helpers).toEqual([
      expect.objectContaining({ id: 'h1', goal: 'Find the bug', toolCount: 5, activity: 'terminal', acceptsSteer: false }),
      expect.objectContaining({ id: 'h2', goal: 'Write docs', status: 'queued', startedAt: 5000 })
    ])
  })
})

describe('workSummary', () => {
  it('says nothing when there is no work', () => {
    expect(workSummary(NO_WORK)).toBeNull()
  })

  it('counts the plan without cancelled steps, and the helpers at work', () => {
    const todos = withTodos(NO_WORK, [{ id: 'a', content: 'One', status: 'completed' }, { id: 'b', content: 'Two', status: 'pending' }, { id: 'c', content: 'Three', status: 'cancelled' }], 1)
    const work = reduceWork(todos, event('subagent.start', { subagent_id: 'h1', goal: 'x' }), 0)

    expect(workSummary(work)).toBe('1 of 2 done · 1 agent at work')
    expect(workSummary(reduceWork(work, event('subagent.complete', { subagent_id: 'h1', goal: 'x' }), 0))).toBe('1 of 2 done · 1 agent finished')
  })
})

describe('the agents card', () => {
  const agents = [{ id: 'a', status: 'completed' }, { id: 'b', status: 'running' }, { id: 'c', status: 'failed' }, { id: 'd', status: 'queued' }] as const

  it('says how many agents there are and how many still work', () => {
    expect(agentsHeading(agents)).toBe('4 agents · 2 working')
    expect(agentsHeading([agents[1]])).toBe('1 agent working')
    expect(agentsHeading([agents[0], agents[2]])).toBe('2 agents done')
  })

  it('shows the agents that work first, up to the limit', () => {
    expect(shownAgents(agents, 3).map(agent => agent.id)).toEqual(['b', 'd', 'a'])
    expect(shownAgents(agents, 10).map(agent => agent.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('the tree, the failed starts and the saved runs of helpers', () => {
  const { helperFromSaved, helpersInTree, NO_WORK, runLabel, savedHelper, withFailedStarts } = jest.requireActual('../work') as typeof import('../work')
  type Helper = import('../work').Helper

  const helper = (id: string, parentId: string | null, depth: number, goal = id): Helper => ({
    id,
    goal,
    status: 'completed',
    parentId,
    depth,
    model: '',
    toolCount: 2,
    activity: '',
    summary: 'done',
    startedAt: 1000,
    durationS: 4,
    acceptsSteer: false
  })

  it('puts each helper before the helpers it started', () => {
    const list = [helper('a', null, 0), helper('b', null, 0), helper('a1', 'a', 1), helper('b1', 'b', 1), helper('a1x', 'a1', 2)]

    expect(helpersInTree(list).map(item => item.id)).toEqual(['a', 'a1', 'a1x', 'b', 'b1'])
  })

  it('keeps a helper whose parent is not in the list', () => {
    expect(helpersInTree([helper('c', 'gone', 1)]).map(item => item.id)).toEqual(['c'])
  })

  it('lists the helpers that could not start', () => {
    const work = withFailedStarts(NO_WORK, [{ delegation_id: 'd1', task_index: 2, status: 'failed', goal: ' Check the date ', error: 'no model' }])

    expect(work.failed).toEqual([{ id: 'd1:2', goal: 'Check the date', reason: 'no model' }])
    expect(withFailedStarts(work, [{ delegation_id: 'd1', task_index: 2, status: 'failed' }])).toBe(work)
  })

  it('reads back a helper it saved', () => {
    const before = helper('a', null, 0, 'Count the files')

    expect(helperFromSaved(savedHelper(before, 0), 0)).toEqual(before)
  })

  it('reads a run saved by another client', () => {
    expect(helperFromSaved({ goal: 'Look it up', status: 'running', depth: 1, parentId: 'p' }, 3)).toMatchObject({
      id: 'saved-3',
      goal: 'Look it up',
      status: 'completed',
      parentId: 'p',
      depth: 1,
      acceptsSteer: false
    })
  })

  it('names a run by its first helpers', () => {
    expect(runLabel([helper('a', null, 0, 'First'), helper('a1', 'a', 1, 'Inner'), helper('b', null, 0, 'Second'), helper('c', null, 0, 'Third')])).toBe('First · Second')
  })
})
