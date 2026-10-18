import { AVATAR_COLOURS, AVATAR_SHAPES, defaultLook, isDarkColour, lookMeta, lookOf, paint } from '../avatars'

describe('the drawn avatar of a bot', () => {
  it('has a look from the name when nobody chose one', () => {
    expect(defaultLook('qa')).toEqual(defaultLook('qa'))
    expect(AVATAR_SHAPES).toContain(defaultLook('qa').shape)
    expect(defaultLook('qa').color).toMatch(/^hsl\(\d+ 68% 58%\)$/)
    expect(defaultLook('qa')).not.toEqual(defaultLook('writer'))
    // The main bot, and a bot with no name yet.
    expect(defaultLook('default')).toEqual({ shape: 'squircle', color: '#8b5cf6' })
    expect(defaultLook(' ')).toEqual({ shape: 'squircle', color: '#8b5cf6' })
  })

  it('reads the look the record holds', () => {
    expect(lookOf('qa', { shape: 'cloud', color: 'hsl(120 68% 58%)' })).toEqual({ shape: 'cloud', color: 'hsl(120 68% 58%)' })
    expect(lookOf('qa', { shape: 'drop' })).toEqual({ shape: 'drop', color: defaultLook('qa').color })
    expect(lookOf('qa', {})).toEqual(defaultLook('qa'))
    // The main bot keeps its own look until the user gave it another.
    expect(lookOf('default', { shape: 'cloud', color: '#000000' })).toEqual({ shape: 'squircle', color: '#8b5cf6' })
    expect(lookOf('default', { shape: 'cloud', color: '#112233', custom: true })).toEqual({ shape: 'cloud', color: '#112233' })
  })

  it('has no look for a shape the phone cannot draw', () => {
    expect(lookOf('qa', { shape: 'blobatar:k3:moss' })).toBeNull()
    expect(lookOf('qa', { shape: 'sigil-4' })).toBeNull()
  })

  it('writes what the desktop app reads', () => {
    expect(lookMeta({ shape: 'hexagon', color: AVATAR_COLOURS[7] })).toEqual({ shape: 'hexagon', color: 'hsl(210 68% 58%)', custom: true })
    expect(AVATAR_COLOURS).toHaveLength(12)
  })

  it('makes a colour the phone can draw, and knows a dark one', () => {
    expect(paint('hsl(210 68% 58%)')).toBe('hsl(210, 68%, 58%)')
    expect(paint('hsl(210, 68%, 58%)')).toBe('hsl(210, 68%, 58%)')
    expect(paint(' #8b5cf6 ')).toBe('#8b5cf6')
    expect(isDarkColour('#111111')).toBe(true)
    expect(isDarkColour('#8b5cf6')).toBe(false)
    expect(isDarkColour('hsl(0 68% 20%)')).toBe(true)
    expect(isDarkColour('hsl(0 68% 58%)')).toBe(false)
    expect(isDarkColour('red')).toBe(false)
  })
})
