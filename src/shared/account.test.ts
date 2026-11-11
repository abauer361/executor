import { describe, expect, it } from 'vitest'
import { monthOf, summarizeUsage, type RunRecord } from './account'

const at = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12).getTime()

const record = (patch: Partial<RunRecord> = {}): RunRecord => ({
  runId: crypto.randomUUID(),
  workflowId: 'w1',
  workflowName: 'Review',
  endedAt: at(2026, 11, 10),
  outcome: 'completed',
  tokens: 1000,
  cost: 0.5,
  models: [{ model: 'claude-sonnet-5-5', tokens: 1000, cost: 0.5 }],
  ...patch
})

describe('usage summary', () => {
  it('reports nothing for an account with no runs', () => {
    const summary = summarizeUsage([], at(2026, 11, 11))
    expect(summary.allTime).toEqual({ runs: 0, tokens: 0, cost: 0 })
    expect(summary.thisMonth).toEqual({ runs: 0, tokens: 0, cost: 0 })
    expect(summary.months).toEqual([])
  })

  it('separates this month from everything before it', () => {
    const summary = summarizeUsage(
      [record(), record({ tokens: 500, cost: 0.25 }), record({ endedAt: at(2026, 10, 3), tokens: 4000, cost: 2 })],
      at(2026, 11, 11)
    )
    expect(summary.thisMonth).toEqual({ runs: 2, tokens: 1500, cost: 0.75 })
    expect(summary.allTime).toEqual({ runs: 3, tokens: 5500, cost: 2.75 })
    expect(summary.months.map((entry) => entry.month)).toEqual(['2026-11', '2026-10'])
  })

  it('keeps only the most recent months', () => {
    const records = Array.from({ length: 9 }, (_, index) => record({ endedAt: at(2026, index + 1, 5) }))
    const months = summarizeUsage(records, at(2026, 11, 11), 6).months.map((entry) => entry.month)
    expect(months).toEqual(['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04'])
  })

  it('splits a run across the providers its agents used', () => {
    const mixed = record({
      tokens: 3000,
      cost: 1.5,
      models: [
        { model: 'claude-sonnet-5-5', tokens: 1000, cost: 0.2 },
        { model: 'gpt-6.1-sol', tokens: 1500, cost: 1 },
        { model: 'claude-haiku-5-5', tokens: 500, cost: 0.3 }
      ]
    })
    expect(summarizeUsage([mixed]).providers).toEqual([
      { provider: 'openai', tokens: 1500, cost: 1 },
      { provider: 'anthropic', tokens: 1500, cost: 0.5 }
    ])
  })

  it('ranks workflows by spend and uses each one\'s latest name', () => {
    const summary = summarizeUsage([
      record({ workflowId: 'a', workflowName: 'Old name', endedAt: at(2026, 11, 1), cost: 1 }),
      record({ workflowId: 'a', workflowName: 'New name', endedAt: at(2026, 11, 9), cost: 1 }),
      record({ workflowId: 'b', workflowName: 'Costly', cost: 5 })
    ])
    expect(summary.workflows.map(({ name, runs, cost }) => ({ name, runs, cost }))).toEqual([
      { name: 'Costly', runs: 1, cost: 5 },
      { name: 'New name', runs: 2, cost: 2 }
    ])
  })

  it('counts failed and stopped runs, since they still cost money', () => {
    const summary = summarizeUsage([record({ outcome: 'failed' }), record({ outcome: 'stopped' })], at(2026, 11, 11))
    expect(summary.thisMonth.runs).toBe(2)
  })

  it('names months in local time', () => {
    expect(monthOf(new Date(2026, 0, 31, 23, 59).getTime())).toBe('2026-01')
  })
})
