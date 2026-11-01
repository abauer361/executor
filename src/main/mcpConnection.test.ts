import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiToolName, buildLaunch, installCommand, MCP_SERVERS, missingSettings, toolNeedsApproval } from '../shared/mcpServers'
import { openConnection, type McpConnection } from './mcpConnection'
import { mergePaths } from './shellPath'

const fixture = join(__dirname, 'fixtures/testMcpServer.mjs')
const folder = mkdtempSync(join(tmpdir(), 'executor-mcp-'))
const launch = { command: process.execPath, args: [fixture, folder], env: {} }
const signal = new AbortController().signal

describe('a real MCP server over stdio', () => {
  let connection: McpConnection
  const tool = (name: string) => connection.tools.find((candidate) => candidate.name === `notes__${name}`)!

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = 'must-not-reach-servers'
    writeFileSync(join(folder, 'hello.txt'), 'Hello from a file')
    connection = await openConnection('notes', launch, process.env.PATH ?? '')
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
      openConnection('x', { command: 'executor-no-such-command', args: [], env: {} }, '/usr/bin')
    ).rejects.toThrow('executor-no-such-command is not installed')
  })

  it('reports why a server stopped during startup', async () => {
    const script = "console.error('Cannot connect to the Docker daemon'); process.exit(1)"
    await expect(
      openConnection('x', { command: process.execPath, args: ['-e', script], env: {} }, process.env.PATH ?? '')
    ).rejects.toThrow('Docker is not running')
  })

  it('leaves no file behind when a server never starts', () => {
    expect(existsSync(join(folder, 'never.txt'))).toBe(false)
  })
})

describe('server definitions', () => {
  it('passes folders as positional arguments or flags', () => {
    const files = buildLaunch(MCP_SERVERS.filesystem, { folders: ['/a', '/b'] }, {}, '/data')
    expect(files.args.slice(-2)).toEqual(['/a', '/b'])
    const git = buildLaunch(MCP_SERVERS.git, { repository: ['/repo'] }, {}, '/data')
    expect(git.args.slice(-2)).toEqual(['--repository', '/repo'])
  })

  it('passes secrets only through the environment', () => {
    const github = buildLaunch(MCP_SERVERS.github, {}, { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' }, '/data')
    expect(github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp_x')
    expect(github.args.join(' ')).not.toContain('ghp_x')
  })

  it('stores agent memory in the app data folder', () => {
    expect(buildLaunch(MCP_SERVERS.memory, {}, {}, '/data').env.MEMORY_FILE_PATH).toBe('/data/mcp-memory.jsonl')
  })

  it('finds settings that are still missing', () => {
    expect(missingSettings(MCP_SERVERS.filesystem, { folders: {}, secrets: [] })).toHaveLength(1)
    expect(missingSettings(MCP_SERVERS.filesystem, { folders: { folders: ['/a'] }, secrets: [] })).toHaveLength(0)
    expect(missingSettings(MCP_SERVERS.time, { folders: {}, secrets: [] })).toHaveLength(0)
  })

  it('shows the install command for the marketplace', () => {
    expect(installCommand('git')).toBe('uvx mcp-server-git --repository <folder>')
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
