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
  { id: 'gpt-4o', name: 'GPT-4o', tier: 'Omni', focus: 'Synthesis' },
  { id: 'gemini-2-0-flash', name: 'Gemini 2.0 Flash', tier: 'Flash', focus: 'Low latency' },
  { id: 'deepseek-r1', name: 'DeepSeek R1', tier: 'Reasoning', focus: 'Open weights' }
]

export const modelName = (id: string) => MODELS.find((model) => model.id === id)?.name ?? id
