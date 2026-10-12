import { CACHE_VERSION, cacheFolderName, packCache, slimSessionRow, unpackCache } from '../cache'

describe('the stored copy of a list', () => {
  it('reads back what was stored', () => {
    expect(unpackCache(packCache([{ id: 'a' }]))).toEqual([{ id: 'a' }])
  })

  it('reads nothing from a missing, broken or older copy', () => {
    expect(unpackCache(null)).toBeNull()
    expect(unpackCache('{"v":')).toBeNull()
    expect(unpackCache(JSON.stringify({ v: CACHE_VERSION - 1, value: [1] }))).toBeNull()
    expect(unpackCache('[1,2]')).toBeNull()
  })

  it('makes a safe folder name from a workspace id', () => {
    expect(cacheFolderName('ws_abc-1')).toBe('ws_abc-1')
    expect(cacheFolderName('../x y')).toBe('___x_y')
  })
})

describe('slimSessionRow', () => {
  it('keeps what the list reads and drops the rest', () => {
    const row = { id: 's1', title: 'T', preview: 'p', source: 'desktop', last_active: 5, pinned: true, profile: 'bot', is_default_profile: false, input_tokens: 9, model_config: '{}' }

    expect(slimSessionRow(row)).toEqual({
      id: 's1',
      title: 'T',
      preview: 'p',
      source: 'desktop',
      started_at: undefined,
      last_active: 5,
      pinned: true,
      archived: undefined,
      unread: undefined,
      profile: 'bot',
      is_default_profile: false
    })
  })
})
