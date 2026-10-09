import { filterSections, modelLabel, modelSections, sessionModelValue } from '../models'

const options = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  providers: [
    { slug: 'openrouter', name: 'OpenRouter', authenticated: true, models: ['deepseek/deepseek-v4', 'openai/gpt-6'], unavailable_models: ['openai/gpt-6'] },
    { slug: 'anthropic', name: 'Anthropic', authenticated: true, models: ['claude-haiku-5-5', 'claude-sonnet-5-5'], featured_models: ['claude-sonnet-5-5'] },
    { slug: 'xai', name: 'xAI', authenticated: false, models: ['grok-5'] },
    { slug: 'empty', name: 'Empty', authenticated: true, models: [] }
  ]
}

describe('modelSections', () => {
  const sections = modelSections(options)

  it('lists signed-in providers that have a usable model, current provider first', () => {
    expect(sections.map(s => s.provider)).toEqual(['anthropic', 'openrouter'])
  })

  it('puts featured models first and lists each model once', () => {
    expect(sections[0].choices.map(c => c.model)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5'])
  })

  it('marks only the model in use and hides unavailable models', () => {
    expect(sections.flatMap(s => s.choices).filter(c => c.current).map(c => c.model)).toEqual(['claude-sonnet-5-5'])
    expect(sections[1].choices.map(c => c.label)).toEqual(['deepseek-v4'])
  })
})

it('filters by model or by provider name', () => {
  const sections = modelSections(options)

  expect(filterSections(sections, 'haiku').flatMap(s => s.choices.map(c => c.model))).toEqual(['claude-haiku-5-5'])
  expect(filterSections(sections, 'openrouter').map(s => s.provider)).toEqual(['openrouter'])
  expect(filterSections(sections, 'nothing')).toEqual([])
})

it('builds a switch that applies to this conversation only', () => {
  expect(sessionModelValue({ model: 'deepseek/deepseek-v4', provider: 'openrouter' })).toBe('deepseek/deepseek-v4 --provider openrouter --session')
  expect(modelLabel('deepseek/deepseek-v4')).toBe('deepseek-v4')
})
