import Anthropic from '@anthropic-ai/sdk'
import type { BetaIterationsUsage, BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { KeyResult } from '../shared/types'
import { FatalRunError, type ModelClient, type ModelPrompt, type ModelUsage } from './runEngine'

// Claude Haiku has no server-side fallback.
const MODELS_WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

// Pinned because the SDK otherwise follows ANTHROPIC_BASE_URL, which could send the saved key elsewhere.
const API_URL = process.env.EXECUTOR_API_URL ?? 'https://api.anthropic.com'

const connect = (apiKey: string) => new Anthropic({ apiKey, baseURL: API_URL })

function apiMessage(error: InstanceType<typeof Anthropic.APIError>) {
  const body = error.error as { error?: { message?: string } } | undefined
  return body?.error?.message ?? error.message
}

function explain(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error
  if (error instanceof Anthropic.AuthenticationError) {
    return new FatalRunError('Anthropic rejected your API key. Check it in Settings.')
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new FatalRunError(`Your API key does not have access: ${apiMessage(error)}`)
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new Error('Anthropic rate limit reached. Try again shortly or lower how many agents run at once.')
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new Error('Could not reach Anthropic. Check your internet connection.')
  }
  if (error instanceof Anthropic.APIError) return new Error(apiMessage(error))
  return error
}

// A refused attempt and its fallback are billed separately, so iterations are the source of truth.
function billedUsage(message: BetaMessage, requestedModel: string): ModelUsage[] {
  const attempts = (message.usage.iterations ?? []) as BetaIterationsUsage
  const billed = attempts.filter((entry) => entry.type === 'message' || entry.type === 'fallback_message')
  if (billed.length === 0) {
    return [
      {
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens
      }
    ]
  }
  return billed.map((entry) => ({
    model: ('model' in entry && entry.model) || requestedModel,
    inputTokens: entry.input_tokens,
    outputTokens: entry.output_tokens
  }))
}

export function createModelClient(apiKey: string): ModelClient {
  const client = connect(apiKey)
  const toMessages = (prompt: ModelPrompt) => [{ role: 'user' as const, content: prompt.userMessage }]

  return {
    async countInputTokens(prompt, signal) {
      try {
        const count = await client.messages.countTokens(
          { model: prompt.model, system: prompt.system, messages: toMessages(prompt) },
          { signal }
        )
        return count.input_tokens
      } catch (error) {
        throw explain(error)
      }
    },

    async stream(prompt, maxTokens, signal, onProgress) {
      try {
        const stream = client.beta.messages.stream(
          {
            model: prompt.model,
            max_tokens: maxTokens,
            system: prompt.system,
            messages: toMessages(prompt),
            thinking: { type: 'adaptive', display: 'summarized' },
            output_config: { effort: 'high' },
            ...(MODELS_WITH_FALLBACK.has(prompt.model)
              ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
              : {})
          },
          { signal }
        )

        for await (const event of stream) {
          if (event.type === 'content_block_start') {
            if (event.content_block.type === 'thinking') onProgress({ type: 'phase', phase: 'thinking' })
            if (event.content_block.type === 'text') onProgress({ type: 'phase', phase: 'writing' })
          } else if (event.type === 'content_block_delta') {
            if (event.delta.type === 'thinking_delta') {
              onProgress({ type: 'thinking', chars: event.delta.thinking.length })
            } else if (event.delta.type === 'text_delta') {
              onProgress({ type: 'text', text: event.delta.text })
            }
          }
        }

        const message = await stream.finalMessage()
        const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
        return { text, stopReason: message.stop_reason, usage: billedUsage(message, prompt.model) }
      } catch (error) {
        throw explain(error)
      }
    }
  }
}

export async function verifyApiKey(apiKey: string): Promise<KeyResult> {
  try {
    await connect(apiKey).models.list({ limit: 1 })
    return { ok: true }
  } catch (error) {
    const explained = explain(error)
    return { ok: false, message: explained instanceof Error ? explained.message : 'Could not check that key.' }
  }
}
