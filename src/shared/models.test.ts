import { describe, expect, it } from 'vitest'
import { routeProvider } from './models'

describe('routeProvider', () => {
  it('keeps catalog models on their own provider even when OpenRouter lists the id', () => {
    expect(routeProvider('claude-sonnet-5-5', new Set(['claude-sonnet-5-5']))).toBe('anthropic')
  })

  it('sends a model to OpenRouter only when OpenRouter lists it', () => {
    expect(routeProvider('openai/gpt-4o', new Set(['openai/gpt-4o']))).toBe('openrouter')
    expect(routeProvider('openai/gpt-4o', new Set())).toBeNull()
  })

  it('leaves an unconnected catalog model unconnected', () => {
    expect(routeProvider('deepseek-r1', new Set(['deepseek-r1']))).toBeNull()
  })
})
