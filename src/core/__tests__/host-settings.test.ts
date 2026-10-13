import { endpointProblem, endpointRows, helperLine, helperTasks, memoryChoices, memoryName, taskName } from '../host-settings'

describe('helper models', () => {
  it('names a job for a person', () => {
    expect(taskName('vision').name).toBe('Reading pictures')
    expect(taskName('new_thing')).toEqual({ name: 'New thing', what: '' })
  })

  it('reads the jobs and says what each runs on', () => {
    const tasks = helperTasks({ tasks: [{ task: 'vision', provider: 'auto', model: '' }, { task: 'title', provider: 'openrouter', model: 'small-1' }, { provider: 'x' }] })

    expect(tasks).toHaveLength(2)
    expect(helperLine(tasks[0], model => model)).toBe('Automatic: the host chooses')
    expect(helperLine(tasks[1], model => model.toUpperCase())).toBe('SMALL-1')
  })
})

describe('endpoints of the user', () => {
  it('reads the list and marks the one Hermes runs on', () => {
    expect(endpointRows({ endpoints: [{ id: 'e1', name: 'Home', base_url: 'http://h.example/v1/', model: 'm' }, { id: 'e2', base_url: 'http://o.example/v1' }, { name: 'no id' }], current: { base_url: 'http://h.example/v1' } })).toEqual([
      { id: 'e1', name: 'Home', baseUrl: 'http://h.example/v1/', model: 'm', active: true },
      { id: 'e2', name: 'http://o.example/v1', baseUrl: 'http://o.example/v1', model: '', active: false }
    ])
  })

  it('checks the form', () => {
    expect(endpointProblem({ name: '', baseUrl: 'http://h.example', model: 'm' })).toMatch(/name/)
    expect(endpointProblem({ name: 'Home', baseUrl: 'h.example', model: 'm' })).toMatch(/http/)
    expect(endpointProblem({ name: 'Home', baseUrl: 'http://h.example/v1', model: '' })).toMatch(/model/)
    expect(endpointProblem({ name: 'Home', baseUrl: 'http://h.example/v1', model: 'm' })).toBeNull()
  })
})

describe('memory', () => {
  it('reads the kinds of memory', () => {
    expect(memoryChoices({ active: 'facts', providers: [{ name: 'facts', description: 'Facts — a local store', available: true }, { name: 'tree', description: 'no dash', available: false }] })).toEqual([
      { name: 'facts', description: 'a local store', available: true, active: true },
      { name: 'tree', description: 'no dash', available: false, active: false }
    ])
    expect(memoryName('facts')).toBe('Facts')
    expect(memoryName('')).toBe('Built-in memory')
  })
})
