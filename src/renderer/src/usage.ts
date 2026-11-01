import { CLAUDE_MODELS, RUNNABLE_MODELS } from '../../shared/pricing'
import type { Agent, LogEntry, NodeRun, Workflow, WorkflowStatus } from '../../shared/types'

// Only prices the starter sample data. Real runs report billed cost.
const SAMPLE_RATE_PER_1K = 0.02
const LOG_LIMIT = 200

export const sampleCost = (tokens: number) => (tokens / 1000) * SAMPLE_RATE_PER_1K

export function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(tokens))
}

export function formatDollars(amount: number) {
  if (amount > 0 && amount < 0.01) return '<$0.01'
  return `$${amount.toFixed(2)}`
}

export const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

export const agentSummary = (agent: Agent) =>
  `${countOf(agent.models.length, 'model')} · ${agent.mcpServers.length} MCP · ${countOf(agent.skills.length, 'skill')}`

export function budgetShare(agent: Agent, data: Pick<NodeRun, 'tokensUsed' | 'costUsed'>) {
  const { mode, tokens, dollars } = agent.limiter
  const limit = mode === 'tokens' ? tokens : dollars
  const used = mode === 'tokens' ? data.tokensUsed : data.costUsed
  return limit > 0 ? Math.min(1, used / limit) : 1
}

export const AUTO_MODEL = 'auto'

// Routing is a Claude call choosing between Claude models.
export const routableModels = (agent: Agent) => agent.models.filter((model) => CLAUDE_MODELS.includes(model))

// Runs use the model picked in the Inspector, or the first connected model in the pool.
export function runnableModel(agent: Agent, activeModel: string) {
  if (RUNNABLE_MODELS.includes(activeModel) && agent.models.includes(activeModel)) return activeModel
  return agent.models.find((model) => RUNNABLE_MODELS.includes(model)) ?? null
}

export function workflowStatus(workflow: Workflow): WorkflowStatus {
  const statuses = workflow.nodes.map((node) => node.data.status)
  if (statuses.includes('active') || statuses.includes('queued')) return 'active'
  if (statuses.includes('warning')) return 'warning'
  return workflow.outcome === 'completed' ? 'completed' : 'stopped'
}

export const totalTokens = (workflow: Workflow) =>
  workflow.nodes.reduce((sum, node) => sum + node.data.tokensUsed, 0)

export const totalCost = (workflow: Workflow) =>
  workflow.nodes.reduce((sum, node) => sum + node.data.costUsed, 0)

export function logEntry(nodeId: string | null, agent: string, message: string): LogEntry {
  return {
    id: crypto.randomUUID(),
    time: new Date().toTimeString().slice(0, 5),
    nodeId,
    agent,
    message
  }
}

export const appendLog = (log: LogEntry[], entries: LogEntry[]) => [...log, ...entries].slice(-LOG_LIMIT)

export function timeAgo(timestamp: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
