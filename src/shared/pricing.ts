import type { Limiter } from './types'

interface Rates {
  input: number
  output: number
  cacheRead: number
  cacheWrite?: number
}

interface PriceEntry extends Rates {
  // Published price changes that take effect on a date (YYYY-MM-DD).
  changes?: { on: string; rates: Rates }
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

export type Provider = 'anthropic' | 'openai' | 'google'

export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google' }

const CACHE_WRITE_MULTIPLIER = 1.25

// First-party rates in dollars per million tokens, checked November 1, 2026.
const RATES: Record<string, PriceEntry> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
  'gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'gpt-6.1-sol': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'gpt-6.1-terra': { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
  'gpt-6-luna': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'gemini-4-argon': {
    input: 2,
    output: 10,
    cacheRead: 0.1,
    changes: { on: '2026-12-01', rates: { input: 4, output: 20, cacheRead: 0.2 } }
  },
  'gemini-3.8-flash': {
    input: 0.75,
    output: 3.75,
    cacheRead: 0.075,
    changes: { on: '2027-01-01', rates: { input: 1.5, output: 7.5, cacheRead: 0.15 } }
  },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cacheRead: 0.03 }
}

// A fallback can serve a model that is missing above, so assume the highest rate listed there.
const UNKNOWN_MODEL_RATES: Rates = { input: 10, output: 50, cacheRead: 1 }

const HAIKU_LONG_PROMPT_TOKENS = 100_000
const HAIKU_LONG_PROMPT_RATES: Rates = { input: 0.5, output: 2.5, cacheRead: 0.05 }

const OPENAI_LONG_PROMPT_TOKENS = 272_000
const OPENAI_LONG_INPUT_MULTIPLIER = 2
const OPENAI_LONG_OUTPUT_MULTIPLIER = 1.5

export const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

export const RUNNABLE_MODELS = [
  ...CLAUDE_MODELS,
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-luna',
  'gemini-4-argon',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite'
]

export function providerOf(model: string): Provider {
  if (model.startsWith('gpt-')) return 'openai'
  if (model.startsWith('gemini-')) return 'google'
  return 'anthropic'
}

function ratesFor(model: string, inputTokens: number, today: string): Rates {
  if (model === 'claude-haiku-5-5' && inputTokens > HAIKU_LONG_PROMPT_TOKENS) return HAIKU_LONG_PROMPT_RATES

  const entry = RATES[model]
  if (!entry) return UNKNOWN_MODEL_RATES
  const rates = entry.changes && today >= entry.changes.on ? entry.changes.rates : entry

  if (providerOf(model) === 'openai' && inputTokens > OPENAI_LONG_PROMPT_TOKENS) {
    return {
      ...rates,
      input: rates.input * OPENAI_LONG_INPUT_MULTIPLIER,
      output: rates.output * OPENAI_LONG_OUTPUT_MULTIPLIER
    }
  }
  return rates
}

const dateToday = () => new Date().toISOString().slice(0, 10)

export const usageTokens = (usage: TokenUsage) =>
  usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

export function usageCost(model: string, usage: TokenUsage, today = dateToday()) {
  const cacheRead = usage.cacheReadTokens ?? 0
  const cacheWrite = usage.cacheWriteTokens ?? 0
  const rates = ratesFor(model, usage.inputTokens + cacheRead + cacheWrite, today)
  const dollars =
    usage.inputTokens * rates.input +
    usage.outputTokens * rates.output +
    cacheRead * rates.cacheRead +
    cacheWrite * (rates.cacheWrite ?? rates.input * CACHE_WRITE_MULTIPLIER)
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
  return Math.floor((remaining * 1_000_000) / ratesFor(model, inputTokens, dateToday()).output)
}

// The most an agent could spend, assuming every token it may use is billed as output.
export function spendCeiling(limiter: Limiter, model: string) {
  return limiter.mode === 'dollars' ? limiter.dollars : usageCost(model, { inputTokens: 0, outputTokens: limiter.tokens })
}
