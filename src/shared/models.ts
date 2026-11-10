import type { Provider } from './pricing'

export interface ModelOption {
  id: string
  name: string
  tier: string
  focus: string
  provider: Provider | null
  runnable: boolean
  routable: boolean
}

// The picker, the runnable list, Auto routing, and providerOf all read this array.
export const MODEL_CATALOG: ModelOption[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', tier: 'Frontier', focus: 'Reasoning', provider: 'anthropic', runnable: true, routable: true },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', tier: 'Frontier', focus: 'Coding', provider: 'anthropic', runnable: true, routable: true },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', tier: 'Fast', focus: 'Lightweight', provider: 'anthropic', runnable: true, routable: true },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', tier: 'Frontier', focus: 'Reasoning', provider: 'openai', runnable: true, routable: false },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', tier: 'Frontier', focus: 'Balanced', provider: 'openai', runnable: true, routable: false },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', tier: 'Fast', focus: 'Balanced', provider: 'openai', runnable: true, routable: false },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', tier: 'Fast', focus: 'Lightweight', provider: 'openai', runnable: true, routable: false },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', tier: 'Frontier', focus: 'Reasoning', provider: 'google', runnable: true, routable: false },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tier: 'Flash', focus: 'Balanced', provider: 'google', runnable: true, routable: false },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', tier: 'Flash', focus: 'Lightweight', provider: 'google', runnable: true, routable: false },
  { id: 'deepseek-r1', name: 'DeepSeek R1', tier: 'Reasoning', focus: 'Open weights', provider: null, runnable: false, routable: false }
]

const MODEL_BY_ID = new Map(MODEL_CATALOG.map((model) => [model.id, model]))

export const NO_IDS: ReadonlySet<string> = new Set()

export const modelName = (id: string, listed: readonly { id: string; name: string }[] = []) =>
  MODEL_BY_ID.get(id)?.name ?? listed.find((model) => model.id === id)?.name ?? id

export const providerOfModel = (id: string): Provider | null => MODEL_BY_ID.get(id)?.provider ?? null

// Catalog ids never fall through to OpenRouter, even when their own key is missing.
export function routeProvider(modelId: string, openRouterIds: ReadonlySet<string>): Provider | null {
  const model = MODEL_BY_ID.get(modelId)
  if (model) return model.provider
  return openRouterIds.has(modelId) ? 'openrouter' : null
}
