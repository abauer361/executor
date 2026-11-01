import { describe, expect, it } from 'vitest'
import type { Agent, AgentStatus, Workflow, WorkflowNode } from '../../shared/types'
import { buildRunRequest, prepareRun, reduceRunEvent, runProblems, runSpendCeiling } from './runState'
import { agentSummary, budgetShare, formatDollars, formatTokens, runnableModel, sampleCost, workflowStatus } from './usage'

const agent = (patch: Partial<Agent> = {}): Agent => ({
  id: 'a',
  name: 'Agent',
  description: '',
  face: 0,
  models: ['claude-sonnet-5-5'],
  prompt: 'Do it',
  mcpServers: [],
  skills: [],
  memory: [],
  limiter: { mode: 'tokens', tokens: 100_000, dollars: 5 },
  source: 'mine',
  ...patch
})

const node = (id: string, status: AgentStatus = 'idle', tokensUsed = 0): WorkflowNode => ({
  id,
  type: 'agent',
  position: { x: 0, y: 0 },
  data: { agentId: 'a', status, task: 'task', tokensUsed, costUsed: 0, activeModel: 'claude-sonnet-5-5' }
})

const workflow = (nodes: WorkflowNode[], edges: Workflow['edges'] = []): Workflow => ({
  id: 'w',
  name: 'w',
  nodes,
  edges,
  running: false,
  lastRunAt: null,
  log: []
})

describe('formatting', () => {
  it('matches the seeded swe-fleet totals', () => {
    expect(sampleCost(290_000)).toBeCloseTo(5.8)
    expect(formatTokens(290_000)).toBe('290k')
    expect(formatTokens(18_400)).toBe('18.4k')
  })

  it('never shows a real charge as zero', () => {
    expect(formatDollars(0.004)).toBe('<$0.01')
    expect(formatDollars(0)).toBe('$0.00')
  })

  it('uses singular nouns for a count of one', () => {
    expect(agentSummary(agent({ skills: ['s'] }))).toBe('1 model · 0 MCP · 1 skill')
  })
})

describe('budgetShare', () => {
  it('measures tokens or dollars to match the limiter', () => {
    expect(budgetShare(agent(), { tokensUsed: 50_000, costUsed: 0 })).toBe(0.5)
    const inDollars = agent({ limiter: { mode: 'dollars', tokens: 0, dollars: 2 } })
    expect(budgetShare(inDollars, { tokensUsed: 0, costUsed: 1 })).toBe(0.5)
  })
})

describe('runnableModel', () => {
  const pool = agent({ models: ['gpt-4o', 'claude-haiku-5-5', 'claude-sonnet-5-5'] })

  it('prefers the model picked in the Inspector', () => {
    expect(runnableModel(pool, 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
  })

  it('falls back to the first Claude model', () => {
    expect(runnableModel(pool, 'gpt-4o')).toBe('claude-haiku-5-5')
  })

  it('ignores a picked model that left the pool', () => {
    expect(runnableModel(pool, 'claude-opus-5-5')).toBe('claude-haiku-5-5')
  })

  it('reports when no connected model is available', () => {
    expect(runnableModel(agent({ models: ['gpt-4o'] }), 'gpt-4o')).toBeNull()
  })
})

describe('runProblems', () => {
  it('blocks a workflow with a loop', () => {
    const looped = workflow([node('a'), node('b')], [
      { id: '1', source: 'a', target: 'b' },
      { id: '2', source: 'b', target: 'a' }
    ])
    expect(runProblems(looped, [agent()])[0]).toContain('loop')
  })

  it('names an agent with no Claude model', () => {
    expect(runProblems(workflow([node('a')]), [agent({ models: ['gpt-4o'] })])[0]).toContain('Agent needs a Claude model')
  })

  it('passes a runnable workflow', () => {
    expect(runProblems(workflow([node('a')]), [agent()])).toEqual([])
  })
})

describe('starting a run', () => {
  it('adds up what the run could cost', () => {
    expect(runSpendCeiling(workflow([node('a'), node('b')]), [agent()])).toBeCloseTo(2)
  })

  it('carries saved instructions into the request', () => {
    const saved = node('a')
    saved.data.instructions = ['Be brief']
    expect(buildRunRequest(workflow([saved]), [agent()], 'Goal', 'r').nodes[0].instructions).toEqual(['Be brief'])
  })

  it('clears earlier usage and the sample flag', () => {
    const prepared = prepareRun({ ...workflow([node('a', 'stopped', 500)]), sample: true }, 'Goal', 'r')
    expect(prepared.nodes[0].data).toMatchObject({ status: 'queued', tokensUsed: 0, costUsed: 0 })
    expect(prepared).toMatchObject({ running: true, sample: false, runId: 'r', goal: 'Goal' })
  })
})

describe('reduceRunEvent', () => {
  const started = prepareRun(workflow([node('a'), node('b')], [{ id: '1', source: 'a', target: 'b' }]), 'Goal', 'r')

  it('applies node status, usage and output', () => {
    let state = reduceRunEvent(started, { type: 'node', runId: 'r', nodeId: 'a', status: 'active', task: 'Writing' })
    state = reduceRunEvent(state, { type: 'usage', runId: 'r', nodeId: 'a', tokens: 120, cost: 0.5 })
    state = reduceRunEvent(state, { type: 'output', runId: 'r', nodeId: 'a', text: 'Hello' })
    expect(state.nodes[0].data).toMatchObject({ status: 'active', task: 'Writing', tokensUsed: 120, costUsed: 0.5, output: 'Hello' })
  })

  it('selects the last agent when the run completes so its result is on screen', () => {
    const state = reduceRunEvent(started, { type: 'end', runId: 'r', outcome: 'completed' })
    expect(state.nodes.find((candidate) => candidate.selected)?.id).toBe('b')
    expect(state.running).toBe(false)
    expect(workflowStatus(state)).toBe('completed')
  })

  it('reports a failed run with its reason and leaves nothing active', () => {
    const state = reduceRunEvent(started, { type: 'end', runId: 'r', outcome: 'failed', message: 'Bad key' })
    expect(state.nodes.every((candidate) => candidate.data.status === 'idle')).toBe(true)
    expect(state.log.at(-1)?.message).toContain('Bad key')
    expect(workflowStatus(state)).toBe('stopped')
  })
})

describe('workflowStatus', () => {
  it('stays active while any agent is active or queued', () => {
    expect(workflowStatus(workflow([node('a', 'queued'), node('b', 'warning')]))).toBe('active')
  })

  it('reports an empty workflow as stopped', () => {
    expect(workflowStatus(workflow([]))).toBe('stopped')
  })
})
