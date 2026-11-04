// ClawHub is an open registry that has hosted malware before, so everything it returns is
// treated as untrusted: names are validated, text is clipped, and a skill can only be installed
// as one exact version that ClawHub's scans marked clean.

export const CLAWHUB_SITE = 'https://clawhub.ai'

const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const EXACT_VERSION = /^[0-9][0-9A-Za-z.+-]{0,63}$/
const SHA256 = /^[0-9a-f]{64}$/
const MAX_TEXT = 500

export interface ClawHubEntry {
  owner: string
  slug: string
  name: string
  summary: string
  downloads: number
  url: string
}

// What the install dialog shows, so the person sees exactly what an agent would read.
export interface ClawHubPreview {
  entry: ClawHubEntry
  version: string
  license: string
  sha256: string
  text: string
  otherFiles: string[]
  warnings: string[]
}

export interface InstalledClawHubSkill {
  id: string
  owner: string
  slug: string
  name: string
  summary: string
  version: string
  license: string
  sha256: string
  url: string
}

type Raw = Record<string, unknown>

const record = (value: unknown): Raw => (typeof value === 'object' && value !== null ? (value as Raw) : {})
const text = (value: unknown) => (typeof value === 'string' ? value.slice(0, MAX_TEXT) : '')
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

export const isHandle = (value: unknown): value is string => typeof value === 'string' && HANDLE.test(value)
export const isVersion = (value: unknown): value is string => typeof value === 'string' && EXACT_VERSION.test(value)
export const isSha256 = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value)

// Links only ever point at ClawHub itself.
export function clawhubPageUrl(owner: string, slug: string, canonical?: unknown) {
  if (typeof canonical === 'string') {
    try {
      const url = new URL(canonical, CLAWHUB_SITE)
      if (url.origin === CLAWHUB_SITE) return url.toString()
    } catch {
      // Falls back to the documented page address.
    }
  }
  return `${CLAWHUB_SITE}/${encodeURIComponent(owner)}/skills/${encodeURIComponent(slug)}`
}

// Reads both search results and the browse listing, which describe skills differently.
export function parseClawHubEntries(raw: unknown): ClawHubEntry[] {
  const body = record(raw)
  const items = Array.isArray(body.results) ? body.results : Array.isArray(body.items) ? body.items : []
  const entries: ClawHubEntry[] = []
  const seen = new Set<string>()

  for (const item of items.map(record)) {
    const skill = record(record(item.native).skill)
    const owner = item.ownerHandle ?? record(item.owner).handle
    const slug = item.slug ?? skill.slug
    if (!isHandle(owner) || !isHandle(slug) || seen.has(`${owner}/${slug}`)) continue
    if (skill.isSuspicious === true) continue
    seen.add(`${owner}/${slug}`)

    entries.push({
      owner,
      slug,
      name: text(item.displayName) || slug,
      summary: text(item.summary ?? skill.summary),
      downloads: count(item.downloads ?? record(item.stats).downloads ?? record(skill.stats).downloads),
      url: clawhubPageUrl(owner, slug, item.canonicalUrl)
    })
  }
  return entries
}
