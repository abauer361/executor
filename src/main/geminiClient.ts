import { GoogleGenAI, type Interactions } from '@google/genai'
import type { KeyResult } from '../shared/types'
import {
  FatalRunError,
  type ModelSession,
  type ModelSessionConfig,
  type ModelToolUse,
  type ModelUsage,
  type ToolResult
} from './runEngine'

// Pinned so GOOGLE_GEMINI_BASE_URL cannot send the saved key elsewhere.
const API_URL = process.env.EXECUTOR_GOOGLE_URL ?? 'https://generativelanguage.googleapis.com'

// Token counting takes plain text here, so tool schemas and images are estimated.
const CHARS_PER_TOKEN = 4
const IMAGE_TOKENS = 1120

const connect = (apiKey: string) => new GoogleGenAI({ apiKey, httpOptions: { baseUrl: API_URL } })

function explain(error: unknown): unknown {
  if (error instanceof Error && error.name === 'AbortError') return error
  const { status, message } = error as { status?: number; message?: string }
  if (status === 401 || status === 403 || (status === 400 && message?.includes('API key'))) {
    return new FatalRunError('Google rejected your API key. Check it in Settings.')
  }
  if (status === 429) return new Error(`Gemini rate limit or quota reached: ${message}`)
  if (status === undefined && error instanceof TypeError) {
    return new Error('Could not reach Google. Check your internet connection.')
  }
  return error
}

function resultStep({ id, name, isError, content }: ToolResult): Interactions.FunctionResultStep {
  return {
    type: 'function_result',
    call_id: id,
    name,
    is_error: isError,
    result: content.map((block) =>
      block.type === 'text'
        ? { type: 'text', text: block.text }
        : { type: 'image', data: block.source.data, mime_type: block.source.media_type }
    )
  }
}

function billedUsage(model: string, usage: Interactions.Usage | undefined): ModelUsage {
  const cached = usage?.total_cached_tokens ?? 0
  return {
    model,
    inputTokens: (usage?.total_input_tokens ?? 0) - cached,
    // Thinking is reported apart from the reply and billed as output.
    outputTokens: (usage?.total_output_tokens ?? 0) + (usage?.total_thought_tokens ?? 0),
    cacheReadTokens: cached
  }
}

interface StreamedCall {
  id: string
  name: string
  input: Record<string, unknown>
  partial: string
}

function callInput({ input, partial }: StreamedCall): unknown {
  if (!partial) return input
  try {
    return JSON.parse(partial)
  } catch {
    return { INVALID_JSON: partial }
  }
}

function stopReasonOf(status: string | undefined) {
  if (status === undefined || status === 'in_progress') throw new Error('Gemini ended the response early.')
  if (status === 'failed' || status === 'cancelled') throw new Error(`Gemini ${status} this response.`)
  const cutOff = status === 'incomplete' || status === 'budget_exceeded' || status === 'requires_continuation'
  return cutOff ? 'max_tokens' : 'end'
}

export function createGeminiClient(apiKey: string) {
  const client = connect(apiKey)

  return {
    startSession({ model, system, userMessage, tools }: ModelSessionConfig): ModelSession {
      const apiTools: Interactions.Tool[] = tools.map(({ name, description, inputSchema }) => ({
        type: 'function',
        name,
        description,
        parameters: inputSchema
      }))
      const toolParams = apiTools.length ? { tools: apiTools } : {}

      // Google keeps the conversation and its thought signatures, so each turn sends only what is new.
      let previousId: string | undefined
      let input: string | Interactions.FunctionResultStep[] = userMessage
      let pendingText = `${system}\n\n${userMessage}`
      let knownTokens = Math.ceil(JSON.stringify(apiTools).length / CHARS_PER_TOKEN)

      return {
        async countInputTokens(signal) {
          if (!pendingText) return knownTokens
          try {
            const { totalTokens } = await client.models.countTokens({
              model,
              contents: pendingText,
              config: { abortSignal: signal }
            })
            return knownTokens + (totalTokens ?? Math.ceil(pendingText.length / CHARS_PER_TOKEN))
          } catch (error) {
            throw explain(error)
          }
        },

        async turn(maxTokens, signal, onProgress) {
          try {
            const stream = await client.interactions.create(
              {
                model,
                input,
                system_instruction: system,
                generation_config: { max_output_tokens: maxTokens, thinking_summaries: 'auto' },
                store: true,
                stream: true,
                // A single request, so the output limit and the usage below cover everything billed.
                automatic_continuation: false,
                ...toolParams,
                ...(previousId ? { previous_interaction_id: previousId } : {})
              },
              { signal }
            )

            let text = ''
            let writing = false
            let status: string | undefined
            let usage: Interactions.Usage | undefined
            const calls = new Map<number, StreamedCall>()

            for await (const event of stream) {
              if (event.event_type === 'step.start') {
                if (event.step.type === 'thought') onProgress({ type: 'phase', phase: 'thinking' })
                if (event.step.type === 'function_call') {
                  const { id, name, arguments: input } = event.step
                  calls.set(event.index, { id, name, input, partial: '' })
                }
              } else if (event.event_type === 'step.delta') {
                usage = event.metadata?.total_usage ?? usage
                const { delta } = event
                if (delta.type === 'text') {
                  if (!writing) onProgress({ type: 'phase', phase: 'writing' })
                  writing = true
                  text += delta.text
                  onProgress({ type: 'text', text: delta.text })
                } else if (delta.type === 'thought_summary') {
                  const chars = delta.content?.type === 'text' ? delta.content.text.length : 0
                  onProgress({ type: 'thinking', chars })
                } else if (delta.type === 'arguments_delta') {
                  const call = calls.get(event.index)
                  if (call) call.partial += delta.arguments ?? ''
                }
              } else if (event.event_type === 'step.stop') {
                usage = event.usage ?? usage
              } else if (event.event_type === 'interaction.status_update') {
                previousId = event.interaction_id
                status = event.status
                usage = event.usage ?? usage
              } else if (event.event_type === 'interaction.created' || event.event_type === 'interaction.completed') {
                previousId = event.interaction.id
                status = event.interaction.status
                usage = event.interaction.usage ?? usage
              } else if (event.event_type === 'error') {
                throw new Error(event.error?.message ?? 'Gemini could not finish this response.')
              }
            }

            const stopReason = stopReasonOf(status)
            const toolUses: ModelToolUse[] = [...calls.values()].map((call) => ({
              id: call.id,
              name: call.name,
              input: callInput(call)
            }))
            if (!text && !toolUses.length && stopReason === 'end') throw new Error('Gemini returned an empty response.')

            const billed = billedUsage(model, usage)
            knownTokens = billed.inputTokens + (billed.cacheReadTokens ?? 0) + billed.outputTokens
            pendingText = ''

            return { text, toolUses, stopReason, usage: [billed] }
          } catch (error) {
            throw explain(error)
          }
        },

        addToolResults(results) {
          input = results.map(resultStep)
          const blocks = results.flatMap((result) => result.content)
          pendingText = blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n')
          knownTokens += blocks.filter((block) => block.type === 'image').length * IMAGE_TOKENS
        }
      }
    }
  }
}

export async function verifyGeminiKey(apiKey: string): Promise<KeyResult> {
  try {
    await connect(apiKey).models.list()
    return { ok: true }
  } catch (error) {
    const explained = explain(error)
    return { ok: false, message: explained instanceof Error ? explained.message : 'Could not check that key.' }
  }
}
