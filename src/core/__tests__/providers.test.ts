import type { ModelOptionsResult } from '../gateway/gateway-contract.generated'
import { filterKeys, filterProviders, keyProblem, keyRows, providerLine, providerRows, tidySecret } from '../providers'

const OPTIONS: ModelOptionsResult = {
  provider: 'openrouter',
  model: 'vendor/big-1',
  providers: [
    { slug: 'zeta', name: 'Zeta', authenticated: false, key_env: 'ZETA_API_KEY', auth_type: 'api_key', models: [] },
    { slug: 'copilot', name: 'Copilot', authenticated: false, auth_type: 'oauth' },
    { slug: 'openrouter', name: 'OpenRouter', authenticated: true, key_env: 'OPENROUTER_API_KEY', models: ['vendor/big-1', 'vendor/small-1', 'gone'], featured_models: ['vendor/small-1'], unavailable_models: ['gone'] },
    { slug: 'alpha', name: 'Alpha', authenticated: true, key_env: 'ALPHA_KEY', models: ['a-1'] }
  ]
}

describe('providerRows', () => {
  const rows = providerRows(OPTIONS)

  it('puts the provider in use first, then the connected ones, then the rest', () => {
    expect(rows.map(row => row.slug)).toEqual(['openrouter', 'alpha', 'copilot', 'zeta'])
  })

  it('lists featured models first, each once, without the unavailable ones', () => {
    expect(rows[0].models).toEqual(['vendor/small-1', 'vendor/big-1'])
  })

  it('knows which provider takes a key from the phone', () => {
    expect(rows.find(row => row.slug === 'zeta')).toMatchObject({ takesKey: true, signInNote: '' })
    expect(rows.find(row => row.slug === 'copilot')?.takesKey).toBe(false)
  })

  it('says the state of each in one line', () => {
    expect(providerLine(rows[0], OPTIONS.model)).toBe('In use · big-1')
    expect(providerLine(rows[1], OPTIONS.model)).toBe('Connected · 1 model')
    expect(providerLine(rows[2], OPTIONS.model)).toBe('Sign in on the computer')
    expect(providerLine(rows[3], OPTIONS.model)).toBe('Needs an API key')
  })

  it('finds a provider by a part of its name', () => {
    expect(filterProviders(rows, 'rout').map(row => row.slug)).toEqual(['openrouter'])
  })
})

describe('keys', () => {
  const rows = keyRows({
    OPENAI_API_KEY: { is_set: false, description: 'OpenAI', category: 'provider', provider_label: 'OpenAI', url: 'https://x.test' },
    DEEPGRAM_API_KEY: { is_set: true, redacted_value: '«redacted:abc...xyz»', category: 'tool' },
    TELEGRAM_TOKEN: { is_set: true, channel_managed: true },
    DEBUG_FLAG: { is_set: false, advanced: true },
    MY_KEY: { is_set: true, custom: true, category: 'custom' }
  })

  it('shows set keys first and hides what belongs elsewhere', () => {
    expect(rows.map(row => row.name)).toEqual(['DEEPGRAM_API_KEY', 'MY_KEY', 'OPENAI_API_KEY'])
    expect(rows.map(row => row.group)).toEqual(['Tools', 'Your own', 'OpenAI'])
    expect(rows[0].preview).toBe('abc…xyz')
  })

  it('finds a key by words with a space', () => {
    expect(filterKeys(rows, 'openai api').map(row => row.name)).toEqual(['OPENAI_API_KEY'])
    expect(filterKeys(rows, 'tools').map(row => row.name)).toEqual(['DEEPGRAM_API_KEY'])
  })

  it('checks the name and the value of a new key', () => {
    expect(keyProblem('MY_SERVICE_KEY', 'v')).toBeNull()
    expect(keyProblem('my key', 'v')).toContain('capital letters')
    expect(keyProblem('MY_KEY', '  ')).toBe('Paste the value.')
  })

  it('takes the white space and the quotes off a pasted secret', () => {
    expect(tidySecret('  "sk-abc"\n')).toBe('sk-abc')
    expect(tidySecret("sk-a'b")).toBe("sk-a'b")
  })
})
