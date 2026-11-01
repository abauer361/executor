import { spendCeiling } from '../../shared/pricing'
import { hasCycle } from '../../shared/runGraph'
import type { Agent, RunEvent, RunOutcome, RunRequest, Workflow, WorkflowNode } from '../../shared/types'
import { appendLog, formatDollars, formatTokens, logEntry, runnableModel, totalCost, totalTokens } from './usage'

const OUTCOME_MESSAGE: Record<RunOutcome, string> = {
  completed: 'Run completed',
  stopped: 'Run stopped',
  halted: 'Run ended early because an agent reached its limit',
  failed: 'Run failed'
}

const agentFor = (node: WorkflowNode, agents: Agent[]) =>
  agents.find((candidate) => candidate.id === node.data.agentId)

export function runProblems(workflow: Workflow, agents: Agent[]) {
  const problems: string[] = []
  const ids = workflow.nodes.map((node) => node.id)
  if (hasCycle(ids, workflow.edges)) {
    problems.push('This workflow has a loop. Remove a connection so every agent has a clear order.')
  }
  for (const node of workflow.nodes) {
    const agent = agentFor(node, agents)
    if (!agent) problems.push('An agent on this canvas no longer exists.')
    else if (!runnableModel(agent, node.data.activeModel)) {
      problems.push(`${agent.name} needs a Claude model. Other providers are not connected yet.`)
    }
  }
  return problems
}

// The most this run could cost if every agent used its full limit.
export function runSpendCeiling(workflow: Workflow, agents: Agent[]) {
  return workflow.nodes.reduce((sum, node) => {
    const agent = agentFor(node, agents)
    const model = agent && runnableModel(agent, node.data.activeModel)
    return agent && model ? sum + spendCeiling(agent.limiter, model) : sum
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
          limiter: agent.limiter,
          instructions: node.data.instructions ?? []
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
        output: '',
        instructions: []
      }
    }))
  }
}

function patchNode(workflow: Workflow, nodeId: string, patch: Partial<WorkflowNode['data']>): Workflow {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node))
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
    log: appendLog(workflow.log, [logEntry(null, workflow.name, summary)])
  }
}

export function reduceRunEvent(workflow: Workflow, event: RunEvent): Workflow {
  switch (event.type) {
    case 'node':
      return patchNode(workflow, event.nodeId, { status: event.status, task: event.task })
    case 'usage':
      return patchNode(workflow, event.nodeId, { tokensUsed: event.tokens, costUsed: event.cost })
    case 'output':
      return patchNode(workflow, event.nodeId, { output: event.text })
    case 'log':
      return { ...workflow, log: appendLog(workflow.log, [logEntry(event.nodeId, event.agent, event.message)]) }
    case 'end':
      return finishRun(workflow, event.outcome, event.message)
  }
}
