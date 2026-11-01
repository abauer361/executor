import type { McpServerSpec, McpSetting } from './mcpServers'

// Registry data is untrusted, so commands are built here from validated fields.
// Runtime arguments, runtime hints and other free-form launch fields are never used.

const NPM_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const PYPI_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const EXACT_VERSION = /^[0-9][0-9A-Za-z.+_-]*$/
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/
const HEADER_NAME = /^[A-Za-z0-9-]+$/
const MAX_TEXT = 500

// Setting any of these could change what actually runs.
const PROTECTED_ENV = /^(PATH|HOME|SHELL|USER|NODE_OPTIONS|NODE_PATH|NODE_EXTRA_CA_CERTS|NPM_CONFIG_.*|PYTHON.*|UV_.*|LD_.*|DYLD_.*|ANTHROPIC_.*|EXECUTOR_.*)$/
const PROTECTED_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cookie'])

export type RegistrySource = 'remote' | 'npm' | 'pypi'

export interface RegistryEntry {
  name: string
  title: string
  description: string
  version: string
  repository?: string
  source?: RegistrySource
  target?: string
  deprecated: boolean
  settings: McpSetting[]
  unsupported?: string
  spec?: Omit<McpServerSpec, 'id'>
}

export interface InstalledRegistryServer {
  id: string
  entry: RegistryEntry
  spec: McpServerSpec
}

type Raw = Record<string, unknown>

const asRecords = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is Raw => typeof item === 'object' && item !== null) : []

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : fallback)

function httpsUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

function parseRemote(remote: Raw) {
  if (typeof remote.url === 'string' && remote.url.includes('{')) {
    return { unsupported: 'Its address needs custom values, which are not supported yet' }
  }
  const url = httpsUrl(remote.url)
  if (!url) return { unsupported: 'Its address is not a secure https address' }

  const settings: McpSetting[] = []
  for (const header of asRecords(remote.headers)) {
    if (header.isRequired !== true) continue
    const name = text(header.name)
    if (!HEADER_NAME.test(name) || PROTECTED_HEADERS.has(name.toLowerCase())) {
      return { unsupported: 'It asks for a header that is not allowed' }
    }
    settings.push({ key: name, label: text(header.description, name) || name, kind: 'header' })
  }

  return { source: 'remote' as const, target: url, settings, spec: { command: '', args: [], settings, remoteUrl: url } }
}

function parsePackage(pkg: Raw) {
  const type = pkg.registryType
  if (type !== 'npm' && type !== 'pypi') return { unsupported: `${String(type)} packages are not supported yet` }
  if ((pkg.transport as Raw | undefined)?.type !== 'stdio') return { unsupported: 'This transport is not supported yet' }

  const identifier = text(pkg.identifier)
  const version = text(pkg.version)
  if (!(type === 'npm' ? NPM_NAME : PYPI_NAME).test(identifier)) return { unsupported: 'Its package name is not valid' }
  if (!EXACT_VERSION.test(version)) return { unsupported: 'It does not pin an exact version' }
  if (asRecords(pkg.packageArguments).some((argument) => argument.isRequired === true)) {
    return { unsupported: 'It needs custom arguments, which are not supported yet' }
  }

  const settings: McpSetting[] = []
  for (const variable of asRecords(pkg.environmentVariables)) {
    if (variable.isRequired !== true) continue
    const name = text(variable.name)
    if (!ENV_NAME.test(name) || PROTECTED_ENV.test(name)) return { unsupported: 'It asks for a protected setting' }
    settings.push({ key: name, label: text(variable.description, name) || name, kind: 'secret' })
  }

  const target = `${identifier}@${version}`
  return {
    source: type as RegistrySource,
    target,
    settings,
    spec:
      type === 'npm'
        ? { command: 'npx', args: ['-y', target], settings }
        : { command: 'uvx', args: [`${identifier}==${version}`], settings }
  }
}

function chooseLaunch(server: Raw) {
  const remotes = asRecords(server.remotes)
  const packages = asRecords(server.packages)

  // A remote server runs no code on this Mac, so it is preferred when both exist.
  const remote = remotes.find((candidate) => candidate.type === 'streamable-http')
  const parsedRemote = remote && parseRemote(remote)
  if (parsedRemote && !('unsupported' in parsedRemote)) return parsedRemote

  const parsed = packages.map(parsePackage)
  const usable = parsed.find((candidate) => !('unsupported' in candidate))
  if (usable) return usable

  const reason = parsedRemote?.unsupported ?? parsed[0]?.unsupported
  return { unsupported: reason ?? (remotes.length ? 'This transport is not supported yet' : 'It has nothing to install') }
}

export function parseRegistryEntry(raw: unknown): RegistryEntry | null {
  const record = raw as Raw | null
  const server = record?.server as Raw | undefined
  const name = text(server?.name)
  const version = text(server?.version)
  if (!server || !name || !version) return null

  const official = (record?._meta as Raw | undefined)?.['io.modelcontextprotocol.registry/official'] as Raw | undefined
  const launch = chooseLaunch(server)
  const repository = httpsUrl((server.repository as Raw | undefined)?.url) ?? undefined

  return {
    name,
    title: text(server.title) || name.split('/').pop() || name,
    description: text(server.description),
    version,
    repository,
    deprecated: official?.status === 'deprecated',
    settings: 'settings' in launch ? (launch.settings ?? []) : [],
    ...launch
  }
}
