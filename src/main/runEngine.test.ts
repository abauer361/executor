import { describe, expect, it } from 'vitest'
import { outputAllowance, spendCeiling, usageCost } from '../shared/pricing'
import { hasCycle } from '../shared/runGraph'
import type { Limiter, RunEvent, RunNodeSpec } from '../shared/types'
import { buildSystemPrompt, buildUserMessage, FatalRunError, launchRun, type ModelClient, type ModelResult } from './runEngine'

const tokens = (limit: number): Limiter => ({ mode: 'tokens', tokens: limit, dollars: 5 })

const node = (id: string, limiter: Limiter = tokens(100_000)): RunNodeSpec => ({
  id,
  name: id.toUpperCase(),
  prompt: `Prompt for ${id}`,
  model: 'claude-sonnet-5-5',
  limiter,
  instructions: []
})

interface FakeCall {
  id: string
  userMessage: string
  maxTokens: number
}

function fakeClient(overrides: {
  inputTokens?: number
  reply?: (call: FakeCall) => Partial<ModelResult> | Error | Promise<Partial<ModelResult>>
} = {}) {
  const calls: FakeCall[] = []
  let concurrent = 0
  let peak = 0
  const client: ModelClient = {
    countInputTokens: async () => overrides.inputTokens ?? 100,
    stream: async (prompt, maxTokens, signal, onProgress) => {
      const id = /running as the (\S+) agent/.exec(prompt.system)?.[1] ?? '?'
      const call = { id, userMessage: prompt.userMessage, maxTokens }
      calls.push(call)
      concurrent += 1
      peak = Math.max(peak, concurrent)
      onProgress({ type: 'phase', phase: 'writing' })
      onProgress({ type: 'text', text: 'partial' })
      await new Promise((resolve) => setTimeout(resolve, 1))
      concurrent -= 1
      if (signal.aborted) throw new Error('aborted')
      const reply = (await overrides.reply?.(call)) ?? {}
      if (reply instanceof Error) throw reply
      return {
        text: `output of ${id}`,
        stopReason: 'end_turn',
        usage: [{ model: prompt.model, inputTokens: 100, outputTokens: 50 }],
        ...reply
      }
    }
  }
  return { client, calls, peak: () => peak }
}

async function run(nodes: RunNodeSpec[], edges: [string, string][], client: ModelClient) {
  const events: RunEvent[] = []
  const handle = launchRun(
    { runId: 'r', goal: 'Ship it', nodes, edges: edges.map(([source, target]) => ({ source, target })) },
    client,
    (event) => events.push(event)
  )
  await handle.done
  return events
}

const lastNode = (events: RunEvent[], id: string) =>
  events.filter((event) => event.type === 'node' && event.nodeId === id).at(-1)
const endOf = (events: RunEvent[]) => events.find((event) => event.type === 'end')

describe('run order', () => {
  it('runs agents in connection order and passes output downstream', async () => {
    const { client, calls } = fakeClient()
    const events = await run([node('a'), node('b')], [['a', 'b']], client)
    expect(calls.map((call) => call.id)).toEqual(['A', 'B'])
    expect(calls[0].userMessage).toContain('Goal:\nShip it')
    expect(calls[1].userMessage).toContain('<upstream_output agent="A">\noutput of A\n</upstream_output>')
    expect(endOf(events)).toMatchObject({ outcome: 'completed' })
  })

  it('waits for every incoming agent before starting a fan-in', async () => {
    const { client, calls } = fakeClient()
    await run([node('c'), node('a'), node('b')], [['a', 'c'], ['b', 'c']], client)
    expect(calls.at(-1)?.id).toBe('C')
    expect(calls.at(-1)?.userMessage).toContain('output of A')
    expect(calls.at(-1)?.userMessage).toContain('output of B')
  })

  it('limits how many agents run at once', async () => {
    const { client, peak } = fakeClient()
    await run(['a', 'b', 'c', 'd', 'e'].map((id) => node(id)), [], client)
    expect(peak()).toBe(3)
  })
})

describe('limits', () => {
  it('caps output to what remains of a token limit', async () => {
    const { client, calls } = fakeClient({ inputTokens: 1000 })
    await run([node('a', tokens(5000))], [], client)
    expect(calls[0].maxTokens).toBe(4000)
  })

  it('caps output to what remains of a dollar limit', async () => {
    const { client, calls } = fakeClient({ inputTokens: 0 })
    await run([node('a', { mode: 'dollars', tokens: 0, dollars: 0.01 })], [], client)
    expect(calls[0].maxTokens).toBe(1000)
  })

  it('spends nothing when the input alone leaves no room to reply', async () => {
    const { client, calls } = fakeClient({ inputTokens: 5000 })
    const events = await run([node('a', tokens(5000))], [], client)
    expect(calls).toHaveLength(0)
    expect(lastNode(events, 'a')).toMatchObject({ status: 'stopped', task: 'Token budget exceeded' })
    expect(endOf(events)).toMatchObject({ outcome: 'halted' })
  })

  it('halts an agent that uses its whole allowance and skips what depends on it', async () => {
    const { client, calls } = fakeClient({
      inputTokens: 1000,
      reply: () => ({ stopReason: 'max_tokens' })
    })
    const events = await run([node('a', tokens(2000)), node('b')], [['a', 'b']], client)
    expect(calls.map((call) => call.id)).toEqual(['A'])
    expect(lastNode(events, 'a')).toMatchObject({ status: 'stopped', task: 'Token budget exceeded' })
    expect(lastNode(events, 'b')).toMatchObject({ task: 'Skipped' })
    expect(endOf(events)).toMatchObject({ outcome: 'halted' })
  })

  it('treats the maximum reply length as finished, not a limit', async () => {
    const { client } = fakeClient({ reply: () => ({ stopReason: 'max_tokens' }) })
    const events = await run([node('a', tokens(1_000_000))], [], client)
    expect(lastNode(events, 'a')).toMatchObject({ status: 'idle', task: 'Done' })
  })
})

describe('usage', () => {
  it('reports billed usage instead of the live estimate', async () => {
    const { client } = fakeClient()
    const events = await run([node('a')], [], client)
    const usage = events.filter((event) => event.type === 'usage').at(-1)
    expect(usage).toMatchObject({ tokens: 150, cost: usageCost('claude-sonnet-5-5', 100, 50) })
  })

  it('adds every billed attempt when a fallback serves the reply', async () => {
    const { client } = fakeClient({
      reply: () => ({
        usage: [
          { model: 'claude-sonnet-5-5', inputTokens: 100, outputTokens: 10 },
          { model: 'claude-sonnet-5', inputTokens: 100, outputTokens: 50 }
        ]
      })
    })
    const events = await run([node('a')], [], client)
    expect(events.filter((event) => event.type === 'usage').at(-1)).toMatchObject({ tokens: 260 })
  })
})

describe('failures', () => {
  it('stops the whole run when the API key is rejected', async () => {
    const { client, calls } = fakeClient({ reply: () => new FatalRunError('Bad key') })
    const events = await run([node('a'), node('b')], [['a', 'b']], client)
    expect(calls).toHaveLength(1)
    expect(endOf(events)).toMatchObject({ outcome: 'failed', message: 'Bad key' })
  })

  it('keeps unrelated branches going when one agent fails', async () => {
    const { client, calls } = fakeClient({
      reply: (call) => (call.id === 'A' ? new Error('Overloaded') : {})
    })
    const events = await run([node('a'), node('b')], [], client)
    expect(calls).toHaveLength(2)
    expect(lastNode(events, 'a')).toMatchObject({ status: 'stopped', task: 'Failed' })
    expect(lastNode(events, 'b')).toMatchObject({ task: 'Done' })
    expect(endOf(events)).toMatchObject({ outcome: 'failed' })
  })

  it('does not pass on the output of a refused request', async () => {
    const { client, calls } = fakeClient({
      reply: (call) => (call.id === 'A' ? { stopReason: 'refusal', text: 'partial' } : {})
    })
    const events = await run([node('a'), node('b')], [['a', 'b']], client)
    expect(calls).toHaveLength(1)
    expect(lastNode(events, 'a')).toMatchObject({ task: 'Declined by Claude' })
  })
})

describe('stopping and instructions', () => {
  it('stops running agents and leaves the rest unstarted', async () => {
    const { client, calls } = fakeClient()
    const events: RunEvent[] = []
    const handle = launchRun(
      { runId: 'r', goal: 'g', nodes: [node('a'), node('b')], edges: [{ source: 'a', target: 'b' }] },
      client,
      (event) => events.push(event)
    )
    handle.stop()
    await handle.done
    expect(calls.map((call) => call.id)).not.toContain('B')
    expect(endOf(events)).toMatchObject({ outcome: 'stopped' })
  })

  it('applies an instruction added before an agent starts', async () => {
    const { client, calls } = fakeClient()
    const handle = launchRun(
      { runId: 'r', goal: 'g', nodes: [node('a'), node('b')], edges: [{ source: 'a', target: 'b' }] },
      client,
      () => {}
    )
    handle.inject('b', 'Use the v2 schema')
    await handle.done
    expect(calls[1].userMessage).toContain('- Use the v2 schema')
  })
})

describe('prompts', () => {
  it('tells every agent it has no tools', () => {
    const system = buildSystemPrompt({ name: 'Reviewer', prompt: 'Review code.' })
    expect(system.startsWith('Review code.')).toBe(true)
    expect(system).toContain('You have no tools in this run')
  })

  it('removes quotes from agent names in the upstream tag', () => {
    expect(buildUserMessage('g', [{ name: 'A"B', output: 'x' }], [])).toContain('agent="AB"')
  })
})

describe('run graph', () => {
  it('finds loops', () => {
    expect(hasCycle(['a', 'b'], [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }])).toBe(true)
    expect(hasCycle(['a', 'b'], [{ source: 'a', target: 'b' }])).toBe(false)
  })
})

describe('pricing', () => {
  it('uses published rates', () => {
    expect(usageCost('claude-opus-5-5', 1_000_000, 1_000_000)).toBe(24)
    expect(usageCost('claude-sonnet-5-5', 1_000_000, 1_000_000)).toBe(12)
    expect(usageCost('claude-haiku-5-5', 1_000_000 / 10, 0)).toBeCloseTo(0.01)
  })

  it('applies the higher Haiku rate to long prompts', () => {
    expect(usageCost('claude-haiku-5-5', 200_000, 0)).toBeCloseTo(0.1)
  })

  it('assumes the highest rate for an unknown fallback model', () => {
    expect(usageCost('claude-new-model', 1_000_000, 0)).toBe(10)
  })

  it('works out the output a limit allows', () => {
    expect(outputAllowance(tokens(5000), 'claude-sonnet-5-5', 1000)).toBe(4000)
    expect(outputAllowance({ mode: 'dollars', tokens: 0, dollars: 1 }, 'claude-sonnet-5-5', 0)).toBe(100_000)
  })

  it('reports the most an agent could spend', () => {
    expect(spendCeiling(tokens(100_000), 'claude-sonnet-5-5')).toBe(1)
    expect(spendCeiling({ mode: 'dollars', tokens: 0, dollars: 3 }, 'claude-sonnet-5-5')).toBe(3)
  })
})
