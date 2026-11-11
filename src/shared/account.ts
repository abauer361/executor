import { providerOf, type Provider } from './pricing'
import type { Limiter, RunOutcome } from './types'

export type SignInProvider = 'google' | 'github'

export interface Account {
  id: string
  name: string
  email: string
  avatarUrl?: string
  provider: SignInProvider
}

export interface Plan {
  name: string
  status: 'active' | 'past_due' | 'canceled'
  renewsAt?: number
}

// `connected` is false until the app is pointed at an account service. Until then nothing asks
// anyone to sign in, because there would be nowhere to sign in to.
export interface AccountState {
  connected: boolean
  account: Account | null
  plan: Plan | null
}

export interface AccountResult {
  ok: boolean
  message?: string
}

// Choices that belong to the person rather than to one project.
export interface Preferences {
  defaultModel: string
  defaultLimiter: Limiter
}

export const DEFAULT_PREFERENCES: Preferences = {
  defaultModel: 'claude-sonnet-5-5',
  defaultLimiter: { mode: 'tokens', tokens: 100_000, dollars: 5 }
}

// What is kept about a finished run: numbers only. No goal, prompt, output or file content is
// recorded here, so this is safe to send to the account later.
export interface RunRecord {
  runId: string
  workflowId: string
  workflowName: string
  endedAt: number
  outcome: RunOutcome
  tokens: number
  cost: number
  models: { model: string; tokens: number; cost: number }[]
}

export const RUN_HISTORY_LIMIT = 2000

export interface UsageTotal {
  runs: number
  tokens: number
  cost: number
}

export interface UsageSummary {
  allTime: UsageTotal
  thisMonth: UsageTotal
  // Newest month first, as YYYY-MM.
  months: ({ month: string } & UsageTotal)[]
  providers: { provider: Provider; tokens: number; cost: number }[]
  workflows: ({ workflowId: string; name: string } & UsageTotal)[]
}

const empty = (): UsageTotal => ({ runs: 0, tokens: 0, cost: 0 })

function add(total: UsageTotal, record: RunRecord) {
  total.runs += 1
  total.tokens += record.tokens
  total.cost += record.cost
}

// In the person's own time zone, so a late-evening run lands in the month they would expect.
export function monthOf(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export function summarizeUsage(records: RunRecord[], now = Date.now(), monthCount = 6, workflowCount = 5): UsageSummary {
  const allTime = empty()
  const months = new Map<string, UsageTotal>()
  const providers = new Map<Provider, { tokens: number; cost: number }>()
  const workflows = new Map<string, { name: string; endedAt: number } & UsageTotal>()

  for (const record of records) {
    add(allTime, record)

    const month = monthOf(record.endedAt)
    if (!months.has(month)) months.set(month, empty())
    add(months.get(month)!, record)

    for (const used of record.models) {
      const provider = providerOf(used.model)
      const total = providers.get(provider) ?? { tokens: 0, cost: 0 }
      providers.set(provider, { tokens: total.tokens + used.tokens, cost: total.cost + used.cost })
    }

    const workflow = workflows.get(record.workflowId) ?? { name: record.workflowName, endedAt: 0, ...empty() }
    add(workflow, record)
    // A renamed workflow is listed under its latest name.
    if (record.endedAt >= workflow.endedAt) Object.assign(workflow, { name: record.workflowName, endedAt: record.endedAt })
    workflows.set(record.workflowId, workflow)
  }

  return {
    allTime,
    thisMonth: months.get(monthOf(now)) ?? empty(),
    months: [...months]
      .map(([month, total]) => ({ month, ...total }))
      .sort((a, b) => b.month.localeCompare(a.month))
      .slice(0, monthCount),
    providers: [...providers].map(([provider, total]) => ({ provider, ...total })).sort((a, b) => b.cost - a.cost),
    workflows: [...workflows]
      .map(([workflowId, { name, runs, tokens, cost }]) => ({ workflowId, name, runs, tokens, cost }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, workflowCount)
  }
}
