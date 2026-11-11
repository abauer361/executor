import { describe, expect, it } from 'vitest'
import type { Agent, AgentStatus, Workflow, WorkflowNode } from '../../shared/types'
import { buildRunRequest, prepareRun, reduceRunEvent, reduceRunEvents, runProblems, runRecord, runSpendCeiling, runWarnings, serverState } from './runState'
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
  const pool = agent({ models: ['deepseek-r1', 'claude-haiku-5-5', 'claude-sonnet-5-5'] })

  it('prefers the model picked in the Inspector', () => {
    expect(runnableModel(pool, 'claude-sonnet-5-5')).toBe('claude-sonnet-5-5')
  })

  it('falls back to the first Claude model', () => {
    expect(runnableModel(pool, 'deepseek-r1')).toBe('claude-haiku-5-5')
  })

  it('ignores a picked model that left the pool', () => {
    expect(runnableModel(pool, 'claude-opus-5-5')).toBe('claude-haiku-5-5')
  })

  it('reports when no connected model is available', () => {
    expect(runnableModel(agent({ models: ['deepseek-r1'] }), 'deepseek-r1')).toBeNull()
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
    expect(runProblems(workflow([node('a')]), [agent({ models: ['deepseek-r1'] })])[0]).toContain('no connected model')
  })

  it('names the key a model needs', () => {
    const keys = { anthropic: true, openai: false, google: true }
    const gpt = node('a')
    gpt.data.activeModel = 'gpt-6.1-sol'
    expect(runProblems(workflow([gpt]), [agent({ models: ['gpt-6.1-sol'] })], keys)[0]).toContain('your OpenAI API key')
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

describe('run records', () => {
  const finished = (): Workflow => {
    let state = prepareRun(workflow([node('a'), node('b')]), 'A private goal', 'r')
    state = reduceRunEvent(state, { type: 'usage', runId: 'r', nodeId: 'a', tokens: 1200, cost: 0.5 })
    state = reduceRunEvent(state, { type: 'model', runId: 'r', nodeId: 'a', model: 'claude-haiku-5-5' })
    state = reduceRunEvent(state, { type: 'output', runId: 'r', nodeId: 'a', text: 'A private answer' })
    return reduceRunEvent(state, { type: 'end', runId: 'r', outcome: 'halted' })
  }

  it('keeps the numbers of a finished run, by the model each agent really used', () => {
    expect(runRecord(finished(), [agent()], 42)).toEqual({
      runId: 'r',
      workflowId: 'w',
      workflowName: 'w',
      endedAt: 42,
      outcome: 'halted',
      tokens: 1200,
      cost: 0.5,
      models: [{ model: 'claude-haiku-5-5', tokens: 1200, cost: 0.5 }]
    })
  })

  it('never carries the goal, prompts or output', () => {
    const text = JSON.stringify(runRecord(finished(), [agent()]))
    expect(text).not.toContain('private')
    expect(text).not.toContain('Do it')
  })

  it('records nothing for a run that never reached a model, or one still going', () => {
    const untouched = reduceRunEvent(prepareRun(workflow([node('a')]), 'Goal', 'r'), { type: 'end', runId: 'r', outcome: 'failed' })
    expect(runRecord(untouched, [agent()])).toBeNull()
    expect(runRecord(prepareRun(workflow([node('a')]), 'Goal', 'r'), [agent()])).toBeNull()
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

  it('appends streamed text and lets the whole output replace it', () => {
    const progress = (delta: string, tokens: number) =>
      ({ type: 'progress', runId: 'r', nodeId: 'a', tokens, cost: 0.1, delta }) as const
    let state = reduceRunEvent(started, progress('Hel', 10))
    state = reduceRunEvent(state, progress('lo', 20))
    expect(state.nodes[0].data).toMatchObject({ output: 'Hello', tokensUsed: 20, costUsed: 0.1 })

    state = reduceRunEvent(state, { type: 'output', runId: 'r', nodeId: 'a', text: 'Hello.' })
    expect(state.nodes[0].data.output).toBe('Hello.')
  })

  it('leaves the workflow untouched when an event changes nothing', () => {
    const event = { type: 'usage', runId: 'r', nodeId: 'a', tokens: 5, cost: 0 } as const
    const once = reduceRunEvent(started, event)
    expect(reduceRunEvent(once, event)).toBe(once)
    expect(reduceRunEvent(once, { ...event, nodeId: 'gone' })).toBe(once)
  })

  it('only replaces the project and workflow a batch of events belongs to', () => {
    const idle = workflow([node('x')])
    const projects = [
      { id: 'p1', name: 'One', tag: '', activeWorkflowId: 'w', workflows: [started, idle] },
      { id: 'p2', name: 'Two', tag: '', activeWorkflowId: 'w', workflows: [idle] }
    ]
    const next = reduceRunEvents(projects, [
      { type: 'progress', runId: 'r', nodeId: 'a', tokens: 10, cost: 0, delta: 'a' },
      { type: 'progress', runId: 'r', nodeId: 'a', tokens: 20, cost: 0, delta: 'b' }
    ])

    expect(next[0].workflows[0].nodes[0].data).toMatchObject({ output: 'ab', tokensUsed: 20 })
    expect(next[0].workflows[1]).toBe(idle)
    expect(next[1]).toBe(projects[1])
    expect(reduceRunEvents(projects, [{ type: 'log', runId: 'other', nodeId: null, agent: 'x', message: 'y' }])).toBe(projects)
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

describe('approvals', () => {
  const started = prepareRun(workflow([node('a'), node('b')]), 'Goal', 'r')
  const approval = { id: 'x', nodeId: 'b', agent: 'B', tool: 'files write', input: '{}' }

  it('shows the agent that is waiting', () => {
    const state = reduceRunEvent(started, { type: 'approval', runId: 'r', approval })
    expect(state.approvals).toEqual([approval])
    expect(state.nodes.find((candidate) => candidate.selected)?.id).toBe('b')
  })

  it('clears an approval once it is answered', () => {
    const waiting = reduceRunEvent(started, { type: 'approval', runId: 'r', approval })
    expect(reduceRunEvent(waiting, { type: 'approval-resolved', runId: 'r', approvalId: 'x' }).approvals).toEqual([])
  })

  it('clears unanswered approvals when the run ends', () => {
    const waiting = reduceRunEvent(started, { type: 'approval', runId: 'r', approval })
    expect(reduceRunEvent(waiting, { type: 'end', runId: 'r', outcome: 'stopped' }).approvals).toEqual([])
  })
})

describe('routing', () => {
  const pool = ['claude-haiku-5-5', 'claude-opus-5-5', 'gpt-6.1-sol']
  const auto = () => {
    const routed = node('a')
    routed.data.activeModel = 'auto'
    return routed
  }

  it('routes among the Claude models in the pool', () => {
    const request = buildRunRequest(workflow([auto()]), [agent({ models: pool })], 'Goal', 'r')
    expect(request.nodes[0].routeAmong).toEqual(['claude-haiku-5-5', 'claude-opus-5-5'])
  })

  it('does not route when a specific model is picked', () => {
    expect(buildRunRequest(workflow([node('a')]), [agent({ models: pool })], 'Goal', 'r').nodes[0].routeAmong).toBeUndefined()
  })

  it('caps spending at the most expensive model routing could pick', () => {
    expect(runSpendCeiling(workflow([auto()]), [agent({ models: pool })])).toBeCloseTo(2)
  })

  it('records the chosen model and clears it for the next run', () => {
    const started = prepareRun(workflow([auto()]), 'Goal', 'r')
    const routed = reduceRunEvent(started, { type: 'model', runId: 'r', nodeId: 'a', model: 'claude-opus-5-5' })
    expect(routed.nodes[0].data.routedModel).toBe('claude-opus-5-5')
    expect(prepareRun(routed, 'Goal', 'r2').nodes[0].data.routedModel).toBeUndefined()
  })
})

describe('server readiness', () => {
  const downloaded = { filesystem: { packageId: 'filesystem', path: 'x', downloadedAt: 0 } }
  const empty = { folders: {}, secrets: [] }

  it('tells a missing server from one that needs setup', () => {
    expect(serverState('time', downloaded, {})).toBe('not-downloaded')
    expect(serverState('filesystem', downloaded, { filesystem: empty })).toBe('needs-setup')
    expect(serverState('filesystem', downloaded, { filesystem: { folders: { folders: ['/a'] }, secrets: [] } })).toBe('ready')
  })

  it('warns about servers agents cannot use yet', () => {
    const agents = [agent({ mcpServers: ['filesystem', 'time'] })]
    expect(runWarnings(workflow([node('a')]), agents, downloaded, {})).toEqual(['filesystem', 'time'])
  })

  it('sends attached tools, skills and memory with the run', () => {
    const memory = [{ id: 'd', name: 'a.md', path: '/a.md', size: 1 }]
    const agents = [agent({ mcpServers: ['time'], skills: ['mcp-builder'], memory })]
    expect(buildRunRequest(workflow([node('a')]), agents, 'Goal', 'r').nodes[0]).toMatchObject({
      mcpServers: ['time'],
      skills: ['mcp-builder'],
      memory
    })
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
