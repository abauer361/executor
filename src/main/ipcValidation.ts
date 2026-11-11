import { isAbsolute } from 'node:path'
import type { IpcArgs, IpcChannel } from '../shared/ipc'
import { RUNNABLE_MODELS, type Provider } from '../shared/pricing'
import type { ApprovalDecision, CatalogPackage, Limiter, MemoryDoc, PackageKind, RunNodeSpec, RunRequest } from '../shared/types'

// The interface is sandboxed, but main still treats what it sends as untrusted: every argument is
// checked here before a handler sees it, so a compromised page cannot reach past what the app offers.

const MAX_STATE_BYTES = 50_000_000
const MAX_MANIFEST_BYTES = 200_000
const MAX_PROMPT = 500_000
const MAX_ITEMS = 200

const PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google']
const DECISIONS: readonly ApprovalDecision[] = ['allow', 'always', 'deny']
const KINDS: readonly PackageKind[] = ['mcp', 'skill', 'agent', 'workflow']
const PACKAGE_ID = /^[a-z0-9-]{1,100}$/

export class InvalidRequest extends Error {}

type Raw = Record<string, unknown>

function fail(what: string): never {
  throw new InvalidRequest(`Invalid request: ${what}`)
}

function text(value: unknown, what: string, max = 2000): string {
  if (typeof value !== 'string' || value.length > max) fail(what)
  return value
}

// A name used as a key or reference: never empty, and safe to place in a file name or an address.
function id(value: unknown, what: string, max = 300): string {
  const result = text(value, what, max)
  if (result.length === 0 || result.includes('\u0000')) fail(what)
  return result
}

const optionalText = (value: unknown, what: string) => (value === undefined || value === null ? undefined : text(value, what))

function oneOf<T extends string>(value: unknown, options: readonly T[], what: string): T {
  if (!options.includes(value as T)) fail(what)
  return value as T
}

function record(value: unknown, what: string): Raw {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(what)
  return value as Raw
}

function list<T>(value: unknown, item: (value: unknown, what: string) => T, what: string, max = MAX_ITEMS): T[] {
  if (!Array.isArray(value) || value.length > max) fail(what)
  return value.map((entry) => item(entry, what))
}

function amount(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(what)
  return value
}

// A real location on this Mac. Being absolute also means it can never be read as a command-line flag.
function absolutePath(value: unknown, what: string): string {
  const path = id(value, what, 4096)
  if (!isAbsolute(path)) fail(what)
  return path
}

function catalogPackage(value: unknown): CatalogPackage {
  const pkg = record(value, 'package')
  if (typeof pkg.id !== 'string' || !PACKAGE_ID.test(pkg.id)) fail('package id')
  oneOf(pkg.kind, KINDS, 'package kind')
  if (JSON.stringify(pkg).length > MAX_MANIFEST_BYTES) fail('package size')
  return pkg as unknown as CatalogPackage
}

function limiter(value: unknown): Limiter {
  const raw = record(value, 'limiter')
  return {
    mode: oneOf(raw.mode, ['tokens', 'dollars'] as const, 'limiter mode'),
    tokens: amount(raw.tokens, 'token limit'),
    dollars: amount(raw.dollars, 'dollar limit')
  }
}

function memoryDoc(value: unknown): MemoryDoc {
  const raw = record(value, 'memory doc')
  return {
    id: id(raw.id, 'memory doc id'),
    name: text(raw.name, 'memory doc name'),
    // Sample agents carry docs with no file behind them, which the run reports instead of reading.
    path: raw.path === '' ? '' : absolutePath(raw.path, 'memory doc path'),
    size: amount(raw.size, 'memory doc size')
  }
}

const model = (value: unknown, what: string) => oneOf(value, RUNNABLE_MODELS, what)

function runNode(value: unknown): RunNodeSpec {
  const raw = record(value, 'agent')
  return {
    id: id(raw.id, 'agent id'),
    name: text(raw.name, 'agent name'),
    prompt: text(raw.prompt, 'agent prompt', MAX_PROMPT),
    model: model(raw.model, 'agent model'),
    routeAmong: raw.routeAmong === undefined ? undefined : list(raw.routeAmong, model, 'routing pool'),
    limiter: limiter(raw.limiter),
    instructions: list(raw.instructions, (entry, what) => text(entry, what, MAX_PROMPT), 'instructions'),
    mcpServers: list(raw.mcpServers, id, 'MCP servers'),
    skills: list(raw.skills, id, 'skills'),
    memory: list(raw.memory, memoryDoc, 'memory docs')
  }
}

function runRequest(value: unknown): RunRequest {
  const raw = record(value, 'run')
  const nodes = list(raw.nodes, runNode, 'agents')
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) fail('duplicate agents')
  return {
    runId: id(raw.runId, 'run id'),
    goal: text(raw.goal, 'goal', MAX_PROMPT),
    nodes,
    edges: list(
      raw.edges,
      (entry) => {
        const edge = record(entry, 'connection')
        return { source: id(edge.source, 'connection'), target: id(edge.target, 'connection') }
      },
      'connections',
      MAX_ITEMS * MAX_ITEMS
    )
  }
}

const none = (): [] => []
const provider = (value: unknown) => oneOf(value, PROVIDERS, 'provider')
const search = (args: unknown[]): [string, string | undefined, boolean] => [
  text(args[0], 'search'),
  optionalText(args[1], 'cursor'),
  args[2] === true
]

export const validators: { [C in IpcChannel]: (args: unknown[]) => IpcArgs<C> } = {
  'state:load': none,
  'state:save': ([json]) => [text(json, 'state', MAX_STATE_BYTES)],
  'library:download': ([pkg]) => [catalogPackage(pkg)],
  'library:remove': ([pkg]) => [catalogPackage(pkg)],
  'library:reveal': ([path]) => [absolutePath(path, 'path')],
  'docs:pick': none,
  'shell:open': ([url]) => [text(url, 'address')],
  'key:status': none,
  'key:save': ([name, key]) => [provider(name), id(key, 'key', 2000)],
  'key:remove': ([name]) => [provider(name)],
  'run:start': ([request]) => [runRequest(request)],
  'run:stop': ([runId]) => [id(runId, 'run id')],
  'run:inject': ([runId, nodeId, instruction]) => [
    id(runId, 'run id'),
    id(nodeId, 'agent id'),
    text(instruction, 'instruction', MAX_PROMPT)
  ],
  'run:approve': ([runId, approvalId, decision]) => [
    id(runId, 'run id'),
    id(approvalId, 'approval id'),
    oneOf(decision, DECISIONS, 'decision')
  ],
  'mcp:setups': none,
  'mcp:pick-folders': ([multiple]) => [multiple === true],
  'mcp:save-folders': ([server, key, folders]) => [
    id(server, 'server'),
    id(key, 'setting'),
    list(folders, absolutePath, 'folders')
  ],
  'mcp:save-secret': ([server, key, value]) => [id(server, 'server'), id(key, 'setting'), text(value, 'secret', 10_000)],
  'mcp:check': ([server]) => [id(server, 'server')],
  'registry:search': search,
  'registry:install': ([name, version]) => [id(name, 'server name'), id(version, 'version')],
  'registry:remove': ([server]) => [id(server, 'server')],
  'registry:servers': none,
  'clawhub:search': search,
  'clawhub:preview': ([owner, slug]) => [id(owner, 'owner'), id(slug, 'skill')],
  'clawhub:install': ([owner, slug, version, sha256]) => [
    id(owner, 'owner'),
    id(slug, 'skill'),
    id(version, 'version'),
    id(sha256, 'checksum')
  ],
  'clawhub:remove': ([skill]) => [id(skill, 'skill')],
  'clawhub:skills': none
}
