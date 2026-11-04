import { addCreditsWords, creditsWords, limitOf, resetWords } from '../limits'

describe('the limit of a plan', () => {
  it('reads the limit from the error surface of a failed turn', () => {
    const card = limitOf({
      layer: 'billing',
      code: 'usage_window',
      usage_limit: {
        gauge_id: 'day',
        scope: 'account',
        limit_name: 'today',
        resets_at_ms: 1_800_000_000_000,
        message: ' You used today’s allowance. ',
        suggestions: [{ model: 'hermes-4-70b', label: 'Hermes 4 70B', note: 'Free past the limit', provider: 'nous' }, { label: 'no model' }],
        credits: { action: 'use_credits' }
      }
    })

    expect(card).toEqual({
      message: 'You used today’s allowance.',
      name: 'today',
      resetsAt: 1_800_000_000_000,
      suggestions: [{ model: 'hermes-4-70b', provider: 'nous', label: 'Hermes 4 70B', note: 'Free past the limit' }],
      credits: 'use'
    })
  })

  it('reads nothing from another failure', () => {
    expect(limitOf({ layer: 'provider', code: 'rate_limit' })).toBeNull()
    expect(limitOf(null)).toBeNull()
    expect(limitOf({ usage_limit: { message: '' } })).toBeNull()
  })

  it('says when the allowance is back', () => {
    const now = new Date(2026, 10, 6, 10, 0)

    expect(resetWords(new Date(2026, 10, 6, 14, 0).getTime(), now)).toBe('Back at 2:00 pm.')
    expect(resetWords(new Date(2026, 10, 7, 9, 0).getTime(), now)).toBe('Back tomorrow at 9:00 am.')
    expect(resetWords(new Date(2026, 10, 9, 9, 0).getTime(), now)).toBe('Back on Mon at 9:00 am.')
    expect(resetWords(new Date(2026, 10, 6, 9, 0).getTime(), now)).toBe('It is back now.')
    expect(resetWords(null, now)).toBe('')
  })

  it('offers credits only where the phone can act', () => {
    expect(creditsWords('use')).toBe('Keep going on credits')
    expect(creditsWords('add')).toBeNull()
    expect(addCreditsWords('add_and_use')).toContain('add credits')
    expect(addCreditsWords('use')).toBeNull()
  })
})
