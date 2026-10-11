import { isScreenTool, screenProblem, screenWork, stopMessage, tapPoint } from '../screen'

describe('screen tools', () => {
  it('knows the tools that use the screen or a browser', () => {
    expect(['computer_use', 'browser_navigate', 'mcp__chrome__act'].every(isScreenTool)).toBe(true)
    expect(['terminal', 'computer_user', 'open_preview', 'mcp__telegram__send'].some(isScreenTool)).toBe(false)
  })

  it('says if a conversation used the screen and if it does now', () => {
    const done = { kind: 'tool', name: 'computer_use', state: 'done' }

    expect(screenWork([{ kind: 'assistant' }, { kind: 'tool', name: 'terminal', state: 'running' }])).toEqual({ used: false, running: false })
    expect(screenWork([done])).toEqual({ used: true, running: false })
    expect(screenWork([done, { kind: 'tool', name: 'mcp__chrome__act', state: 'running' }])).toEqual({ used: true, running: true })
  })
})

describe('tapPoint', () => {
  const frame = { width: 1456, height: 850 }

  it('scales a touch on the picture to the window on the host', () => {
    // The picture is 364 wide, so 212.5 high, with a band of 143.75 above it.
    const box = { width: 364, height: 500 }

    expect(tapPoint(box, frame, { x: 182, y: 250 })).toEqual({ x: 728, y: 425 })
    expect(tapPoint(box, frame, { x: 0, y: 143.75 })).toEqual({ x: 0, y: 0 })
  })

  it('refuses a touch on the band outside the picture', () => {
    expect(tapPoint({ width: 364, height: 500 }, frame, { x: 100, y: 20 })).toBeNull()
    expect(tapPoint({ width: 0, height: 0 }, frame, { x: 0, y: 0 })).toBeNull()
  })
})

describe('words', () => {
  it('tells the agent that the user stopped it, and why', () => {
    expect(stopMessage(' wrong window ')).toContain('Reason: wrong window')
    expect(stopMessage('')).not.toContain('Reason')
    expect(stopMessage('')).toContain('took control of the screen')
  })

  it('names the missing plugin and passes other answers of the host on', () => {
    expect(screenProblem(new Error('404: {"detail":"No such API endpoint"}'))).toContain('screen-remote plugin')
    expect(screenProblem(new Error('409: {"detail":"Take control first."}'))).toBe('Take control first.')
  })
})
