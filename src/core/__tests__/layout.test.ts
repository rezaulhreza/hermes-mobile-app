import { isWide, listPaneWidth } from '../layout'

describe('the split of a wide screen', () => {
  it('splits at the width of a tablet', () => {
    expect(isWide(767)).toBe(false)
    expect(isWide(768)).toBe(true)
  })

  it('gives the list about a third, inside its limits', () => {
    expect(listPaneWidth(768)).toBe(320)
    expect(listPaneWidth(1024)).toBe(369)
    expect(listPaneWidth(1366)).toBe(420)
  })
})
