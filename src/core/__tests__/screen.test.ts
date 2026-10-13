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

describe('zoom and drag of the screen picture', () => {
  const { clampPan, clampZoom, dragPoints, MAX_ZOOM } = jest.requireActual('../screen') as typeof import('../screen')
  const box = { width: 400, height: 800 }
  const frame = { width: 800, height: 600 }

  it('keeps the zoom between the whole picture and the limit', () => {
    expect(clampZoom(0.4)).toBe(1)
    expect(clampZoom(2.5)).toBe(2.5)
    expect(clampZoom(40)).toBe(MAX_ZOOM)
  })

  it('does not let an edge of the picture come inside the box', () => {
    expect(clampPan(500, 400, 2)).toBe(200)
    expect(clampPan(-500, 400, 2)).toBe(-200)
    expect(clampPan(50, 400, 1)).toBe(0)
  })

  it('turns a move of the finger into a drag in the window', () => {
    // The picture is 400 by 300, in the middle of the box: 250 points of band above it.
    expect(dragPoints(box, frame, { x: 0, y: 250 }, { x: 200, y: 400 })).toEqual({ x: 0, y: 0, to_x: 400, to_y: 300 })
  })

  it('refuses a drag that starts or ends on a band', () => {
    expect(dragPoints(box, frame, { x: 10, y: 10 }, { x: 200, y: 400 })).toBeNull()
    expect(dragPoints(box, frame, { x: 10, y: 300 }, { x: 200, y: 790 })).toBeNull()
  })
})

describe('screenProblem for a 404', () => {
  const { screenProblem } = jest.requireActual('../screen') as typeof import('../screen')

  it('says the plugin is missing when the route is not there', () => {
    expect(screenProblem(new Error('404: {"detail":"Not Found"}'))).toMatch(/no screen-remote plugin/)
  })

  it('gives the words of the plugin for its own 404', () => {
    expect(screenProblem(new Error('404: {"detail":"The host gave an empty picture of the whole screen."}'))).toBe('The host gave an empty picture of the whole screen.')
  })
})
