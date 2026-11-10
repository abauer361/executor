import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaIterationsUsage,
  BetaMessage,
  BetaMessageParam,
  BetaTool
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { KeyResult } from '../shared/types'
import {
  FatalRunError,
  type AgentTool,
  type ModelChoice,
  type ModelChoiceRequest,
  type ModelSession,
  type ModelSessionConfig,
  type ModelToolUse,
  type ModelUsage
} from './runEngine'

// Claude Haiku has no server-side fallback.
const MODELS_WITH_FALLBACK = new Set(['claude-opus-5-5', 'claude-sonnet-5-5'])

// Pinned because the SDK otherwise follows ANTHROPIC_BASE_URL, which could send the saved key elsewhere.
const API_URL = process.env.EXECUTOR_API_URL ?? 'https://api.anthropic.com'

const ROUTER_MODEL = 'claude-haiku-5-5'
const ROUTER_MAX_TOKENS = 1024
const REASON_LIMIT = 140

const ROUTER_SYSTEM =
  'You pick which Claude model should do one agent\'s work. Choose the cheapest model that can do this work well. Use claude-haiku-5-5 for simple, short or mechanical work, claude-sonnet-5-5 for everyday coding, analysis and writing, and claude-opus-5-5 only for unusually hard reasoning. Answer only from the candidates you are given.'

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

export function createAnthropicClient(apiKey: string) {
  const client = connect(apiKey)

  return {
    async chooseModel({ goal, agent, prompt, candidates }: ModelChoiceRequest, signal: AbortSignal): Promise<ModelChoice> {
      try {
        const message = await client.beta.messages.create(
          {
            model: ROUTER_MODEL,
            max_tokens: ROUTER_MAX_TOKENS,
            system: ROUTER_SYSTEM,
            messages: [
              {
                role: 'user',
                content: JSON.stringify({ candidates, agent, agent_instructions: prompt, goal })
              }
            ],
            output_config: {
              effort: 'low',
              format: {
                type: 'json_schema',
                schema: {
                  type: 'object',
                  properties: { model: { type: 'string', enum: candidates }, reason: { type: 'string' } },
                  required: ['model', 'reason'],
                  additionalProperties: false
                }
              }
            }
          },
          { signal }
        )

        if (message.stop_reason !== 'end_turn') throw new Error(`Routing stopped: ${message.stop_reason}`)
        const reply = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
        const choice = JSON.parse(reply) as { model: string; reason: string }
        if (!candidates.includes(choice.model)) throw new Error('Routing chose a model outside the pool')
        return {
          model: choice.model,
          reason: String(choice.reason).slice(0, REASON_LIMIT),
          usage: billedUsage(message, ROUTER_MODEL)
        }
      } catch (error) {
        throw explain(error)
      }
    },

    startSession({ model, system, userMessage, tools }: ModelSessionConfig): ModelSession {
      const messages: BetaMessageParam[] = [{ role: 'user', content: userMessage }]

      return {
        async countInputTokens(signal) {
          try {
            const count = await client.beta.messages.countTokens(
              { model, system, messages, ...(tools.length ? { tools: tools.map(apiTool) } : {}) },
              { signal }
            )
            return count.input_tokens
          } catch (error) {
            throw explain(error)
          }
        },

        async turn(maxTokens, signal, onProgress) {
          try {
            const stream = client.beta.messages.stream(
              {
                model,
                max_tokens: maxTokens,
                system,
                messages,
                cache_control: { type: 'ephemeral' },
                thinking: { type: 'adaptive', display: 'summarized' },
                output_config: { effort: 'high' },
                ...(tools.length
                  ? { tools: tools.map((tool) => ({ ...apiTool(tool), eager_input_streaming: true })) }
                  : {}),
                ...(MODELS_WITH_FALLBACK.has(model)
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
            const toolUses = content.flatMap((block): ModelToolUse[] =>
              block.type === 'tool_use' ? [{ id: block.id, name: block.name, input: block.input }] : []
            )
            if (toolUses.length) messages.push({ role: 'assistant', content: content as BetaContentBlockParam[] })
            return {
              text: content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join(''),
              toolUses,
              stopReason: message.stop_reason,
              usage: billedUsage(message, model)
            }
          } catch (error) {
            throw explain(error)
          }
        },

        addToolResults(results) {
          messages.push({
            role: 'user',
            content: results.map((result) => ({
              type: 'tool_result',
              tool_use_id: result.id,
              is_error: result.isError,
              content: result.content
            }))
          })
        }
      }
    }
  }
}

export async function verifyAnthropicKey(apiKey: string): Promise<KeyResult> {
  try {
    await connect(apiKey).models.list({ limit: 1 })
    return { ok: true }
  } catch (error) {
    const explained = explain(error)
    return { ok: false, message: explained instanceof Error ? explained.message : 'Could not check that key.' }
  }
}
