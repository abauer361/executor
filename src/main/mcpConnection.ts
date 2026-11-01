import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { apiToolName, toolNeedsApproval, type McpLaunch } from '../shared/mcpServers'
import type { AgentTool, ToolOutput, ToolResultContent } from './runEngine'

// First launch can spend a while downloading the server.
const CONNECT_TIMEOUT_MS = 120_000
const TOOL_TIMEOUT_MS = 300_000
const MAX_RESULT_CHARS = 100_000
const STDERR_TAIL_CHARS = 2000

const validator = new AjvJsonSchemaValidator()

function explainFailure(error: unknown, launch: McpLaunch, stderr: string) {
  const message = error instanceof Error ? error.message : String(error)
  if (launch.transport === 'http') {
    if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) {
      return 'This server needs an account or key that Executor cannot provide.'
    }
    return `Could not connect: ${message}`
  }
  if (message.includes('ENOENT')) return `${launch.command} is not installed, or Executor cannot find it.`
  if (/docker daemon|Cannot connect to the Docker/i.test(stderr)) return 'Docker is not running. Start Docker Desktop and try again.'
  const lastLine = stderr.trim().split('\n').at(-1)
  return lastLine || message
}

function truncated(text: string) {
  if (text.length <= MAX_RESULT_CHARS) return text
  return `${text.slice(0, MAX_RESULT_CHARS)}\n\n[Result cut off: ${text.length - MAX_RESULT_CHARS} more characters were not included.]`
}

function toResultContent(content: unknown): ToolResultContent[] {
  const blocks = Array.isArray(content) ? (content as Record<string, unknown>[]) : []
  return blocks.map((block): ToolResultContent => {
    if (block.type === 'text') return { type: 'text', text: truncated(String(block.text)) }
    if (block.type === 'image') {
      return {
        type: 'image',
        source: { type: 'base64', media_type: block.mimeType as 'image/png', data: String(block.data) }
      }
    }
    return { type: 'text', text: truncated(JSON.stringify(block)) }
  })
}

export interface McpConnection {
  tools: AgentTool[]
  close(): Promise<void>
}

interface ConnectionOptions {
  path: string
  label?: string
  trustHints?: boolean
}

export async function openConnection(id: string, launch: McpLaunch, options: ConnectionOptions): Promise<McpConnection> {
  const { path, label = id, trustHints = true } = options
  let stderr = ''
  let transport: StdioClientTransport | StreamableHTTPClientTransport

  if (launch.transport === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(launch.url), { requestInit: { headers: launch.headers } })
  } else {
    transport = new StdioClientTransport({
      command: launch.command,
      args: launch.args,
      env: { ...getDefaultEnvironment(), PATH: path, ...launch.env },
      stderr: 'pipe'
    })
    transport.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS)
    })
  }

  const client = new Client({ name: 'executor', version: '0.2.0' })
  try {
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS })
    const { tools } = await client.listTools(undefined, { timeout: CONNECT_TIMEOUT_MS })

    return {
      close: () => client.close(),
      tools: tools.map((tool): AgentTool => {
        const check = validator.getValidator(tool.inputSchema)
        return {
          name: apiToolName(id, tool.name),
          label: `${label} ${tool.name}`,
          description: tool.description ?? tool.name,
          inputSchema: tool.inputSchema,
          needsApproval: toolNeedsApproval(tool.annotations, trustHints),
          validate(input) {
            const result = check(input)
            return result.valid ? null : (result.errorMessage ?? 'Input does not match the tool schema')
          },
          async call(input, signal): Promise<ToolOutput> {
            const result = await client.callTool(
              { name: tool.name, arguments: input as Record<string, unknown> },
              undefined,
              { signal, timeout: TOOL_TIMEOUT_MS }
            )
            return { content: toResultContent(result.content), isError: result.isError === true }
          }
        }
      })
    }
  } catch (error) {
    await client.close().catch(() => {})
    throw new Error(explainFailure(error, launch, stderr), { cause: error })
  }
}
