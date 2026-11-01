export interface ModelOption {
  id: string
  name: string
  tier: string
  focus: string
}

export const MODELS: ModelOption[] = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', tier: 'Frontier', focus: 'Reasoning' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', tier: 'Frontier', focus: 'Coding' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', tier: 'Fast', focus: 'Lightweight' },
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', tier: 'Frontier', focus: 'Reasoning' },
  { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', tier: 'Frontier', focus: 'Balanced' },
  { id: 'gpt-6.1-terra', name: 'GPT-6.1 Terra', tier: 'Fast', focus: 'Balanced' },
  { id: 'gpt-6-luna', name: 'GPT-6 Luna', tier: 'Fast', focus: 'Lightweight' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', tier: 'Frontier', focus: 'Reasoning' },
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tier: 'Flash', focus: 'Balanced' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', tier: 'Flash', focus: 'Lightweight' },
  { id: 'deepseek-r1', name: 'DeepSeek R1', tier: 'Reasoning', focus: 'Open weights' }
]

// Sample models from the original design, kept so older saved agents still load.
export const RETIRED_MODELS: Record<string, string> = {
  'gpt-4o': 'gpt-6.1-sol',
  'gemini-2-0-flash': 'gemini-3.8-flash'
}

export const modelName = (id: string) => MODELS.find((model) => model.id === id)?.name ?? id
