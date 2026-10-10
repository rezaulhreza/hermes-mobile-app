import { activeTrigger, applyCompletion, isSlashCommand, slashOutcome, splitSlash } from '../composer'

describe('activeTrigger', () => {
  it('completes a slash command only while its name is being typed', () => {
    expect(activeTrigger('/mod')).toEqual({ kind: 'slash', word: '/mod', start: 0 })
    expect(activeTrigger('/model sonnet')).toBeNull()
    expect(activeTrigger('see /mod')).toBeNull()
  })

  it('completes a file reference at the end of the draft', () => {
    expect(activeTrigger('look at @src/ap')).toEqual({ kind: 'path', word: '@src/ap', start: 8 })
    expect(activeTrigger('@')).toEqual({ kind: 'path', word: '@', start: 0 })
  })

  it('does not read an email address or a finished word as a reference', () => {
    expect(activeTrigger('mail me@example.com')).toBeNull()
    expect(activeTrigger('look at @src/app.ts now')).toBeNull()
  })
})

describe('applyCompletion', () => {
  it('replaces the trigger word and leaves a space after a finished item', () => {
    expect(applyCompletion('/mod', { kind: 'slash', word: '/mod', start: 0 }, '/model')).toBe('/model ')
    expect(applyCompletion('look at @src/ap', { kind: 'path', word: '@src/ap', start: 8 }, '@src/app.ts')).toBe('look at @src/app.ts ')
  })

  it('keeps the caret inside a folder so the next level completes', () => {
    expect(applyCompletion('@sr', { kind: 'path', word: '@sr', start: 0 }, '@src/')).toBe('@src/')
  })

  it('uses the position the backend names, and ignores one outside the draft', () => {
    const trigger = { kind: 'slash' as const, word: '/skill:de', start: 0 }

    expect(applyCompletion('/skill:de', trigger, 'deploy', 7)).toBe('/skill:deploy ')
    expect(applyCompletion('/skill:de', trigger, '/skill:deploy', 99)).toBe('/skill:deploy ')
  })
})

it('recognises a slash command but not a path or a lone slash', () => {
  expect(isSlashCommand('/help')).toBe(true)
  expect(isSlashCommand('/')).toBe(false)
  expect(isSlashCommand('/2 is a fraction')).toBe(false)
  expect(splitSlash('/model  sonnet --session ')).toEqual({ name: 'model', arg: 'sonnet --session' })
  expect(splitSlash('/help')).toEqual({ name: 'help', arg: '' })
})

describe('slashOutcome', () => {
  it('sends a skill or an expanding command to the agent', () => {
    expect(slashOutcome({ type: 'skill', message: 'Run the deploy skill', notice: 'Loaded deploy' })).toEqual({ kind: 'submit', text: 'Run the deploy skill', notice: 'Loaded deploy' })
  })

  it('does not send an empty message', () => {
    expect(slashOutcome({ type: 'send', message: '  ' })).toMatchObject({ kind: 'output' })
  })

  it('prefills the composer', () => {
    expect(slashOutcome({ type: 'prefill', message: 'Review ' })).toEqual({ kind: 'prefill', text: 'Review', notice: '' })
  })

  it('follows an alias and keeps the argument', () => {
    expect(slashOutcome({ type: 'alias', target: '/reasoning' }, 'high')).toEqual({ kind: 'alias', command: '/reasoning high' })
  })

  it('shows the output of a command that ran, with its warning first', () => {
    expect(slashOutcome({ output: 'Model: sonnet', warning: 'Deprecated' })).toEqual({ kind: 'output', text: 'Deprecated\n\nModel: sonnet' })
    expect(slashOutcome({ type: 'exec', output: '' })).toEqual({ kind: 'output', text: 'Done.' })
    expect(slashOutcome(null)).toEqual({ kind: 'output', text: 'Done.' })
  })
})
