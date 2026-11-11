import { useEffect, useRef, useState } from 'react'
import type { ClawHubEntry } from '../../../shared/clawhub'
import type { RegistryEntry } from '../../../shared/registry'
import type { BrowsePage } from '../../../shared/types'
import { bridge } from '../bridge'

const SEARCH_DELAY_MS = 300

export interface BrowseSource<T> {
  key: string
  search(query: string, cursor?: string, fresh?: boolean): Promise<BrowsePage<T>>
  unreachable: string
}

export const REGISTRY_SOURCE: BrowseSource<RegistryEntry> = {
  key: 'registry',
  search: (query, cursor, fresh) => bridge.searchRegistry(query, cursor, fresh),
  unreachable: 'The MCP registry could not be reached.'
}

export const CLAWHUB_SOURCE: BrowseSource<ClawHubEntry> = {
  key: 'clawhub',
  search: (query, cursor, fresh) => bridge.searchClawHub(query, cursor, fresh),
  unreachable: 'ClawHub could not be reached. Check your connection and try again.'
}

// The list each tab shows with nothing typed, kept so the tab can draw it on its first frame.
const remembered = new Map<string, BrowsePage<unknown>>()

// Loads the opening list, then replaces it with a newer one if main said it was out of date.
async function loadOpening<T>(source: BrowseSource<T>, show: (page: BrowsePage<T>) => void) {
  const page = await source.search('')
  remembered.set(source.key, page)
  show(page)
  if (!page.stale) return
  const fresh = await source.search('', undefined, true).catch(() => null)
  if (!fresh) return
  remembered.set(source.key, fresh)
  show(fresh)
}

// Called once at launch, so both lists are already here when a tab is first opened.
export function preloadBrowsing() {
  void loadOpening(REGISTRY_SOURCE, () => {}).catch(() => {})
  void loadOpening(CLAWHUB_SOURCE, () => {}).catch(() => {})
}

export function useBrowse<T>(source: BrowseSource<T>, query: string) {
  const opening = () => (query === '' ? (remembered.get(source.key) as BrowsePage<T> | undefined) : undefined)
  const [entries, setEntries] = useState<T[]>(() => opening()?.entries ?? [])
  const [cursor, setCursor] = useState<string | null>(() => opening()?.nextCursor ?? null)
  const [loading, setLoading] = useState(() => !opening())
  const [error, setError] = useState('')
  // Once more pages are added, a late refresh of the first page must not throw them away.
  const extended = useRef(false)

  useEffect(() => {
    let current = true
    extended.current = false
    const known = opening()
    const show = (page: BrowsePage<T>) => {
      if (!current || extended.current) return
      setEntries(page.entries)
      setCursor(page.nextCursor)
      setLoading(false)
    }

    setError('')
    if (known) show(known)
    else setLoading(true)

    // Typing waits for a pause before searching. The opening list has nothing to wait for.
    const timer = setTimeout(
      () => {
        const request = query === '' ? loadOpening(source, show) : source.search(query).then(show)
        request
          .catch(() => current && !known && setError(source.unreachable))
          .finally(() => current && setLoading(false))
      },
      query === '' ? 0 : SEARCH_DELAY_MS
    )

    return () => {
      current = false
      clearTimeout(timer)
    }
    // `opening` reads only the query and the source, so those are the whole dependency list.
  }, [query, source])

  const loadMore = async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const page = await source.search(query, cursor)
      extended.current = true
      setEntries((previous) => [...previous, ...page.entries])
      setCursor(page.nextCursor)
    } catch {
      setError(source.unreachable)
    } finally {
      setLoading(false)
    }
  }

  return { entries, cursor, loading, error, loadMore }
}
