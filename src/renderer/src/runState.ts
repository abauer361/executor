import { PROVIDER_LABEL, providerOf, spendCeiling, type Provider } from '../../shared/pricing'
import { MCP_SERVERS, missingSettings, type McpServerSpec, type McpStoredSetup } from '../../shared/mcpServers'
import type { InstalledRegistryServer } from '../../shared/registry'
import type { RunRecord } from '../../shared/account'
import { hasCycle } from '../../shared/runGraph'
import type {
  Agent,
  DownloadRecord,
  Project,
  RunEvent,
  RunOutcome,
  RunRequest,
  Workflow,
  WorkflowNode
} from '../../shared/types'
import {
  appendLog,
  AUTO_MODEL,
  formatDollars,
  formatTokens,
  logEntry,
  routableModels,
  runnableModel,
  totalCost,
  totalTokens
} from './usage'

const OUTCOME_MESSAGE: Record<RunOutcome, string> = {
  completed: 'Run completed',
  stopped: 'Run stopped',
  halted: 'Run ended early because an agent reached its limit',
  failed: 'Run failed'
}

const agentFor = (node: WorkflowNode, agents: Agent[]) =>
  agents.find((candidate) => candidate.id === node.data.agentId)

const ALL_KEYS: Record<Provider, boolean> = { anthropic: true, openai: true, google: true }

export function runProblems(workflow: Workflow, agents: Agent[], keys: Record<Provider, boolean> = ALL_KEYS) {
  const problems: string[] = []
  const ids = workflow.nodes.map((node) => node.id)
  if (hasCycle(ids, workflow.edges)) {
    problems.push('This workflow has a loop. Remove a connection so every agent has a clear order.')
  }
  for (const node of workflow.nodes) {
    const agent = agentFor(node, agents)
    if (!agent) {
      problems.push('An agent on this canvas no longer exists.')
      continue
    }
    const model = runnableModel(agent, node.data.activeModel)
    const provider = node.data.activeModel === AUTO_MODEL ? 'anthropic' : model && providerOf(model)
    if (!provider) problems.push(`${agent.name} has no connected model.`)
    else if (!keys[provider]) problems.push(`${agent.name} needs your ${PROVIDER_LABEL[provider]} API key.`)
  }
  return [...new Set(problems)]
}

export type ServerState = 'not-downloaded' | 'needs-setup' | 'ready'

type RegistryServers = Record<string, InstalledRegistryServer>

export const serverSpec = (id: string, registry: RegistryServers = {}): McpServerSpec | undefined =>
  MCP_SERVERS[id] ?? registry[id]?.spec

export function serverState(
  id: string,
  downloads: Record<string, DownloadRecord>,
  setups: Record<string, McpStoredSetup>,
  registry: RegistryServers = {}
): ServerState {
  const spec = serverSpec(id, registry)
  if (!spec || !downloads[id]) return 'not-downloaded'
  const setup = setups[id] ?? { folders: {}, secrets: [] }
  return missingSettings(spec, setup).length ? 'needs-setup' : 'ready'
}

// Servers an agent cannot use yet. The run still goes ahead without them.
export function runWarnings(
  workflow: Workflow,
  agents: Agent[],
  downloads: Record<string, DownloadRecord>,
  setups: Record<string, McpStoredSetup>,
  registry: RegistryServers = {}
) {
  const unavailable = new Set(
    workflow.nodes
      .flatMap((node) => agentFor(node, agents)?.mcpServers ?? [])
      .filter((id) => serverState(id, downloads, setups, registry) !== 'ready')
  )
  return [...unavailable]
}

// The most this run could cost if every agent used its full limit.
export function runSpendCeiling(workflow: Workflow, agents: Agent[]) {
  return workflow.nodes.reduce((sum, node) => {
    const agent = agentFor(node, agents)
    if (!agent) return sum
    const pool = node.data.activeModel === AUTO_MODEL ? routableModels(agent) : [runnableModel(agent, node.data.activeModel)]
    const ceilings = pool.flatMap((model) => (model ? [spendCeiling(agent.limiter, model)] : []))
    return sum + Math.max(0, ...ceilings)
  }, 0)
}

export function buildRunRequest(workflow: Workflow, agents: Agent[], goal: string, runId: string): RunRequest {
  return {
    runId,
    goal,
    edges: workflow.edges.map(({ source, target }) => ({ source, target })),
    nodes: workflow.nodes.flatMap((node) => {
      const agent = agentFor(node, agents)
      const model = agent && runnableModel(agent, node.data.activeModel)
      if (!agent || !model) return []
      return [
        {
          id: node.id,
          name: agent.name,
          prompt: agent.prompt,
          model,
          routeAmong: node.data.activeModel === AUTO_MODEL ? routableModels(agent) : undefined,
          limiter: agent.limiter,
          instructions: node.data.instructions ?? [],
          mcpServers: agent.mcpServers,
          skills: agent.skills,
          memory: agent.memory
        }
      ]
    })
  }
}

export function prepareRun(workflow: Workflow, goal: string, runId: string): Workflow {
  return {
    ...workflow,
    goal,
    runId,
    running: true,
    sample: false,
    outcome: undefined,
    note: undefined,
    approvals: [],
    lastRunAt: Date.now(),
    log: appendLog(workflow.log, [logEntry(null, workflow.name, `Run started: ${goal}`)]),
    nodes: workflow.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        status: 'queued',
        task: 'Queued',
        tokensUsed: 0,
        costUsed: 0,
        routedModel: undefined,
        output: '',
        instructions: []
      }
    }))
  }
}

// Returns the same workflow when nothing would change, so nothing redraws.
function patchNode(workflow: Workflow, nodeId: string, patch: Partial<WorkflowNode['data']>): Workflow {
  const current = workflow.nodes.find((node) => node.id === nodeId)
  const keys = Object.keys(patch) as (keyof WorkflowNode['data'])[]
  if (!current || keys.every((key) => current.data[key] === patch[key])) return workflow
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => (node === current ? { ...node, data: { ...node.data, ...patch } } : node))
  }
}

function finishRun(workflow: Workflow, outcome: RunOutcome, message?: string): Workflow {
  const senders = new Set(workflow.edges.map((edge) => edge.source))
  const lastNode = workflow.nodes.findLast((node) => !senders.has(node.id))

  const nodes = workflow.nodes.map((node) => {
    const unfinished = node.data.status === 'active' || node.data.status === 'queued'
    const data = unfinished ? { ...node.data, status: 'idle' as const, task: 'Stopped' } : node.data
    return { ...node, data, selected: outcome === 'completed' ? node.id === lastNode?.id : node.selected }
  })

  const finished = { ...workflow, nodes }
  const usage = `${formatTokens(totalTokens(finished))} tokens, ${formatDollars(totalCost(finished))}`
  const summary = `${message ?? OUTCOME_MESSAGE[outcome]} (${usage})`

  return {
    ...finished,
    running: false,
    outcome,
    approvals: [],
    log: appendLog(workflow.log, [logEntry(null, workflow.name, summary)])
  }
}

// The numbers a finished run leaves behind, or nothing if it never reached a model.
export function runRecord(workflow: Workflow, agents: Agent[], endedAt = Date.now()): RunRecord | null {
  if (!workflow.runId || !workflow.outcome) return null
  const models = workflow.nodes.flatMap((node) => {
    if (node.data.tokensUsed <= 0) return []
    const agent = agentFor(node, agents)
    const model = node.data.routedModel ?? (agent && runnableModel(agent, node.data.activeModel)) ?? node.data.activeModel
    return [{ model, tokens: node.data.tokensUsed, cost: node.data.costUsed }]
  })
  if (models.length === 0) return null
  return {
    runId: workflow.runId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    endedAt,
    outcome: workflow.outcome,
    tokens: totalTokens(workflow),
    cost: totalCost(workflow),
    models
  }
}

// Applies events to the workflows of their runs. Projects and workflows an event does not change keep
// their identity, so the parts of the interface showing them are left alone.
export function reduceRunEvents(projects: Project[], events: RunEvent[]): Project[] {
  return events.reduce(
    (current, event) =>
      mapChanged(current, (project) => {
        const workflows = mapChanged(project.workflows, (workflow) =>
          workflow.runId === event.runId ? reduceRunEvent(workflow, event) : workflow
        )
        return workflows === project.workflows ? project : { ...project, workflows }
      }),
    projects
  )
}

function mapChanged<T>(items: T[], update: (item: T) => T): T[] {
  let changed = false
  const next = items.map((item) => {
    const updated = update(item)
    if (updated !== item) changed = true
    return updated
  })
  return changed ? next : items
}

export function reduceRunEvent(workflow: Workflow, event: RunEvent): Workflow {
  switch (event.type) {
    case 'node':
      return patchNode(workflow, event.nodeId, { status: event.status, task: event.task })
    case 'usage':
      return patchNode(workflow, event.nodeId, { tokensUsed: event.tokens, costUsed: event.cost })
    case 'progress': {
      const output = workflow.nodes.find((node) => node.id === event.nodeId)?.data.output ?? ''
      return patchNode(workflow, event.nodeId, {
        tokensUsed: event.tokens,
        costUsed: event.cost,
        output: output + event.delta
      })
    }
    case 'model':
      return patchNode(workflow, event.nodeId, { routedModel: event.model })
    case 'output':
      return patchNode(workflow, event.nodeId, { output: event.text })
    case 'log':
      return { ...workflow, log: appendLog(workflow.log, [logEntry(event.nodeId, event.agent, event.message)]) }
    case 'approval':
      return {
        ...workflow,
        approvals: [...(workflow.approvals ?? []), event.approval],
        nodes: workflow.nodes.map((node) => ({ ...node, selected: node.id === event.approval.nodeId }))
      }
    case 'approval-resolved':
      return { ...workflow, approvals: (workflow.approvals ?? []).filter((item) => item.id !== event.approvalId) }
    case 'end':
      return finishRun(workflow, event.outcome, event.message)
  }
}
