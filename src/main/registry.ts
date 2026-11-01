import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseRegistryEntry, type InstalledRegistryServer, type RegistryEntry } from '../shared/registry'

const REGISTRY_URL = process.env.EXECUTOR_REGISTRY_URL ?? 'https://registry.modelcontextprotocol.io'
const PAGE_SIZE = 30
const REQUEST_TIMEOUT_MS = 15_000

const storePath = () => join(app.getPath('userData'), 'registry-servers.json')

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`The MCP registry returned ${response.status}.`)
  return (await response.json()) as unknown
}

export async function searchRegistry(query: string, cursor?: string) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), version: 'latest' })
  if (query) params.set('search', query)
  if (cursor) params.set('cursor', cursor)

  const page = (await fetchJson(`${REGISTRY_URL}/v0.1/servers?${params}`)) as {
    servers?: unknown[]
    metadata?: { nextCursor?: string }
  }
  const entries = (page.servers ?? []).flatMap((raw) => parseRegistryEntry(raw) ?? [])
  return { entries, nextCursor: page.metadata?.nextCursor ?? null }
}

export async function installedServers(): Promise<Record<string, InstalledRegistryServer>> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf8')) as Record<string, InstalledRegistryServer>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

const serverId = (name: string) => `reg-${createHash('sha256').update(name).digest('hex').slice(0, 10)}`

// Reads the entry from the registry again, so what the interface sent cannot change what runs.
export async function installServer(name: string, version: string) {
  const path = `${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}`
  const entry: RegistryEntry | null = parseRegistryEntry(await fetchJson(`${REGISTRY_URL}/v0.1/servers/${path}`))
  if (!entry?.spec) throw new Error(entry?.unsupported ?? 'That server could not be read from the registry.')

  const id = serverId(entry.name)
  const server: InstalledRegistryServer = { id, entry, spec: { ...entry.spec, id, trustHints: false } }
  const servers = await installedServers()
  await writeFile(storePath(), JSON.stringify({ ...servers, [id]: server }, null, 2))
  return server
}

export async function removeServer(id: string) {
  const { [id]: _removed, ...servers } = await installedServers()
  await writeFile(storePath(), JSON.stringify(servers, null, 2))
}
