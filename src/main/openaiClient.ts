import OpenAI from 'openai'
import type {
  Response,
  ResponseFunctionCallOutputItemList,
  ResponseInput,
  Tool
} from 'openai/resources/responses/responses'
import type { KeyResult } from '../shared/types'
import { FatalRunError, type ModelSession, type ModelSessionConfig, type ModelToolUse, type ToolResult } from './runEngine'

// Pinned because the SDK otherwise follows OPENAI_BASE_URL, which could send the saved key elsewhere.
const API_URL = process.env.EXECUTOR_OPENAI_URL ?? 'https://api.openai.com/v1'

const connect = (apiKey: string) => new OpenAI({ apiKey, baseURL: API_URL })

function explain(error: unknown): unknown {
  if (error instanceof OpenAI.APIUserAbortError) return error
  if (error instanceof OpenAI.AuthenticationError) {
    return new FatalRunError('OpenAI rejected your API key. Check it in Settings.')
  }
  if (error instanceof OpenAI.PermissionDeniedError) {
    return new FatalRunError(`Your OpenAI key does not have access: ${error.message}`)
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new Error(`OpenAI rate limit or quota reached: ${error.message}`)
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new Error('Could not reach OpenAI. Check your internet connection.')
  }
  if (error instanceof OpenAI.APIError) return new Error(error.message)
  return error
}

function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { INVALID_JSON: text }
  }
}

function resultOutput({ content }: ToolResult): ResponseFunctionCallOutputItemList {
  return content.map((block) =>
    block.type === 'text'
      ? { type: 'input_text', text: block.text }
      : { type: 'input_image', image_url: `data:${block.source.media_type};base64,${block.source.data}` }
  )
}

function stopReasonOf(response: Response, refused: boolean) {
  if (refused || response.incomplete_details?.reason === 'content_filter') return 'refusal'
  return response.status === 'incomplete' ? 'max_tokens' : 'end'
}

export function createOpenAIClient(apiKey: string) {
  const client = connect(apiKey)

  return {
    startSession({ model, system, userMessage, tools }: ModelSessionConfig): ModelSession {
      const input: ResponseInput = [{ role: 'user', content: userMessage }]
      const apiTools: Tool[] = tools.map(({ name, description, inputSchema }) => ({
        type: 'function',
        name,
        description,
        parameters: inputSchema,
        strict: false
      }))
      const toolParams = apiTools.length ? { tools: apiTools } : {}

      return {
        async countInputTokens(signal) {
          try {
            const count = await client.responses.inputTokens.count(
              { model, instructions: system, input, ...toolParams },
              { signal }
            )
            return count.input_tokens
          } catch (error) {
            throw explain(error)
          }
        },

        async turn(maxTokens, signal, onProgress) {
          try {
            const stream = await client.responses.create(
              {
                model,
                instructions: system,
                input,
                max_output_tokens: maxTokens,
                // Not stored, so reasoning travels with each request as encrypted content.
                store: false,
                include: ['reasoning.encrypted_content'],
                reasoning: { summary: 'auto' },
                stream: true,
                ...toolParams
              },
              { signal }
            )

            let final: Response | undefined
            let writing = false
            for await (const event of stream) {
              if (event.type === 'response.reasoning_summary_text.delta') {
                onProgress({ type: 'phase', phase: 'thinking' })
                onProgress({ type: 'thinking', chars: event.delta.length })
              } else if (event.type === 'response.output_text.delta') {
                if (!writing) onProgress({ type: 'phase', phase: 'writing' })
                writing = true
                onProgress({ type: 'text', text: event.delta })
              } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
                final = event.response
              } else if (event.type === 'response.failed') {
                throw new Error(event.response.error?.message ?? 'OpenAI could not finish this response.')
              } else if (event.type === 'error') {
                throw new Error(event.message)
              }
            }
            if (!final) throw new Error('OpenAI ended the response early.')

            // Reasoning items must go back with the tool results, so everything is kept.
            input.push(...(final.output as ResponseInput))

            const texts: string[] = []
            const toolUses: ModelToolUse[] = []
            let refused = false
            for (const item of final.output) {
              if (item.type === 'function_call') {
                toolUses.push({ id: item.call_id, name: item.name, input: parseArguments(item.arguments) })
              } else if (item.type === 'message') {
                for (const part of item.content) {
                  if (part.type === 'output_text') texts.push(part.text)
                  else refused = true
                }
              }
            }

            const cached = final.usage?.input_tokens_details.cached_tokens ?? 0
            const details = final.usage?.input_tokens_details as { cache_write_tokens?: number } | undefined
            const written = details?.cache_write_tokens ?? 0
            return {
              text: texts.join(''),
              toolUses,
              stopReason: stopReasonOf(final, refused),
              usage: [
                {
                  model,
                  inputTokens: (final.usage?.input_tokens ?? 0) - cached - written,
                  outputTokens: final.usage?.output_tokens ?? 0,
                  cacheReadTokens: cached,
                  cacheWriteTokens: written
                }
              ]
            }
          } catch (error) {
            throw explain(error)
          }
        },

        addToolResults(results) {
          for (const result of results) {
            input.push({ type: 'function_call_output', call_id: result.id, output: resultOutput(result) })
          }
        }
      }
    }
  }
}

export async function verifyOpenAIKey(apiKey: string): Promise<KeyResult> {
  try {
    await connect(apiKey).models.list()
    return { ok: true }
  } catch (error) {
    const explained = explain(error)
    return { ok: false, message: explained instanceof Error ? explained.message : 'Could not check that key.' }
  }
}
