import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutorBridge, LoadedState, Workflow } from '../../shared/types'

type Store = typeof import('./store')

const workflow = (patch: Partial<Workflow> = {}): Workflow => ({
  id: 'w',
  name: 'main',
  nodes: [],
  edges: [],
  running: false,
  lastRunAt: null,
  log: [],
  ...patch
})

const savedState = (workflows: Workflow[]) =>
  JSON.stringify({
    version: 1,
    projects: [{ id: 'p', name: 'Project', tag: '', activeWorkflowId: 'w', workflows }],
    agents: [],
    downloads: {},
    activeProjectId: 'p',
    theme: 'light'
  })

// The store reads the bridge from `window` when it loads, so each test loads a fresh copy.
async function storeWith(bridge: Partial<ExecutorBridge>): Promise<Store> {
  const unused = () => Promise.reject(new Error('not available in this test'))
  const executor = new Proxy(bridge, { get: (target, key) => target[key as keyof ExecutorBridge] ?? unused })
  vi.stubGlobal('window', { executor, addEventListener: () => {} })
  vi.resetModules()
  return import('./store')
}

const loads = (state: LoadedState) => ({ loadState: async () => state })

describe('profile', () => {
  beforeEach(() => void vi.unstubAllGlobals())

  const running = () => {
    const node = {
      id: 'n',
      type: 'agent' as const,
      position: { x: 0, y: 0 },
      data: { agentId: 'a', status: 'active' as const, task: 'Writing', tokensUsed: 0, costUsed: 0, activeModel: 'claude-sonnet-5-5' }
    }
    return workflow({ running: true, runId: 'r', nodes: [node] })
  }

  it('adds one record when a run ends, however many times the end is reported', async () => {
    const { useApp } = await storeWith(loads({ json: savedState([workflow()]) }))
    await useApp.getState().hydrate()
    useApp.setState((state) => ({ projects: [{ ...state.projects[0], workflows: [running()] }] }))

    const end = { type: 'end', runId: 'r', outcome: 'completed' } as const
    useApp.getState().applyRunEvents([{ type: 'usage', runId: 'r', nodeId: 'n', tokens: 900, cost: 0.3 }, end])
    useApp.getState().applyRunEvents([end])

    expect(useApp.getState().runs).toHaveLength(1)
    expect(useApp.getState().runs[0]).toMatchObject({ runId: 'r', tokens: 900, cost: 0.3, outcome: 'completed' })
  })

  it('starts new agents from the saved preferences', async () => {
    const { useApp } = await storeWith(loads({ json: savedState([workflow()]) }))
    await useApp.getState().hydrate()

    useApp.getState().setPreferences({ defaultModel: 'gpt-6.1-sol', defaultLimiter: { mode: 'dollars', tokens: 50_000, dollars: 2 } })
    useApp.getState().createAgent()

    expect(useApp.getState().agents.at(-1)).toMatchObject({
      models: ['gpt-6.1-sol'],
      limiter: { mode: 'dollars', dollars: 2 }
    })
  })

  it('shows who is signed in after a successful sign-in, and nobody after a refused one', async () => {
    const person = { id: 'u', name: 'Ada Lovelace', email: 'ada@example.com', provider: 'github' as const }
    let signedIn = false
    const { useApp } = await storeWith({
      ...loads({ json: savedState([workflow()]) }),
      getAccount: async () => ({ connected: true, account: signedIn ? person : null, plan: null }),
      signIn: async (provider) => {
        if (provider === 'google') return { ok: false, message: 'Closed the window' }
        signedIn = true
        return { ok: true }
      }
    })
    await useApp.getState().hydrate()

    expect(await useApp.getState().signIn('google')).toEqual({ ok: false, message: 'Closed the window' })
    expect(useApp.getState().accountState.account).toBeNull()

    await useApp.getState().signIn('github')
    expect(useApp.getState().accountState.account).toEqual(person)
  })
})

describe('loading the workspace', () => {
  beforeEach(() => void vi.unstubAllGlobals())

  it('restores a saved workspace', async () => {
    const { useApp } = await storeWith(loads({ json: savedState([workflow()]) }))
    await useApp.getState().hydrate()

    const state = useApp.getState()
    expect(state.hydrated).toBe(true)
    expect(state.theme).toBe('light')
    expect(state.projects[0].workflows[0].name).toBe('main')
  })

  it('marks a run that was cut off by a restart as interrupted', async () => {
    const node = {
      id: 'n',
      type: 'agent' as const,
      position: { x: 0, y: 0 },
      data: { agentId: 'a', status: 'active' as const, task: 'Writing', tokensUsed: 5, costUsed: 0, activeModel: 'claude-sonnet-5-5' }
    }
    const { useApp } = await storeWith(loads({ json: savedState([workflow({ running: true, runId: 'r', nodes: [node] })]) }))
    await useApp.getState().hydrate()

    const restored = useApp.getState().projects[0].workflows[0]
    expect(restored.running).toBe(false)
    expect(restored.nodes[0].data).toMatchObject({ status: 'idle', task: 'Interrupted' })
  })

  it('starts a first launch even when a preinstalled package cannot be fetched', async () => {
    const { useApp } = await storeWith({
      ...loads({ json: null }),
      downloadPackage: async (pkg) => {
        if (pkg.kind === 'skill') throw new Error('offline')
        return `/library/${pkg.id}.json`
      }
    })
    await useApp.getState().hydrate()

    const { hydrated, loadError, downloads, projects } = useApp.getState()
    expect(hydrated).toBe(true)
    expect(loadError).toBeNull()
    expect(projects.length).toBeGreaterThan(0)
    expect(Object.keys(downloads).sort()).toEqual(['filesystem', 'git', 'github'])
  })

  it('says where an unreadable workspace was kept', async () => {
    const { useApp } = await storeWith({
      ...loads({ json: null, backup: '/data/state.unreadable-1.json' }),
      downloadPackage: async () => '/library/x.json'
    })
    await useApp.getState().hydrate()

    expect(useApp.getState().hydrated).toBe(true)
    expect(useApp.getState().notice).toContain('/data/state.unreadable-1.json')
  })

  it('treats a file main let through but the app cannot use as nothing saved', async () => {
    const { useApp } = await storeWith({ ...loads({ json: '{"projects":[]}' }), downloadPackage: async () => '/x' })
    await useApp.getState().hydrate()
    expect(useApp.getState().projects.length).toBeGreaterThan(0)
  })

  it('restores run records and preferences, and fills in what older files lack', async () => {
    const saved = JSON.parse(savedState([workflow()]))
    const record = { runId: 'r', workflowId: 'w', workflowName: 'main', endedAt: 1, outcome: 'completed', tokens: 10, cost: 0.1, models: [] }
    const withExtras = { ...saved, runs: [record], preferences: { defaultModel: 'gpt-6-luna' } }

    const older = await storeWith(loads({ json: JSON.stringify(saved) }))
    await older.useApp.getState().hydrate()
    expect(older.useApp.getState().runs).toEqual([])
    expect(older.useApp.getState().preferences.defaultModel).toBe('claude-sonnet-5-5')

    const newer = await storeWith(loads({ json: JSON.stringify(withExtras) }))
    await newer.useApp.getState().hydrate()
    expect(newer.useApp.getState().runs).toEqual([record])
    expect(newer.useApp.getState().preferences).toMatchObject({
      defaultModel: 'gpt-6-luna',
      defaultLimiter: { mode: 'tokens', tokens: 100_000 }
    })
  })

  it('reports a failed load and recovers on retry', async () => {
    let attempts = 0
    const { useApp } = await storeWith({
      loadState: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('disk error')
        return { json: savedState([workflow()]) }
      }
    })

    await useApp.getState().hydrate()
    expect(useApp.getState()).toMatchObject({ hydrated: false, loadError: 'disk error' })

    await useApp.getState().hydrate()
    expect(useApp.getState()).toMatchObject({ hydrated: true, loadError: null })
  })
})
