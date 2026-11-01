import type { Limiter } from './types'

interface Rates {
  input: number
  output: number
  cacheRead: number
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

const CACHE_WRITE_MULTIPLIER = 1.25

// Anthropic first-party rates in dollars per million tokens, as of October 2026.
const RATES: Record<string, Rates> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 }
}

// A fallback can serve a model that is missing above, so assume the highest published rate.
const UNKNOWN_MODEL_RATES: Rates = { input: 10, output: 50, cacheRead: 1 }

const HAIKU_LONG_PROMPT_TOKENS = 100_000
const HAIKU_LONG_PROMPT_RATES: Rates = { input: 0.5, output: 2.5, cacheRead: 0.05 }

export const RUNNABLE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

function ratesFor(model: string, inputTokens: number) {
  if (model === 'claude-haiku-5-5' && inputTokens > HAIKU_LONG_PROMPT_TOKENS) return HAIKU_LONG_PROMPT_RATES
  return RATES[model] ?? UNKNOWN_MODEL_RATES
}

export const usageTokens = (usage: TokenUsage) =>
  usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

export function usageCost(model: string, usage: TokenUsage) {
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const rates = ratesFor(model, usage.inputTokens + cacheRead + cacheWrite)
  const dollars =
    usage.inputTokens * rates.input +
    usage.outputTokens * rates.output +
    cacheRead * rates.cacheRead +
    cacheWrite * rates.input * CACHE_WRITE_MULTIPLIER
  return dollars / 1_000_000
}

// The most output the next model call may produce once its input is paid for.
// Input is priced as uncached, so a cache hit can only leave more room.
export function outputAllowance(
  limiter: Limiter,
  model: string,
  inputTokens: number,
  spent: { tokens: number; cost: number } = { tokens: 0, cost: 0 }
) {
  if (limiter.mode === 'tokens') return limiter.tokens - spent.tokens - inputTokens
  const remaining = limiter.dollars - spent.cost - usageCost(model, { inputTokens, outputTokens: 0 })
  return Math.floor((remaining * 1_000_000) / ratesFor(model, inputTokens).output)
}

// The most an agent could spend, assuming every token it may use is billed as output.
export function spendCeiling(limiter: Limiter, model: string) {
  return limiter.mode === 'dollars' ? limiter.dollars : usageCost(model, { inputTokens: 0, outputTokens: limiter.tokens })
}
