import { clampPan, clampZoom, fitScale, followPan, isScreenTool, movePointer, picturePoint, pointerGain, SCROLL_STEP, screenProblem, screenWork, scrollSteps, stopMessage, tapPoint } from '../screen'

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

describe('the zoom of the picture', () => {
  // The pinch and the two-finger move call these on the UI thread. A function that is not a worklet throws
  // there, and the throw closes the app.
  it.each([
    ['clampZoom', clampZoom],
    ['clampPan', clampPan],
    ['fitScale', fitScale],
    ['picturePoint', picturePoint],
    ['pointerGain', pointerGain],
    ['movePointer', movePointer],
    ['followPan', followPan],
    ['scrollSteps', scrollSteps]
  ])('%s is a worklet', (_name, fn) => {
    expect((fn as unknown as { __workletHash?: number }).__workletHash).toBeDefined()
  })
})

describe('trackpad mode', () => {
  const frame = { width: 1456, height: 850 }
  const box = { width: 364, height: 500 }

  it('puts a window position back on the picture', () => {
    expect(fitScale(box, frame)).toBe(0.25)
    expect(picturePoint(box, frame, { x: 728, y: 425 })).toEqual({ x: 182, y: 250 })
    expect(tapPoint(box, frame, picturePoint(box, frame, { x: 400, y: 100 }))).toEqual({ x: 400, y: 100 })
    expect(fitScale({ width: 0, height: 0 }, frame)).toBe(0)
  })

  it('moves the pointer exactly for a slow finger and further for a fast one', () => {
    expect(pointerGain(0)).toBe(1)
    expect(pointerGain(10)).toBeCloseTo(1.8)
    expect(pointerGain(100)).toBe(3)
    // One point on a picture at a quarter of the window is four pixels in the window.
    expect(movePointer({ x: 100, y: 100 }, 1, 0, frame, 0.25).x).toBeCloseTo(104.32)
  })

  it('keeps the pointer in the window', () => {
    expect(movePointer({ x: 10, y: 10 }, -50, -50, frame, 0.25)).toEqual({ x: 0, y: 0 })
    expect(movePointer({ x: 1450, y: 845 }, 50, 50, frame, 0.25)).toEqual({ x: 1455, y: 849 })
    expect(movePointer({ x: 5, y: 5 }, 10, 10, frame, 0)).toEqual({ x: 5, y: 5 })
  })

  it('moves the enlarged picture only when the pointer comes near an edge', () => {
    // At zoom 2 a point at 300 of a 400 box shows at 400: on the edge.
    expect(followPan(0, 300, 400, 2, 40)).toBe(-40)
    expect(followPan(0, 200, 400, 2, 40)).toBe(0)
    expect(followPan(0, 50, 400, 2, 40)).toBe(140)
    expect(followPan(0, 400, 400, 2, 40)).toBe(-200)
  })

  it('scrolls like a Mac trackpad, in whole steps', () => {
    expect(scrollSteps(SCROLL_STEP - 1)).toBeNull()
    expect(scrollSteps(-SCROLL_STEP * 2 - 5)).toEqual({ direction: 'down', amount: 2, rest: -5 })
    expect(scrollSteps(SCROLL_STEP + 3)).toEqual({ direction: 'up', amount: 1, rest: 3 })
  })
})
