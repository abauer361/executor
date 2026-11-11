import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiToolName, buildLaunch, installCommand, MCP_SERVERS, missingSettings, toolNeedsApproval } from '../shared/mcpServers'
import { openConnection, type McpConnection } from './mcpConnection'
import { mergePaths } from './shellPath'

const fixture = join(__dirname, 'fixtures/testMcpServer.mjs')
const folder = mkdtempSync(join(tmpdir(), 'executor-mcp-'))
const launch = { transport: 'stdio' as const, command: process.execPath, args: [fixture, folder], env: {} }
const signal = new AbortController().signal

describe('a real MCP server over stdio', () => {
  let connection: McpConnection
  const tool = (name: string) => connection.tools.find((candidate) => candidate.name === `notes__${name}`)!

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = 'must-not-reach-servers'
    writeFileSync(join(folder, 'hello.txt'), 'Hello from a file')
    connection = await openConnection('notes', launch, { path: process.env.PATH ?? '' })
  })

  afterAll(async () => {
    delete process.env.ANTHROPIC_API_KEY
    await connection.close()
    rmSync(folder, { recursive: true, force: true })
  })

  it('lists tools with names the API accepts', () => {
    expect(connection.tools.map((candidate) => candidate.label)).toContain('notes read_note')
    expect(connection.tools.every((candidate) => /^[a-zA-Z0-9_-]{1,64}$/.test(candidate.name))).toBe(true)
  })

  it('asks for approval on everything not declared read-only', () => {
    expect(tool('read_note').needsApproval).toBe(false)
    expect(tool('write_note').needsApproval).toBe(true)
    expect(tool('undeclared').needsApproval).toBe(true)
  })

  it('validates input against the tool schema', () => {
    expect(tool('write_note').validate({ name: 'a', text: 'b' })).toBeNull()
    expect(tool('write_note').validate({ name: 'a' })).not.toBeNull()
    expect(tool('write_note').validate({ name: 'a', text: 'b', extra: 1 })).not.toBeNull()
  })

  it('reads and writes through the protocol', async () => {
    const read = await tool('read_note').call({ name: 'hello.txt' }, signal)
    expect(read).toEqual({ isError: false, content: [{ type: 'text', text: 'Hello from a file' }] })

    await tool('write_note').call({ name: 'out.txt', text: 'Written' }, signal)
    expect(readFileSync(join(folder, 'out.txt'), 'utf8')).toBe('Written')
  })

  it('reports tool errors without throwing', async () => {
    const result = await tool('read_note').call({ name: 'missing.txt' }, signal)
    expect(result.isError).toBe(true)
  })

  it('keeps API keys out of the server environment', async () => {
    const result = await tool('report_secrets').call({}, signal)
    expect(result.content[0]).toEqual({ type: 'text', text: '[]' })
  })
})

describe('starting a server', () => {
  it('explains a missing command', async () => {
    await expect(
      openConnection('x', { transport: 'stdio', command: 'executor-no-such-command', args: [], env: {} }, { path: '/usr/bin' })
    ).rejects.toThrow('executor-no-such-command is not installed')
  })

  it('reports why a server stopped during startup', async () => {
    const script = "console.error('Cannot connect to the Docker daemon'); process.exit(1)"
    await expect(
      openConnection(
        'x',
        { transport: 'stdio', command: process.execPath, args: ['-e', script], env: {} },
        { path: process.env.PATH ?? '' }
      )
    ).rejects.toThrow('Docker is not running')
  })

  it('asks for approval on every tool from an untrusted server', async () => {
    const untrusted = await openConnection('notes', launch, { path: process.env.PATH ?? '', trustHints: false })
    expect(untrusted.tools.every((tool) => tool.needsApproval)).toBe(true)
    await untrusted.close()
  })

  it('labels tools with the name shown to you', async () => {
    const labelled = await openConnection('reg-1', launch, { path: process.env.PATH ?? '', label: 'Weather' })
    expect(labelled.tools[0].label).toBe('Weather read_note')
    await labelled.close()
  })

  it('leaves no file behind when a server never starts', () => {
    expect(existsSync(join(folder, 'never.txt'))).toBe(false)
  })
})

describe('a remote MCP server over HTTP', () => {
  let http: Server
  let url: string

  beforeAll(async () => {
    http = createServer(async (request, response) => {
      if (request.headers.authorization !== 'Bearer good') {
        response.writeHead(401).end()
        return
      }
      const server = new McpServer({ name: 'remote', version: '1.0.0' }, { capabilities: { tools: {} } })
      server.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: 'search',
            description: 'Search.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true }
          }
        ]
      }))
      server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'from remote' }] }))
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      await server.connect(transport)
      await transport.handleRequest(request, response)
    })
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()))
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`
  })

  afterAll(() => http.close())

  it('connects, lists tools and calls them', async () => {
    const remote = await openConnection(
      'reg-1',
      { transport: 'http', url, headers: { Authorization: 'Bearer good' } },
      { path: '', label: 'Docs', trustHints: false }
    )
    expect(remote.tools[0].label).toBe('Docs search')
    expect(await remote.tools[0].call({}, signal)).toEqual({ isError: false, content: [{ type: 'text', text: 'from remote' }] })
    await remote.close()
  })

  it('does not trust a remote server that claims its tools are read-only', async () => {
    const remote = await openConnection(
      'reg-1',
      { transport: 'http', url, headers: { Authorization: 'Bearer good' } },
      { path: '', trustHints: false }
    )
    expect(remote.tools[0].needsApproval).toBe(true)
    await remote.close()
  })

  it('explains a server that needs an account', async () => {
    await expect(openConnection('reg-1', { transport: 'http', url, headers: {} }, { path: '' })).rejects.toThrow(
      'needs an account or key'
    )
  })
})

describe('server definitions', () => {
  it('passes folders as positional arguments or flags', () => {
    const files = buildLaunch(MCP_SERVERS.filesystem, { folders: ['/a', '/b'] }, {}, '/data')
    expect(files).toMatchObject({ args: expect.arrayContaining(['/a', '/b']) })
    const git = buildLaunch(MCP_SERVERS.git, { repository: ['/repo'] }, {}, '/data')
    expect(git).toMatchObject({ args: expect.arrayContaining(['--repository', '/repo']) })
  })

  it('pins every built-in server to one exact release', () => {
    const pinned = /(@\d+\.\d+\.\d+|==\d+\.\d+\.\d+|@sha256:[0-9a-f]{64})$/
    for (const spec of Object.values(MCP_SERVERS)) {
      const target = spec.args.find((arg) => /mcp|modelcontextprotocol/.test(arg))
      expect(target, spec.id).toMatch(pinned)
    }
  })

  it('passes secrets only through the environment', () => {
    const github = buildLaunch(MCP_SERVERS.github, {}, { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' }, '/data')
    expect(github).toMatchObject({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' } })
    expect(JSON.stringify({ ...github, env: {} })).not.toContain('ghp_x')
  })

  it('stores agent memory in the app data folder', () => {
    expect(buildLaunch(MCP_SERVERS.memory, {}, {}, '/data')).toMatchObject({
      env: { MEMORY_FILE_PATH: '/data/mcp-memory.jsonl' }
    })
  })

  it('finds settings that are still missing', () => {
    expect(missingSettings(MCP_SERVERS.filesystem, { folders: {}, secrets: [] })).toHaveLength(1)
    expect(missingSettings(MCP_SERVERS.filesystem, { folders: { folders: ['/a'] }, secrets: [] })).toHaveLength(0)
    expect(missingSettings(MCP_SERVERS.time, { folders: {}, secrets: [] })).toHaveLength(0)
  })

  it('shows the install command for the marketplace', () => {
    expect(installCommand('git')).toBe('uvx mcp-server-git==2026.11.4 --repository <folder>')
  })

  it('makes tool names unique across servers and valid for the API', () => {
    expect(apiToolName('sequential-thinking', 'do.it now')).toBe('sequential-thinking__do_it_now')
    expect(apiToolName('a', 'x'.repeat(100))).toHaveLength(64)
  })

  it('only skips approval for read-only tools that stay on this Mac', () => {
    expect(toolNeedsApproval({ readOnlyHint: true })).toBe(false)
    expect(toolNeedsApproval({ readOnlyHint: true, openWorldHint: true })).toBe(true)
    expect(toolNeedsApproval({ readOnlyHint: false })).toBe(true)
    expect(toolNeedsApproval(undefined)).toBe(true)
  })
})

describe('mergePaths', () => {
  it('keeps order and removes duplicates', () => {
    expect(mergePaths('/usr/bin:/bin', '/opt/homebrew/bin:/usr/bin', '')).toBe('/usr/bin:/bin:/opt/homebrew/bin')
  })
})
