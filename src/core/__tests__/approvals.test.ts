import { approvalModeLabel, approvalModeOf } from '../approvals'

describe('the approval mode of a bot', () => {
  it('reads the mode, and takes an unknown value as the safe one', () => {
    expect(approvalModeOf({ value: 'Smart' })).toBe('smart')
    expect(approvalModeOf({ value: 'off' })).toBe('off')
    expect(approvalModeOf({ value: 'yolo' })).toBe('manual')
    expect(approvalModeOf(null)).toBe('manual')
  })

  it('names each mode for a person', () => {
    expect(approvalModeLabel('manual')).toBe('Ask me')
    expect(approvalModeLabel('off')).toBe('Never ask')
  })
})
