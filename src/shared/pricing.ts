import type { Limiter } from './types'

interface Rates {
  input: number
  output: number
}

// Anthropic first-party rates in dollars per million tokens, as of October 2026.
const RATES: Record<string, Rates> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 }
}

// A fallback can serve a model that is missing above, so assume the highest published rate.
const UNKNOWN_MODEL_RATES: Rates = { input: 10, output: 50 }

const HAIKU_LONG_PROMPT_TOKENS = 100_000
const HAIKU_LONG_PROMPT_RATES: Rates = { input: 0.5, output: 2.5 }

export const RUNNABLE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

function ratesFor(model: string, inputTokens: number) {
  if (model === 'claude-haiku-5-5' && inputTokens > HAIKU_LONG_PROMPT_TOKENS) return HAIKU_LONG_PROMPT_RATES
  return RATES[model] ?? UNKNOWN_MODEL_RATES
}

export function usageCost(model: string, inputTokens: number, outputTokens: number) {
  const rates = ratesFor(model, inputTokens)
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000
}

// The most output an agent may produce once its input is paid for.
export function outputAllowance(limiter: Limiter, model: string, inputTokens: number) {
  if (limiter.mode === 'tokens') return limiter.tokens - inputTokens
  const remaining = limiter.dollars - usageCost(model, inputTokens, 0)
  return Math.floor((remaining * 1_000_000) / ratesFor(model, inputTokens).output)
}

// The most an agent could spend, assuming every token it may use is billed as output.
export function spendCeiling(limiter: Limiter, model: string) {
  return limiter.mode === 'dollars' ? limiter.dollars : usageCost(model, 0, limiter.tokens)
}
