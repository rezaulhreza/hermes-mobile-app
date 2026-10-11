import { INBOX_ROUTE, isDeviceToken, isStoredSessionId, pushRoute, pushEnvironment, readPushPayload, registrationBody, registrationKey, showsBanner } from '../push'

const TOKEN = 'A1'.repeat(32)

describe('the device token', () => {
  it('is 64 hex characters', () => {
    expect(isDeviceToken(TOKEN)).toBe(true)
    expect(isDeviceToken(TOKEN.slice(2))).toBe(false)
    expect(isDeviceToken(`${TOKEN.slice(2)}zz`)).toBe(false)
    expect(isDeviceToken(undefined)).toBe(false)
  })

  it('goes to the backend in lower case with the environment of the build', () => {
    expect(registrationBody(TOKEN, pushEnvironment(true), ' iPhone ')).toEqual({
      token: TOKEN.toLowerCase(),
      environment: 'sandbox',
      platform: 'ios',
      profile: '',
      label: 'iPhone'
    })
    expect(pushEnvironment(false)).toBe('production')
  })

  it('registers again for another workspace', () => {
    expect(registrationKey('a', TOKEN)).toBe(registrationKey('a', TOKEN.toLowerCase()))
    expect(registrationKey('a', TOKEN)).not.toBe(registrationKey('b', TOKEN))
  })
})

describe('a notification', () => {
  it('names the conversation, the bot and the kind', () => {
    expect(readPushPayload({ aps: {}, session_id: ' abc ', profile: 'coder', kind: 'clarify' })).toEqual({ sessionId: 'abc', profile: 'coder', kind: 'clarify' })
    expect(readPushPayload(null)).toEqual({ sessionId: '', profile: '', kind: '' })
    expect(readPushPayload({ session_id: 7 }).sessionId).toBe('')
  })

  it('finds the keys in the place that has them', () => {
    expect(readPushPayload(null, { aps: {}, session_id: 'abc', profile: 'coder', kind: 'approval' })).toEqual({ sessionId: 'abc', profile: 'coder', kind: 'approval' })
    expect(readPushPayload({ other: 1 }, { session_id: 'abc' }).sessionId).toBe('abc')
  })

  it('opens the conversation in the profile of its bot', () => {
    expect(pushRoute('20261009_1', 'coder')).toBe('/chat/20261009_1?profile=coder')
    expect(pushRoute('20261009_1', 'default')).toBe('/chat/20261009_1')
    expect(pushRoute('20261009_1', '')).toBe('/chat/20261009_1')
  })

  it('opens the inbox when no conversation can be opened', () => {
    expect(pushRoute(null, 'coder')).toBe(INBOX_ROUTE)
  })

  it('tells a stored id from a live one', () => {
    expect(isStoredSessionId('20261009_153412_8a8ba6')).toBe(true)
    expect(isStoredSessionId('23546e09')).toBe(false)
  })

  it('shows no banner for the conversation on screen', () => {
    const payload = readPushPayload({ session_id: 'live1' })

    expect(showsBanner(payload, 'live1')).toBe(false)
    expect(showsBanner(payload, 'live2')).toBe(true)
    expect(showsBanner(payload, null)).toBe(true)
    expect(showsBanner(readPushPayload({}), 'live1')).toBe(true)
  })
})
