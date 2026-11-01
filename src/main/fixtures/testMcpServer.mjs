// A small real MCP server for tests. Launching third-party servers is left to manual testing.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const folder = process.argv[2]

const fileName = {
  type: 'object',
  properties: { name: { type: 'string' } },
  required: ['name'],
  additionalProperties: false
}

const server = new Server({ name: 'test-files', version: '1.0.0' }, { capabilities: { tools: {} } })

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'read_note',
      description: 'Read a note from the folder.',
      inputSchema: fileName,
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    {
      name: 'write_note',
      description: 'Write a note to the folder.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' }, text: { type: 'string' } },
        required: ['name', 'text'],
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, destructiveHint: true }
    },
    { name: 'undeclared', description: 'A tool with no hints.', inputSchema: { type: 'object', properties: {} } },
    {
      name: 'report_secrets',
      description: 'Reports which sensitive variables this server received.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  const { name, arguments: input } = params
  if (name === 'read_note') {
    try {
      return { content: [{ type: 'text', text: await readFile(join(folder, input.name), 'utf8') }] }
    } catch {
      return { isError: true, content: [{ type: 'text', text: `No note named ${input.name}` }] }
    }
  }
  if (name === 'write_note') {
    await writeFile(join(folder, input.name), input.text)
    return { content: [{ type: 'text', text: `Wrote ${input.name}` }] }
  }
  if (name === 'report_secrets') {
    const names = Object.keys(process.env).filter((key) => /ANTHROPIC|EXECUTOR|TOKEN|SECRET/.test(key))
    return { content: [{ type: 'text', text: JSON.stringify(names) }] }
  }
  return { content: [{ type: 'text', text: 'ok' }] }
})

await server.connect(new StdioServerTransport())
