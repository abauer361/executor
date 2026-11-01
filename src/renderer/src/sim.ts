import type { Agent, Limiter, LogEntry, NodeRun, Workflow, WorkflowStatus } from '../../shared/types'

// Placeholder blended rate. Real pricing depends on the model and provider.
export const SAMPLE_RATE_PER_1K = 0.02

const LOG_LIMIT = 200
const SIMULATED_EVENTS = ['Reading context', 'Called MCP tool', 'Updated plan', 'Wrote output', 'Checked result']

export const costOf = (tokens: number) => (tokens / 1000) * SAMPLE_RATE_PER_1K

export const tokenLimit = (limiter: Limiter) =>
  limiter.mode === 'tokens' ? limiter.tokens : Math.round((limiter.dollars / SAMPLE_RATE_PER_1K) * 1000)

export function formatTokens(tokens: number) {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(Math.round(tokens))
}

export const formatDollars = (amount: number) => `$${amount.toFixed(2)}`

export const countOf = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

export const agentSummary = (agent: Agent) =>
  `${countOf(agent.models.length, 'model')} · ${agent.mcpServers.length} MCP · ${countOf(agent.skills.length, 'skill')}`

export function workflowStatus(workflow: Workflow): WorkflowStatus {
  if (workflow.nodes.some((node) => node.data.status === 'active')) return 'active'
  if (workflow.nodes.some((node) => node.data.status === 'warning')) return 'warning'
  return 'stopped'
}

export const totalTokens = (workflow: Workflow) =>
  workflow.nodes.reduce((sum, node) => sum + node.data.tokensUsed, 0)

export function logEntry(nodeId: string | null, agent: string, message: string): LogEntry {
  return {
    id: crypto.randomUUID(),
    time: new Date().toTimeString().slice(0, 5),
    nodeId,
    agent,
    message
  }
}

const appendLog = (log: LogEntry[], entries: LogEntry[]) => [...log, ...entries].slice(-LOG_LIMIT)

// Every run starts with a fresh budget, because limits and the ribbon total are both per run.
export function startRun(workflow: Workflow): Workflow {
  const nodes = workflow.nodes.map((node) => {
    const { status, task: previous } = node.data
    const keepsTask = (status === 'active' || status === 'idle') && previous !== 'Ready'
    const task = keepsTask ? previous : 'Running'
    return { ...node, data: { ...node.data, status: 'active' as const, task, tokensUsed: 0 } }
  })
  return {
    ...workflow,
    nodes,
    running: nodes.length > 0,
    lastRunAt: Date.now(),
    note: undefined,
    log: appendLog(workflow.log, [logEntry(null, workflow.name, 'Simulated run started')])
  }
}

export function stopRun(workflow: Workflow): Workflow {
  const nodes = workflow.nodes.map((node) =>
    node.data.status === 'active' ? { ...node, data: { ...node.data, status: 'idle' as const } } : node
  )
  return {
    ...workflow,
    nodes,
    running: false,
    log: appendLog(workflow.log, [logEntry(null, workflow.name, 'Run stopped')])
  }
}

// Advances a simulated run by one tick. No model is called: usage is generated locally.
export function tickWorkflow(workflow: Workflow, agents: Agent[], random: () => number = Math.random): Workflow {
  const entries: LogEntry[] = []

  const nodes = workflow.nodes.map((node) => {
    if (node.data.status !== 'active') return node
    const agent = agents.find((candidate) => candidate.id === node.data.agentId)
    if (!agent) return node

    const limit = tokenLimit(agent.limiter)
    const tokensUsed = Math.min(limit, node.data.tokensUsed + 400 + Math.floor(random() * 1200))
    const data: NodeRun = { ...node.data, tokensUsed }

    if (tokensUsed >= limit) {
      const budget = agent.limiter.mode === 'tokens' ? 'Token budget exceeded' : 'Dollar limit reached'
      data.status = 'stopped'
      data.task = budget
      entries.push(logEntry(node.id, agent.name, `${budget}, agent halted`))
    } else if (random() < 0.12) {
      const event = SIMULATED_EVENTS[Math.floor(random() * SIMULATED_EVENTS.length)]
      entries.push(logEntry(node.id, agent.name, event))
    }
    return { ...node, data }
  })

  return {
    ...workflow,
    nodes,
    running: nodes.some((node) => node.data.status === 'active'),
    log: entries.length ? appendLog(workflow.log, entries) : workflow.log
  }
}

export function timeAgo(timestamp: number, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
