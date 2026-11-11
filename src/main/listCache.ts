import { readFile } from 'node:fs/promises'
import { writeAtomic } from './stateFile'

const MAX_CACHE_BYTES = 5_000_000

interface Options<T> {
  path: () => string
  // Fetches the list exactly as the service sent it.
  fetchRaw: () => Promise<unknown>
  // Turns a raw response into what the app shows. It must treat its input as untrusted.
  parse: (raw: unknown) => T
  // An empty answer is not worth remembering over a good one.
  worthKeeping: (value: T) => boolean
  maxAgeMs: number
  now?: () => number
}

// Remembers the last list a service returned, in memory and on disk, so it can be shown at once and
// refreshed afterwards. The file holds the raw response and goes through the same parser as a live
// one every time it is read, so an edited file is trusted no more than the network is.
export function createListCache<T>({ path, fetchRaw, parse, worthKeeping, maxAgeMs, now = Date.now }: Options<T>) {
  let memory: { value: T; fetchedAt: number } | undefined
  let diskRead = false
  let refreshing: Promise<T> | undefined

  async function readDisk() {
    if (diskRead) return
    diskRead = true
    try {
      const text = await readFile(path(), 'utf8')
      if (text.length > MAX_CACHE_BYTES) return
      const saved = JSON.parse(text) as { savedAt?: unknown; raw?: unknown }
      const value = parse(saved.raw)
      if (!worthKeeping(value)) return
      const savedAt = typeof saved.savedAt === 'number' && saved.savedAt <= now() ? saved.savedAt : 0
      memory ??= { value, fetchedAt: savedAt }
    } catch {
      // No file yet, or one that cannot be read. Either way the list comes from the network.
    }
  }

  function refresh() {
    refreshing ??= (async () => {
      try {
        const raw = await fetchRaw()
        const value = parse(raw)
        if (worthKeeping(value)) {
          memory = { value, fetchedAt: now() }
          await writeAtomic(path(), JSON.stringify({ savedAt: memory.fetchedAt, raw })).catch(() => {})
        }
        return value
      } finally {
        refreshing = undefined
      }
    })()
    return refreshing
  }

  const isStale = () => !memory || now() - memory.fetchedAt > maxAgeMs

  return {
    refresh,

    // The remembered list if there is one, however old, and whether it is due a refresh.
    async read(): Promise<{ value: T; stale: boolean }> {
      await readDisk()
      if (memory) return { value: memory.value, stale: isStale() }
      return { value: await refresh(), stale: false }
    },

    // Called at launch so the list is ready before anyone opens its tab.
    async warm() {
      await readDisk()
      if (isStale()) await refresh().catch(() => {})
    }
  }
}
