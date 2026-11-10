import OpenAI from 'openai'
import type {
  ChatCompletionChunk,
  ChatCompletionContentPartImage,
  ChatCompletionFunctionTool,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam
} from 'openai/resources/chat/completions'
import { registerListedRates } from '../shared/pricing'
import type { KeyResult, OpenRouterModel } from '../shared/types'
import { FatalRunError, type ModelSession, type ModelSessionConfig, type ModelToolUse, type ToolResult } from './runEngine'

// Pinned so neither OPENAI_BASE_URL nor OPENROUTER_BASE_URL can send the saved key elsewhere.
const API_URL = process.env.EXECUTOR_OPENROUTER_URL ?? 'https://openrouter.ai/api/v1'

const connect = (apiKey: string) => new OpenAI({ apiKey, baseURL: API_URL })

// OpenRouter has no token count endpoint, so input is estimated at four characters per token.
const estimateTokens = (text: string) => Math.ceil(text.length / 4)

let modelIds: ReadonlySet<string> = new Set()

export const openRouterModelIds = () => modelIds

export function replaceOpenRouterModels(models: OpenRouterModel[]) {
  modelIds = new Set(models.map((model) => model.id))
  for (const model of models) {
    registerListedRates(model.id, { input: model.promptPerMillion, output: model.completionPerMillion })
  }
}

function explain(error: unknown): unknown {
  if (error instanceof OpenAI.APIUserAbortError) return error
  if (error instanceof OpenAI.AuthenticationError) {
    return new FatalRunError('OpenRouter rejected your API key. Check it in Settings.')
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return new FatalRunError(`Your OpenRouter key does not have access: ${error.message}`)
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new Error(`OpenRouter rate limit or credit limit reached: ${error.message}`)
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new Error('Could not reach OpenRouter. Check your internet connection.')
  }
  if (error instanceof OpenAI.APIError) return new Error(error.message)
  return error
}

function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text || '{}')
  } catch {
    return { INVALID_JSON: text }
  }
}

function stopReasonOf(finish: string | null, hasTools: boolean) {
  if (finish === 'length' || finish === 'max_tokens') return 'max_tokens'
  if (finish === 'content_filter') return 'refusal'
  return hasTools ? 'tool_calls' : 'end'
}

interface ListedModel {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
}

const isChatModel = ({ architecture }: ListedModel) =>
  (architecture?.input_modalities ?? ['text']).includes('text') &&
  (architecture?.output_modalities ?? ['text']).includes('text')

const perMillion = (price: string | undefined) => Number(price) * 1_000_000

export async function listOpenRouterModels(apiKey: string): Promise<OpenRouterModel[]> {
  try {
    const { data } = await connect(apiKey).get<{ data: ListedModel[] }>('/models')
    return data
      .filter(isChatModel)
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        contextLength: model.context_length ?? 0,
        promptPerMillion: perMillion(model.pricing?.prompt),
        completionPerMillion: perMillion(model.pricing?.completion)
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (error) {
    throw explain(error)
  }
}

function resultMessages(results: ToolResult[]): ChatCompletionMessageParam[] {
  const images: ChatCompletionContentPartImage[] = []
  const messages: ChatCompletionMessageParam[] = results.map(({ id, content }) => {
    const texts: string[] = []
    for (const block of content) {
      if (block.type === 'text') texts.push(block.text)
      else images.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } })
    }
    return { role: 'tool', tool_call_id: id, content: texts.join('\n\n') }
  })
  // Tool messages only carry text, so images follow in one user message.
  if (images.length) {
    messages.push({ role: 'user', content: [{ type: 'text', text: 'Images returned by the tools above.' }, ...images] })
  }
  return messages
}

export function createOpenRouterClient(apiKey: string) {
  const client = connect(apiKey)

  return {
    startSession({ model, system, userMessage, tools }: ModelSessionConfig): ModelSession {
      const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: system },
        { role: 'user', content: userMessage }
      ]
      const apiTools: ChatCompletionFunctionTool[] = tools.map(({ name, description, inputSchema }) => ({
        type: 'function',
        function: { name, description, parameters: inputSchema }
      }))
      const toolParams = apiTools.length ? { tools: apiTools } : {}
      const toolTokens = estimateTokens(JSON.stringify(apiTools))
      let pending: ChatCompletionMessageParam | null = null

      return {
        async countInputTokens() {
          return estimateTokens(messages.map((message) => JSON.stringify(message.content)).join('')) + toolTokens
        },

        async turn(maxTokens, signal, onProgress) {
          try {
            const stream = await client.chat.completions.create(
              {
                model,
                messages,
                max_tokens: maxTokens,
                stream: true,
                stream_options: { include_usage: true },
                ...toolParams
              },
              { signal }
            )

            let text = ''
            let finish: string | null = null
            let usage: ChatCompletionChunk['usage'] | undefined
            let writing = false
            const calls: { id: string; name: string; arguments: string }[] = []

            for await (const chunk of stream) {
              const failure = (chunk as { error?: { message?: string } }).error
              if (failure) throw new Error(failure.message ?? 'OpenRouter could not finish this response.')
              if (chunk.usage) usage = chunk.usage

              const choice = chunk.choices[0]
              if (!choice) continue
              if (choice.finish_reason) finish = choice.finish_reason
              const delta = choice.delta as ChatCompletionChunk.Choice.Delta & { reasoning?: string | null }

              if (delta.reasoning) {
                onProgress({ type: 'phase', phase: 'thinking' })
                onProgress({ type: 'thinking', chars: delta.reasoning.length })
              }
              if (delta.content) {
                if (!writing) onProgress({ type: 'phase', phase: 'writing' })
                writing = true
                text += delta.content
                onProgress({ type: 'text', text: delta.content })
              }
              for (const part of delta.tool_calls ?? []) {
                const call = (calls[part.index] ??= { id: '', name: '', arguments: '' })
                if (part.id) call.id = part.id
                if (part.function?.name) call.name ||= part.function.name
                if (part.function?.arguments) call.arguments += part.function.arguments
              }
            }

            const toolCalls: ChatCompletionMessageFunctionToolCall[] = calls
              .filter(Boolean)
              .map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }))
            const toolUses: ModelToolUse[] = toolCalls.map(({ id, function: fn }) => ({
              id,
              name: fn.name,
              input: parseArguments(fn.arguments)
            }))
            pending = { role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }

            return {
              text,
              toolUses,
              stopReason: stopReasonOf(finish, toolUses.length > 0),
              usage: [{ model, inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0 }]
            }
          } catch (error) {
            throw explain(error)
          }
        },

        addToolResults(results) {
          if (pending) messages.push(pending)
          pending = null
          messages.push(...resultMessages(results))
        }
      }
    }
  }
}

export async function verifyOpenRouterKey(apiKey: string): Promise<KeyResult> {
  try {
    await connect(apiKey).get('/key')
    return { ok: true }
  } catch (error) {
    const explained = explain(error)
    return { ok: false, message: explained instanceof Error ? explained.message : 'Could not check that key.' }
  }
}
