import { app } from 'electron'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CLAWHUB_SITE,
  clawhubPageUrl,
  isHandle,
  isSha256,
  isVersion,
  parseClawHubEntries,
  type ClawHubEntry,
  type ClawHubPreview,
  type InstalledClawHubSkill
} from '../shared/clawhub'
import { checkSkillFile } from '../shared/skills'

const CLAWHUB_URL = process.env.EXECUTOR_CLAWHUB_URL ?? CLAWHUB_SITE
const PAGE_SIZE = 30
const REQUEST_TIMEOUT_MS = 15_000
const SKILL_FILE = 'SKILL.md'
const MAX_SKILL_BYTES = 1_000_000

const storePath = () => join(app.getPath('userData'), 'clawhub-skills.json')

type Raw = Record<string, unknown>
const record = (value: unknown): Raw => (typeof value === 'object' && value !== null ? (value as Raw) : {})

// ClawHub said no, as opposed to ClawHub being unreachable.
export class ClawHubRefusal extends Error {}

async function request(path: string, params: Record<string, string>) {
  const url = new URL(`/api/v1/${path}`, CLAWHUB_URL)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (response.status === 404 || response.status === 410) throw new ClawHubRefusal('ClawHub no longer offers that skill.')
  if (!response.ok) throw new Error(`ClawHub returned ${response.status}.`)
  return response
}

const fetchJson = async (path: string, params: Record<string, string> = {}) =>
  (await (await request(path, params)).json()) as unknown

export async function searchClawHub(query: string, cursor?: string) {
  const q = query.trim().slice(0, 200)
  const body = q
    ? await fetchJson('search', { q, limit: String(PAGE_SIZE), nonSuspiciousOnly: 'true' })
    : await fetchJson('skills', {
        limit: String(PAGE_SIZE),
        sort: 'downloads',
        nonSuspiciousOnly: 'true',
        ...(cursor ? { cursor } : {})
      })
  const next = q ? null : record(body).nextCursor
  return { entries: parseClawHubEntries(body), nextCursor: typeof next === 'string' ? next : null }
}

function refusalForScan(status: unknown) {
  if (status === 'pending') return "ClawHub hasn't finished scanning this version yet. Try again later."
  if (status === 'suspicious' || status === 'malicious') {
    return `ClawHub's scans mark this version ${status}, so it cannot be installed.`
  }
  return "This version has no clean result from ClawHub's scans, so it cannot be installed."
}

function scannerWarnings(scanners: unknown) {
  return Object.entries(record(scanners)).flatMap(([name, value]) => {
    const status = typeof value === 'string' ? value : record(value).status
    return typeof status === 'string' && status !== 'clean'
      ? [`ClawHub's ${name} scanner rated it ${status.slice(0, 40)}.`]
      : []
  })
}

interface CheckedVersion {
  entry: ClawHubEntry
  version: string
  license: string
  sha256: string
  otherFiles: string[]
  warnings: string[]
}

// Reads the skill and one version straight from ClawHub, and refuses anything its scans do not mark clean.
async function checkVersion(owner: string, slug: string, version?: string): Promise<CheckedVersion> {
  if (!isHandle(owner) || !isHandle(slug)) throw new ClawHubRefusal('That is not a valid ClawHub skill.')
  const scope = { ownerHandle: owner }
  const detail = record(await fetchJson(`skills/${encodeURIComponent(slug)}`, scope))
  const moderation = record(detail.moderation)
  if (moderation.isMalwareBlocked === true || moderation.isSuspicious === true || (moderation.verdict ?? 'clean') !== 'clean') {
    throw new ClawHubRefusal('ClawHub flags this skill, so it cannot be installed.')
  }

  const chosen = version ?? record(detail.latestVersion).version
  if (!isVersion(chosen)) throw new ClawHubRefusal('That skill has no version that can be installed.')
  const body = record(
    await fetchJson(`skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(chosen)}`, scope)
  )
  const details = record(body.version)
  const security = record(details.security)
  if (security.status !== 'clean' || security.hasScanResult !== true) {
    throw new ClawHubRefusal(refusalForScan(security.status))
  }

  const files = (Array.isArray(details.files) ? details.files : []).map(record)
  const skillFile = files.find((file) => file.path === SKILL_FILE)
  if (!skillFile || !isSha256(skillFile.sha256)) throw new ClawHubRefusal('That version has no SKILL.md to install.')
  if (typeof skillFile.size === 'number' && skillFile.size > MAX_SKILL_BYTES) {
    throw new ClawHubRefusal('That skill is too large to use.')
  }

  const skill = record(detail.skill)
  const stats = record(skill.stats)
  return {
    entry: {
      owner,
      slug,
      name: typeof skill.displayName === 'string' ? skill.displayName.slice(0, 200) : slug,
      summary: typeof skill.summary === 'string' ? skill.summary.slice(0, 500) : '',
      downloads: typeof stats.downloads === 'number' ? stats.downloads : 0,
      url: clawhubPageUrl(owner, slug)
    },
    version: chosen,
    license: typeof details.license === 'string' && details.license ? details.license.slice(0, 60) : 'Not stated',
    sha256: skillFile.sha256,
    otherFiles: files.flatMap((file) => (file !== skillFile && typeof file.path === 'string' ? [file.path.slice(0, 200)] : [])),
    warnings: scannerWarnings(security.scanners)
  }
}

export const clawhubFileUrl = (skill: Pick<InstalledClawHubSkill, 'owner' | 'slug' | 'version'>) => {
  const url = new URL(`/api/v1/skills/${encodeURIComponent(skill.slug)}/file`, CLAWHUB_URL)
  url.search = new URLSearchParams({ path: SKILL_FILE, version: skill.version, ownerHandle: skill.owner }).toString()
  return url.toString()
}

async function fetchSkillText(checked: CheckedVersion) {
  const response = await request(`skills/${encodeURIComponent(checked.entry.slug)}/file`, {
    path: SKILL_FILE,
    version: checked.version,
    ownerHandle: checked.entry.owner
  })
  const text = await checkSkillFile(
    { name: checked.entry.name, sha256: checked.sha256 },
    new Uint8Array(await response.arrayBuffer())
  )
  if (text.includes('\u0000')) throw new ClawHubRefusal('That skill is not a text file.')
  return text
}

export async function previewClawHubSkill(owner: string, slug: string): Promise<ClawHubPreview> {
  const checked = await checkVersion(owner, slug)
  const { sha256, version, license, otherFiles, warnings, entry } = checked
  return { entry, version, license, sha256, otherFiles, warnings, text: await fetchSkillText(checked) }
}

export async function installedClawHubSkills(): Promise<Record<string, InstalledClawHubSkill>> {
  try {
    return JSON.parse(await readFile(storePath(), 'utf8')) as Record<string, InstalledClawHubSkill>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

const skillId = (owner: string, slug: string) =>
  `ch-${createHash('sha256').update(`${owner}/${slug}`).digest('hex').slice(0, 10)}`

// Checks the version again in this process and installs it only if it is still exactly what was shown.
export async function installClawHubSkill(owner: string, slug: string, version: string, sha256: string) {
  if (!isVersion(version) || !isSha256(sha256)) throw new ClawHubRefusal('That is not a valid ClawHub version.')
  const checked = await checkVersion(owner, slug, version)
  if (checked.sha256 !== sha256) {
    throw new ClawHubRefusal('This skill changed after you reviewed it. Open it again to review the new text.')
  }

  const id = skillId(owner, slug)
  const { entry, license } = checked
  const skill: InstalledClawHubSkill = { id, owner, slug, name: entry.name, summary: entry.summary, version, license, sha256, url: entry.url }
  const skills = await installedClawHubSkills()
  await writeFile(storePath(), JSON.stringify({ ...skills, [id]: skill }, null, 2))
  return skill
}

export async function removeClawHubSkill(id: string) {
  const { [id]: _removed, ...skills } = await installedClawHubSkills()
  await writeFile(storePath(), JSON.stringify(skills, null, 2))
}

// Run-time check, because ClawHub can flag a version after it was installed. Returns a warning when
// ClawHub cannot be reached, and throws when ClawHub now refuses the version.
export async function recheckClawHubSkill(skill: InstalledClawHubSkill) {
  try {
    const checked = await checkVersion(skill.owner, skill.slug, skill.version)
    if (checked.sha256 !== skill.sha256) throw new ClawHubRefusal('ClawHub now lists different text for this version.')
    return null
  } catch (error) {
    if (error instanceof ClawHubRefusal) throw error
    return `Could not reach ClawHub to recheck ${skill.name}, so the reviewed copy was used.`
  }
}
