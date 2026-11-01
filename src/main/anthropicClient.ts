import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaIterationsUsage,
  BetaMessage,
  BetaTool
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { KeyResult } from '../shared/types'
import { FatalRunError, type AgentTool, type ModelClient, type ModelToolUse, type ModelUsage } from './runEngine'

// Claude Haiku has no server-side fallback.
const MODELS_WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

// Pinned because the SDK otherwise follows ANTHROPIC_BASE_URL, which could send the saved key elsewhere.
const API_URL = process.env.EXECUTOR_API_URL ?? 'https://api.anthropic.com'

const MAX_UNPARSEABLE_RETRIES = 2

// Blocks from an attempt that was declined partway and must not be replayed.
const DECLINED_ATTEMPT_BLOCKS = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'])

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
  const entries = billed.length ? billed : [message.usage]
  return entries.map((entry) => ({
    model: ('model' in entry && entry.model) || (billed.length ? requestedModel : message.model),
    inputTokens: entry.input_tokens,
    outputTokens: entry.output_tokens,
    cacheReadTokens: entry.cache_read_input_tokens ?? 0,
    cacheWriteTokens: entry.cache_creation_input_tokens ?? 0
  }))
}

// After a mid-output fallback, only what follows the final fallback block may be echoed back.
function replayableContent(content: BetaContentBlock[]) {
  const boundary = content.findLastIndex((block) => block.type === 'fallback')
  return content.filter((block, index) => index > boundary || !DECLINED_ATTEMPT_BLOCKS.has(block.type))
}

const apiTool = ({ name, description, inputSchema }: AgentTool) =>
  ({ name, description, input_schema: inputSchema }) as BetaTool

export function createModelClient(apiKey: string): ModelClient {
  const client = connect(apiKey)

  return {
    async countInputTokens(prompt, signal) {
      try {
        const count = await client.beta.messages.countTokens(
          {
            model: prompt.model,
            system: prompt.system,
            messages: prompt.messages,
            ...(prompt.tools.length ? { tools: prompt.tools.map(apiTool) } : {})
          },
          { signal }
        )
        return count.input_tokens
      } catch (error) {
        throw explain(error)
      }
    },

    async stream(prompt, maxTokens, signal, onProgress) {
      for (let attempt = 0; ; attempt += 1) {
        try {
          const stream = client.beta.messages.stream(
            {
              model: prompt.model,
              max_tokens: maxTokens,
              system: prompt.system,
              messages: prompt.messages,
              cache_control: { type: 'ephemeral' },
              thinking: { type: 'adaptive', display: 'summarized' },
              output_config: { effort: 'high' },
              ...(prompt.tools.length
                ? { tools: prompt.tools.map((tool) => ({ ...apiTool(tool), eager_input_streaming: true })) }
                : {}),
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
          const content = replayableContent(message.content)
          return {
            content: content as BetaContentBlockParam[],
            text: content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''),
            toolUses: content.flatMap((block): ModelToolUse[] =>
              block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : []
            ),
            stopReason: message.stop_reason,
            usage: billedUsage(message, prompt.model)
          }
        } catch (error) {
          // Anything that is not an API error here is a tool input that could not be parsed.
          if (error instanceof Anthropic.APIError || attempt >= MAX_UNPARSEABLE_RETRIES) throw explain(error)
        }
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
