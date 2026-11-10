import { routeProvider } from '../shared/models'
import { PROVIDER_LABEL, type Provider } from '../shared/pricing'
import type { KeyResult } from '../shared/types'
import { createAnthropicClient, verifyAnthropicKey } from './anthropicClient'
import { createGeminiClient, verifyGeminiKey } from './geminiClient'
import { createOpenAIClient, verifyOpenAIKey } from './openaiClient'
import { createOpenRouterClient, openRouterModelIds, verifyOpenRouterKey } from './openrouterClient'
import { FatalRunError, type ModelClient, type ModelSession, type ModelSessionConfig } from './runEngine'

export type ProviderKeys = Partial<Record<Provider, string>>

const missingKey = (provider: Provider) => new FatalRunError(`Add your ${PROVIDER_LABEL[provider]} API key in Settings.`)

export function createModelClient(keys: ProviderKeys): ModelClient {
  const anthropic = keys.anthropic ? createAnthropicClient(keys.anthropic) : null
  const clients: Record<Provider, { startSession(config: ModelSessionConfig): ModelSession } | null> = {
    anthropic,
    openai: keys.openai ? createOpenAIClient(keys.openai) : null,
    google: keys.google ? createGeminiClient(keys.google) : null,
    openrouter: keys.openrouter ? createOpenRouterClient(keys.openrouter) : null
  }

  return {
    chooseModel(request, signal) {
      if (!anthropic) throw missingKey('anthropic')
      return anthropic.chooseModel(request, signal)
    },
    startSession(config) {
      const provider = routeProvider(config.model, openRouterModelIds())
      if (!provider) throw new Error(`${config.model} is not a connected model. OpenRouter may no longer list it.`)
      const client = clients[provider]
      if (!client) throw missingKey(provider)
      return client.startSession(config)
    }
  }
}

const VERIFY_KEY: Record<Provider, (key: string) => Promise<KeyResult>> = {
  anthropic: verifyAnthropicKey,
  openai: verifyOpenAIKey,
  google: verifyGeminiKey,
  openrouter: verifyOpenRouterKey
}

export function verifyApiKey(provider: Provider, key: string): Promise<KeyResult> {
  return VERIFY_KEY[provider](key)
}
