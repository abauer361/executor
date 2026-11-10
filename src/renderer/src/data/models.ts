export { MODEL_CATALOG as MODELS, modelName, type ModelOption } from '../../../shared/models'

// Sample models from the original design, kept so older saved agents still load.
export const RETIRED_MODELS: Record<string, string> = {
  'gpt-4o': 'gpt-6.1-sol',
  'gemini-2-0-flash': 'gemini-3.8-flash'
}
