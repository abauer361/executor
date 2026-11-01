import { describe, expect, it } from 'vitest'
import type { Agent, AgentStatus, Workflow } from '../../shared/types'
import { agentSummary, costOf, formatTokens, startRun, stopRun, tickWorkflow, tokenLimit, workflowStatus } from './sim'

const agent = (limiter: Agent['limiter']): Agent => ({
  id: 'a',
  name: 'Agent',
  description: '',
  face: 0,
  models: ['m'],
  prompt: '',
  mcpServers: [],
  skills: [],
  memory: [],
  limiter,
  source: 'mine'
})

const workflow = (status: AgentStatus, tokensUsed: number): Workflow => ({
  id: 'w',
  name: 'w',
  edges: [],
  running: true,
  lastRunAt: null,
  log: [],
  nodes: [
    {
      id: 'n',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { agentId: 'a', status, task: 'task', tokensUsed, activeModel: 'm' }
    }
  ]
})

describe('usage', () => {
  it('matches the seeded swe-fleet totals', () => {
    expect(costOf(290_000)).toBeCloseTo(5.8)
    expect(formatTokens(290_000)).toBe('290k')
    expect(formatTokens(18_400)).toBe('18.4k')
  })

  it('uses singular nouns for a count of one', () => {
    const one = { ...agent({ mode: 'tokens', tokens: 1, dollars: 0 }), skills: ['s'] }
    expect(agentSummary(one)).toBe('1 model · 0 MCP · 1 skill')
  })

  it('converts a dollar limiter into a token ceiling', () => {
    expect(tokenLimit({ mode: 'dollars', tokens: 0, dollars: 2 })).toBe(100_000)
    expect(tokenLimit({ mode: 'tokens', tokens: 50_000, dollars: 2 })).toBe(50_000)
  })
})

describe('tickWorkflow', () => {
  it('adds usage to active nodes only', () => {
    const agents = [agent({ mode: 'tokens', tokens: 100_000, dollars: 0 })]
    expect(tickWorkflow(workflow('active', 0), agents, () => 0).nodes[0].data.tokensUsed).toBe(400)
    expect(tickWorkflow(workflow('idle', 0), agents, () => 0).nodes[0].data.tokensUsed).toBe(0)
  })

  it('halts an agent at its limit and ends the run', () => {
    const agents = [agent({ mode: 'tokens', tokens: 1000, dollars: 0 })]
    const result = tickWorkflow(workflow('active', 900), agents, () => 0)
    expect(result.nodes[0].data).toMatchObject({ status: 'stopped', tokensUsed: 1000 })
    expect(result.running).toBe(false)
    expect(result.log.at(-1)?.message).toContain('Token budget exceeded')
  })

  it('reports the dollar limit when the limiter is in dollar mode', () => {
    const agents = [agent({ mode: 'dollars', tokens: 0, dollars: 0.02 })]
    const result = tickWorkflow(workflow('active', 900), agents, () => 0)
    expect(result.nodes[0].data.task).toBe('Dollar limit reached')
  })
})

describe('run control', () => {
  it('starts each run from zero usage', () => {
    const result = startRun(workflow('idle', 42_000))
    expect(result.nodes[0].data).toMatchObject({ status: 'active', tokensUsed: 0 })
    expect(result.running).toBe(true)
  })

  it('gives a halted agent a fresh budget and clears the halt reason', () => {
    const halted = workflow('stopped', 1000)
    halted.nodes[0].data.task = 'Token budget exceeded'
    expect(startRun(halted).nodes[0].data).toMatchObject({ status: 'active', task: 'Running', tokensUsed: 0 })
  })

  it('releases agents that were waiting on a person', () => {
    const waiting = { ...workflow('warning', 500), note: 'Diff review' }
    const result = startRun(waiting)
    expect(result.nodes[0].data).toMatchObject({ status: 'active', task: 'Running' })
    expect(result.note).toBeUndefined()
  })

  it('keeps the current task of an agent that was already working', () => {
    expect(startRun(workflow('idle', 0)).nodes[0].data.task).toBe('task')
  })

  it('does not start a workflow with no agents', () => {
    expect(startRun({ ...workflow('idle', 0), nodes: [] }).running).toBe(false)
  })

  it('keeps usage when a run is stopped', () => {
    expect(stopRun(workflow('active', 700)).nodes[0].data).toMatchObject({ status: 'idle', tokensUsed: 700 })
  })
})

describe('workflowStatus', () => {
  it('stays active while any agent is active', () => {
    const mixed = workflow('active', 0)
    mixed.nodes.push({ ...mixed.nodes[0], id: 'n2', data: { ...mixed.nodes[0].data, status: 'warning' } })
    expect(workflowStatus(mixed)).toBe('active')
  })

  it('reports an empty workflow as stopped', () => {
    expect(workflowStatus({ ...workflow('idle', 0), nodes: [] })).toBe('stopped')
  })
})
