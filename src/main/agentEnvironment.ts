import { app } from 'electron'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { McpCheckResult, RunNodeSpec } from '../shared/types'
import { launchFor } from './mcpSetup'
import { openConnection, type McpConnection } from './mcpConnection'
import type { AgentContext, AgentEnvironment, AgentTool } from './runEngine'
import { shellPath } from './shellPath'

const SKILLS_URL = 'https://raw.githubusercontent.com/anthropics/skills/main/skills'
const MAX_SKILL_BYTES = 1_000_000
const MAX_DOCUMENT_BYTES = 500_000

const skillPath = (id: string) => join(app.getPath('userData'), 'library', 'skill', id, 'SKILL.md')

function assertSkillId(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Invalid skill: ${id}`)
}

export async function downloadSkill(id: string) {
  assertSkillId(id)
  const response = await fetch(`${SKILLS_URL}/${id}/SKILL.md`)
  if (!response.ok) throw new Error(`Could not download ${id}: ${response.status}`)
  const text = await response.text()
  if (text.length > MAX_SKILL_BYTES) throw new Error(`${id} is too large to use.`)

  const path = skillPath(id)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return text
}

export function removeSkill(id: string) {
  assertSkillId(id)
  return rm(dirname(skillPath(id)), { recursive: true, force: true })
}

async function loadSkill(id: string) {
  assertSkillId(id)
  try {
    return await readFile(skillPath(id), 'utf8')
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

export async function checkServer(id: string): Promise<McpCheckResult> {
  try {
    const connection = await openConnection(id, await launchFor(id), await shellPath())
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
      const path = await shellPath()

      await Promise.all(
        ids.map(async (id) => {
          try {
            connections.set(id, await openConnection(id, await launchFor(id), path))
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

      for (const id of node.skills) {
        try {
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
