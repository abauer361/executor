import type { Preferences, RunRecord } from './account'
import type { Agent, DownloadRecord, Project } from './types'

export type Theme = 'dark' | 'light'

// Bump when the saved shape changes in a way older code cannot read.
export const STATE_VERSION = 1

export interface Persisted {
  version?: number
  projects: Project[]
  agents: Agent[]
  downloads: Record<string, DownloadRecord>
  activeProjectId: string
  theme: Theme
  // Added later, so files saved before them simply do not have them.
  runs?: RunRecord[]
  preferences?: Preferences
}

type Raw = Record<string, unknown>

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string'

const isNode = (value: unknown) =>
  isRecord(value) && isText(value.id) && isRecord(value.position) && isRecord(value.data) && isText(value.data.agentId)

const isEdge = (value: unknown) => isRecord(value) && isText(value.id) && isText(value.source) && isText(value.target)

const isWorkflow = (value: unknown) =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.name) &&
  Array.isArray(value.nodes) &&
  value.nodes.every(isNode) &&
  Array.isArray(value.edges) &&
  value.edges.every(isEdge) &&
  Array.isArray(value.log)

const isProject = (value: unknown) =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.name) &&
  Array.isArray(value.workflows) &&
  value.workflows.length > 0 &&
  value.workflows.every(isWorkflow)

const isAgent = (value: unknown) =>
  isRecord(value) &&
  isText(value.id) &&
  isText(value.name) &&
  Array.isArray(value.models) &&
  Array.isArray(value.mcpServers) &&
  Array.isArray(value.skills) &&
  Array.isArray(value.memory) &&
  isRecord(value.limiter)

// Checks only what the app would crash without. Anything else is repaired or defaulted on load.
export function isPersisted(value: unknown): value is Persisted {
  if (!isRecord(value)) return false
  if (value.version !== undefined && (typeof value.version !== 'number' || value.version > STATE_VERSION)) return false
  return (
    Array.isArray(value.projects) &&
    value.projects.length > 0 &&
    value.projects.every(isProject) &&
    Array.isArray(value.agents) &&
    value.agents.every(isAgent) &&
    isRecord(value.downloads) &&
    isText(value.activeProjectId)
  )
}

export function parsePersisted(json: string): Persisted | null {
  try {
    const value: unknown = JSON.parse(json)
    return isPersisted(value) ? value : null
  } catch {
    return null
  }
}
