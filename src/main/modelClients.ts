import { PROVIDER_LABEL, providerOf, type Provider } from '../shared/pricing'
import type { KeyResult } from '../shared/types'
import { createAnthropicClient, verifyAnthropicKey } from './anthropicClient'
import { createGeminiClient, verifyGeminiKey } from './geminiClient'
import { createOpenAIClient, verifyOpenAIKey } from './openaiClient'
import { FatalRunError, type ModelClient } from './runEngine'

export type ProviderKeys = Partial<Record<Provider, string>>

const missingKey = (provider: Provider) => new FatalRunError(`Add your ${PROVIDER_LABEL[provider]} API key in Settings.`)

export function createModelClient(keys: ProviderKeys): ModelClient {
  const anthropic = keys.anthropic ? createAnthropicClient(keys.anthropic) : null
  const openai = keys.openai ? createOpenAIClient(keys.openai) : null
  const google = keys.google ? createGeminiClient(keys.google) : null
  const clients = { anthropic, openai, google }

  return {
    chooseModel(request, signal) {
      if (!anthropic) throw missingKey('anthropic')
      return anthropic.chooseModel(request, signal)
    },
    startSession(config) {
      const provider = providerOf(config.model)
      if (!provider) throw new FatalRunError(`${config.model} is not a connected model.`)
      const client = clients[provider]
      if (!client) throw missingKey(provider)
      return client.startSession(config)
    }
  }
}

const VERIFY_KEY: Record<Provider, (key: string) => Promise<KeyResult>> = {
  anthropic: verifyAnthropicKey,
  openai: verifyOpenAIKey,
  google: verifyGeminiKey
}

export function verifyApiKey(provider: Provider, key: string): Promise<KeyResult> {
  return VERIFY_KEY[provider](key)
}
