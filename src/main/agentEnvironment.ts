import { app } from 'electron'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { checkSkillFile, skillFileUrl, skillSource } from '../shared/skills'
import type { InstalledClawHubSkill } from '../shared/clawhub'
import type { McpCheckResult, RunNodeSpec } from '../shared/types'
import { clawhubFileUrl, installedClawHubSkills, recheckClawHubSkill } from './clawhub'
import { installedServers } from './registry'
import { launchFor } from './mcpSetup'
import { openConnection, type McpConnection } from './mcpConnection'
import type { AgentContext, AgentEnvironment, AgentTool } from './runEngine'
import { shellPath } from './shellPath'

const MAX_DOCUMENT_BYTES = 500_000

const skillPath = (id: string) => join(app.getPath('userData'), 'library', 'skill', id, 'SKILL.md')

function assertSkillId(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid skill: ${id}`)
}

// Every skill is pinned: either reviewed into the built-in list, or installed from ClawHub as one exact version.
async function pinnedSkill(id: string) {
  const listed = skillSource(id)
  if (listed) return { name: listed.name, sha256: listed.sha256, url: skillFileUrl(listed) }
  const installed = (await installedClawHubSkills())[id]
  if (installed) return { name: installed.name, sha256: installed.sha256, url: clawhubFileUrl(installed) }
  throw new Error(`${id} is not a reviewed or installed skill`)
}

export async function downloadSkill(id: string) {
  const skill = await pinnedSkill(id)
  const response = await fetch(skill.url)
  if (!response.ok) throw new Error(`Could not download ${skill.name}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const text = await checkSkillFile(skill, bytes)

  const path = skillPath(id)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes)
  return text
}

export function removeSkill(id: string) {
  assertSkillId(id)
  return rm(dirname(skillPath(id)), { recursive: true, force: true })
}

// A saved copy is used only if it still matches the reviewed version. Older or edited copies
// are replaced by downloading the pinned one again.
async function loadSkill(id: string) {
  const skill = await pinnedSkill(id)
  try {
    return await checkSkillFile(skill, new Uint8Array(await readFile(skillPath(id))))
  } catch {
    return downloadSkill(id)
  }
}

async function loadDocument(path: string, name: string) {
  if (!path) throw new Error(`${name} is a sample with no file behind it`)
  const { size } = await stat(path)
  if (size > MAX_DOCUMENT_BYTES) throw new Error(`${name} is over 500 KB, so it was not sent`)
  const text = await readFile(path, 'utf8')
  if (text.includes('\u0000')) throw new Error(`${name} is not a text file, so it was not sent`)
  return text
}

async function connectServer(id: string) {
  const { spec, launch } = await launchFor(id)
  const registry = (await installedServers())[id]
  return openConnection(id, launch, {
    path: await shellPath(),
    label: registry?.entry.title,
    trustHints: spec.trustHints ?? true
  })
}

export async function checkServer(id: string): Promise<McpCheckResult> {
  try {
    const connection = await connectServer(id)
    const tools = connection.tools.length
    await connection.close()
    return { ok: true, tools }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function createAgentEnvironment(): AgentEnvironment {
  const connections = new Map<string, McpConnection>()

  return {
    async prepare(nodes, log) {
      const ids = [...new Set(nodes.flatMap((node) => node.mcpServers))]
      if (ids.length === 0) return

      await Promise.all(
        ids.map(async (id) => {
          try {
            connections.set(id, await connectServer(id))
            log(`Connected ${id}`)
          } catch (error) {
            log(`Could not start ${id}: ${error instanceof Error ? error.message : String(error)}`)
          }
        })
      )
    },

    toolsFor(node: RunNodeSpec): AgentTool[] {
      return node.mcpServers.flatMap((id) => connections.get(id)?.tools ?? [])
    },

    async contextFor(node): Promise<AgentContext> {
      const context: AgentContext = { skills: [], documents: [], warnings: [] }

      const fromClawHub = await installedClawHubSkills().catch((): Record<string, InstalledClawHubSkill> => ({}))
      for (const id of node.skills) {
        try {
          const installed = fromClawHub[id]
          const warning = installed && (await recheckClawHubSkill(installed))
          if (warning) context.warnings.push(warning)
          context.skills.push({ name: id, text: await loadSkill(id) })
        } catch (error) {
          context.warnings.push(`Skill ${id} is unavailable: ${error instanceof Error ? error.message : error}`)
        }
      }
      for (const doc of node.memory) {
        try {
          context.documents.push({ name: doc.name, text: await loadDocument(doc.path, doc.name) })
        } catch (error) {
          context.warnings.push(error instanceof Error ? error.message : String(error))
        }
      }
      return context
    },

    async close() {
      await Promise.allSettled([...connections.values()].map((connection) => connection.close()))
      connections.clear()
    }
  }
}
