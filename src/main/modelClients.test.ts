import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { KeyResult } from '../shared/types'
import type { AgentTool, ModelSession, ToolResult } from './runEngine'

interface Received {
  path: string
  auth?: string
  body: Record<string, any>
}

const received: Received[] = []
let scripts: Record<string, unknown>[][] = []
let server: Server
let openai: (model: string) => ModelSession
let gemini: (model: string) => ModelSession
let openrouter: (model: string, tools?: AgentTool[]) => ModelSession
let verifyOpenRouter: (key: string) => Promise<KeyResult>

const signal = new AbortController().signal
const quiet = () => {}
const config = { system: 'You are running as the Test agent.', userMessage: 'Hello', tools: [] }
const png = { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } as const

const toolResult: ToolResult = {
  id: 'call_1',
  name: 'files__read',
  isError: false,
  content: [
    { type: 'text', text: 'Read it' },
    { type: 'image', source: png }
  ]
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const path = new URL(req.url ?? '/', 'http://local').pathname
    received.push({ path, auth: req.headers.authorization, body: raw ? JSON.parse(raw) : {} })

    if (path === '/openrouter/key') {
      const ok = req.headers.authorization === 'Bearer good'
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' })
      res.end(JSON.stringify(ok ? { data: { label: 'test' } } : { error: { message: 'User not found.', code: 401 } }))
      return
    }

    if (path.endsWith(':countTokens') || path.endsWith('/input_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ totalTokens: 7, input_tokens: 7 }))
      return
    }

    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const event of scripts.shift() ?? []) {
      res.write(`event: ${event.type ?? event.event_type}\ndata: ${JSON.stringify(event)}\n\n`)
    }
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  // The clients read their pinned address when they load.
  process.env.EXECUTOR_OPENAI_URL = `${url}/v1`
  process.env.EXECUTOR_GOOGLE_URL = url
  process.env.EXECUTOR_OPENROUTER_URL = `${url}/openrouter`
  const { createOpenAIClient } = await import('./openaiClient')
  const { createGeminiClient } = await import('./geminiClient')
  const { createOpenRouterClient, verifyOpenRouterKey } = await import('./openrouterClient')
  openai = (model) => createOpenAIClient('test').startSession({ ...config, model })
  gemini = (model) => createGeminiClient('test').startSession({ ...config, model })
  openrouter = (model, tools = []) => createOpenRouterClient('good').startSession({ ...config, model, tools })
  verifyOpenRouter = verifyOpenRouterKey
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  received.length = 0
  scripts = []
})

const completed = (output: unknown[], status = 'completed', extra = {}) => ({
  type: status === 'incomplete' ? 'response.incomplete' : 'response.completed',
  response: {
    id: 'resp',
    status,
    output,
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 20 },
    ...extra
  }
})

describe('OpenAI session', () => {
  const reasoning = { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'sealed' }
  const call = { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'files__read', arguments: '{"path":"a"}' }

  it('sends reasoning back with tool results, including images', async () => {
    scripts = [[completed([reasoning, call])], [completed([])]]
    const session = openai('gpt-6-luna')

    const first = await session.turn(500, signal, quiet)
    expect(first.toolUses).toEqual([{ id: 'call_1', name: 'files__read', input: { path: 'a' } }])

    session.addToolResults([toolResult])
    await session.turn(500, signal, quiet)

    const { input, store } = received[1].body
    expect(store).toBe(false)
    expect(input[1]).toMatchObject({ type: 'reasoning', encrypted_content: 'sealed' })
    expect(input[3]).toEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: [
        { type: 'input_text', text: 'Read it' },
        { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }
      ]
    })
  })

  it('bills cached input apart from fresh input', async () => {
    scripts = [[completed([])]]
    const { usage } = await openai('gpt-6-luna').turn(500, signal, quiet)
    expect(usage).toEqual([
      { model: 'gpt-6-luna', inputTokens: 60, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0 }
    ])
  })

  it('reports why a reply stopped', async () => {
    const part = (reason: string) => completed([], 'incomplete', { incomplete_details: { reason } })
    const refused = { id: 'msg', type: 'message', content: [{ type: 'refusal', refusal: 'No' }] }
    scripts = [[part('max_output_tokens')], [part('content_filter')], [completed([refused])]]
    const stops = []
    for (let turn = 0; turn < 3; turn += 1) stops.push((await openai('gpt-6-luna').turn(500, signal, quiet)).stopReason)
    expect(stops).toEqual(['max_tokens', 'refusal', 'refusal'])
  })

  it('keeps unreadable tool input for the model to fix', async () => {
    scripts = [[completed([{ ...call, arguments: '{"path":' }])]]
    const { toolUses } = await openai('gpt-6-luna').turn(500, signal, quiet)
    expect(toolUses[0].input).toEqual({ INVALID_JSON: '{"path":' })
  })

  it('fails when the stream ends without a result', async () => {
    scripts = [[{ type: 'response.created', response: {} }]]
    await expect(openai('gpt-6-luna').turn(500, signal, quiet)).rejects.toThrow('ended the response early')
  })
})

describe('Gemini session', () => {
  const usage = { total_input_tokens: 100, total_output_tokens: 20, total_thought_tokens: 5, total_cached_tokens: 40 }
  const created = (id: string) => ({ event_type: 'interaction.created', interaction: { id, status: 'in_progress' } })
  const finished = (id: string, status: string, extra = {}) => ({
    event_type: 'interaction.completed',
    interaction: { id, status, ...extra }
  })
  const text = (value: string) => ({ event_type: 'step.delta', index: 0, delta: { type: 'text', text: value } })
  const toolCall = [
    { event_type: 'step.start', index: 1, step: { type: 'function_call', id: 'call_1', name: 'files__read', arguments: {} } },
    { event_type: 'step.delta', index: 1, delta: { type: 'arguments_delta', arguments: '{"pa' } },
    { event_type: 'step.delta', index: 1, delta: { type: 'arguments_delta', arguments: 'th":"a"}' } }
  ]

  it('continues the stored conversation with only the new results', async () => {
    scripts = [
      [created('int_1'), ...toolCall, finished('int_1', 'requires_action', { usage })],
      [created('int_2'), text('Done'), finished('int_2', 'completed', { usage })]
    ]
    const session = gemini('gemini-3.8-flash')

    const first = await session.turn(500, signal, quiet)
    expect(first.toolUses).toEqual([{ id: 'call_1', name: 'files__read', input: { path: 'a' } }])

    session.addToolResults([toolResult])
    const second = await session.turn(500, signal, quiet)
    expect(second.text).toBe('Done')

    const { body } = received[1]
    expect(body.previous_interaction_id).toBe('int_1')
    expect(body.system_instruction).toBe(config.system)
    expect(body.input).toEqual([
      {
        type: 'function_result',
        call_id: 'call_1',
        name: 'files__read',
        is_error: false,
        result: [
          { type: 'text', text: 'Read it' },
          { type: 'image', data: png.data, mime_type: 'image/png' }
        ]
      }
    ])
  })

  it('bills thinking as output and cached input apart', async () => {
    scripts = [[created('int_1'), text('Hi'), finished('int_1', 'completed', { usage })]]
    const result = await gemini('gemini-3.8-flash').turn(500, signal, quiet)
    expect(result.usage).toEqual([{ model: 'gemini-3.8-flash', inputTokens: 60, outputTokens: 25, cacheReadTokens: 40 }])
  })

  it('finds usage on step events when the final event leaves it out', async () => {
    const stop = { event_type: 'step.stop', index: 0, usage }
    scripts = [[created('int_1'), text('Hi'), stop, finished('int_1', 'completed')]]
    const result = await gemini('gemini-3.8-flash').turn(500, signal, quiet)
    expect(result.usage[0].outputTokens).toBe(25)
  })

  it('counts the whole conversation once Google holds it', async () => {
    scripts = [[created('int_1'), ...toolCall, finished('int_1', 'requires_action', { usage })]]
    const session = gemini('gemini-3.8-flash')
    await session.turn(500, signal, quiet)
    expect(await session.countInputTokens(signal)).toBe(125)

    session.addToolResults([toolResult])
    expect(await session.countInputTokens(signal)).toBe(125 + 1120 + 7)
  })

  it('treats every cut-off status as out of tokens', async () => {
    const stops = []
    for (const status of ['incomplete', 'budget_exceeded', 'requires_continuation']) {
      scripts = [[created('int_1'), text('Partial'), finished('int_1', status, { usage })]]
      stops.push((await gemini('gemini-3.8-flash').turn(500, signal, quiet)).stopReason)
    }
    expect(stops).toEqual(['max_tokens', 'max_tokens', 'max_tokens'])
  })

  it('fails instead of finishing with nothing', async () => {
    scripts = [[created('int_1')], [created('int_2'), finished('int_2', 'completed', { usage })]]
    await expect(gemini('gemini-3.8-flash').turn(500, signal, quiet)).rejects.toThrow('ended the response early')
    await expect(gemini('gemini-3.8-flash').turn(500, signal, quiet)).rejects.toThrow('empty response')
  })

  it('surfaces errors from the stream', async () => {
    scripts = [[created('int_1'), { event_type: 'error', error: { message: 'Overloaded' } }]]
    await expect(gemini('gemini-3.8-flash').turn(500, signal, quiet)).rejects.toThrow('Overloaded')
  })
})

describe('OpenRouter session', () => {
  const tool: AgentTool = {
    name: 'files__read',
    label: 'files read',
    description: 'Read a file',
    inputSchema: { type: 'object' },
    needsApproval: false,
    validate: () => null,
    call: async () => ({ content: [], isError: false })
  }
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    choices: [{ index: 0, delta, finish_reason: finish }]
  })
  const callDelta = (part: Record<string, unknown>) => chunk({ tool_calls: [{ index: 0, ...part }] })

  it('checks the key against /key on the pinned address', async () => {
    expect(await verifyOpenRouter('good')).toEqual({ ok: true })
    const rejected = await verifyOpenRouter('bad')
    expect(rejected.ok).toBe(false)
    expect(rejected.message).toContain('OpenRouter rejected your API key')
    expect(received.map(({ path, auth }) => [path, auth])).toEqual([
      ['/openrouter/key', 'Bearer good'],
      ['/openrouter/key', 'Bearer bad']
    ])
  })

  it('assembles streamed tool call deltas and bills the reported usage', async () => {
    scripts = [
      [
        chunk({ role: 'assistant', content: 'Reading' }),
        callDelta({ id: 'call_1', type: 'function', function: { name: 'files__read', arguments: '{"pa' } }),
        callDelta({ function: { arguments: 'th":"a"}' } }),
        chunk({}, 'tool_calls'),
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }
      ],
      [chunk({ content: 'Done' }, 'stop')]
    ]
    const session = openrouter('openai/gpt-4o', [tool])

    const first = await session.turn(500, signal, quiet)
    expect(first.text).toBe('Reading')
    expect(first.toolUses).toEqual([{ id: 'call_1', name: 'files__read', input: { path: 'a' } }])
    expect(first.stopReason).not.toMatch(/max_tokens|refusal/)
    expect(first.usage).toEqual([{ model: 'openai/gpt-4o', inputTokens: 100, outputTokens: 20 }])

    session.addToolResults([toolResult])
    const second = await session.turn(500, signal, quiet)
    expect(second.usage).toEqual([{ model: 'openai/gpt-4o', inputTokens: 0, outputTokens: 0 }])

    expect(received[0]).toMatchObject({
      path: '/openrouter/chat/completions',
      body: { model: 'openai/gpt-4o', stream: true, stream_options: { include_usage: true }, max_tokens: 500 }
    })
    const { messages } = received[1].body
    expect(messages.slice(2, 4)).toEqual([
      {
        role: 'assistant',
        content: 'Reading',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'files__read', arguments: '{"path":"a"}' } }]
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'Read it' }
    ])
    expect(messages[4].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } })
  })

  it('reports why a reply stopped', async () => {
    scripts = [[chunk({ content: 'Par' }, 'length')], [chunk({}, 'content_filter')]]
    const stops = []
    for (let turn = 0; turn < 2; turn += 1) stops.push((await openrouter('openai/gpt-4o').turn(500, signal, quiet)).stopReason)
    expect(stops).toEqual(['max_tokens', 'refusal'])
  })

  it('keeps unreadable tool input for the model to fix', async () => {
    scripts = [[callDelta({ id: 'call_1', function: { name: 'files__read', arguments: '{"path":' } }), chunk({}, 'tool_calls')]]
    const { toolUses } = await openrouter('openai/gpt-4o').turn(500, signal, quiet)
    expect(toolUses[0].input).toEqual({ INVALID_JSON: '{"path":' })
  })
})
