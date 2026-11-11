import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseRegistryEntry, type InstalledRegistryServer, type RegistryEntry } from '../shared/registry'
import type { BrowsePage } from '../shared/types'
import { createListCache } from './listCache'

const REGISTRY_URL = process.env.EXECUTOR_REGISTRY_URL ?? 'https://registry.modelcontextprotocol.io'
const PAGE_SIZE = 30
const REQUEST_TIMEOUT_MS = 15_000
const FIRST_PAGE_MAX_AGE_MS = 5 * 60_000

const storePath = () => join(app.getPath('userData'), 'registry-servers.json')

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (!response.ok) throw new Error(`The MCP registry returned ${response.status}.`)
  return (await response.json()) as unknown
}

function fetchPage(query: string, cursor?: string) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), version: 'latest' })
  if (query) params.set('search', query)
  if (cursor) params.set('cursor', cursor)
  return fetchJson(`${REGISTRY_URL}/v0.1/servers?${params}`)
}

function parsePage(raw: unknown): BrowsePage<RegistryEntry> {
  const page = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    servers?: unknown
    metadata?: { nextCursor?: unknown }
  }
  const servers = Array.isArray(page.servers) ? page.servers : []
  const nextCursor = page.metadata?.nextCursor
  return {
    entries: servers.flatMap((server) => parseRegistryEntry(server) ?? []),
    nextCursor: typeof nextCursor === 'string' ? nextCursor : null
  }
}

// The list shown when the tab opens with nothing typed. It is remembered so the tab fills in at once.
const firstPage = createListCache({
  path: () => join(app.getPath('userData'), 'listings', 'registry-first-page.json'),
  fetchRaw: () => fetchPage(''),
  parse: parsePage,
  worthKeeping: (page) => page.entries.length > 0,
  maxAgeMs: FIRST_PAGE_MAX_AGE_MS
})

export const warmRegistry = () => firstPage.warm()

// `fresh` skips the remembered list, for the refresh that follows showing it.
export async function searchRegistry(query: string, cursor?: string, fresh = false): Promise<BrowsePage<RegistryEntry>> {
  if (query || cursor) return parsePage(await fetchPage(query, cursor))
  if (fresh) return firstPage.refresh()
  const { value, stale } = await firstPage.read()
  return { ...value, stale }
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
