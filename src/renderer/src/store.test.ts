import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutorBridge } from '../../shared/types'
import type { WorkflowNode } from '../../shared/types'
import { workflowStatus } from './usage'

const loadState = vi.fn<() => Promise<string | null>>()
const saveState = vi.fn<(json: string) => Promise<void>>()
const downloadPackage = vi.fn(async (pkg: { id: string }) => `path/${pkg.id}`)

const executor = {
  platform: 'test',
  loadState,
  saveState,
  downloadPackage,
  removePackage: async () => {},
  revealPath: async () => {},
  pickDocs: async () => [],
  openExternal: async () => {},
  apiKeyStatus: async () => ({ anthropic: false, openai: false, google: false }),
  saveApiKey: async () => ({ ok: true }),
  removeApiKey: async () => {},
  startRun: async () => {},
  stopRun: async () => {},
  injectInstruction: async () => {},
  resolveApproval: async () => {},
  getMcpSetups: async () => ({}),
  pickFolders: async () => [],
  saveMcpFolders: async () => {},
  saveMcpSecret: async () => {},
  checkMcpServer: async () => ({ ok: true }),
  searchRegistry: async () => ({ entries: [], nextCursor: null }),
  installRegistryServer: async () => {
    throw new Error('unused')
  },
  removeRegistryServer: async () => {},
  getRegistryServers: async () => ({}),
  searchClawHub: async () => ({ entries: [], nextCursor: null }),
  previewClawHubSkill: async () => {
    throw new Error('unused')
  },
  installClawHubSkill: async () => {
    throw new Error('unused')
  },
  removeClawHubSkill: async () => {},
  getClawHubSkills: async () => ({}),
  onRunEvent: () => () => {}
} satisfies ExecutorBridge

vi.stubGlobal('window', { executor })

const { useApp } = await import('./store')

const node = (status: WorkflowNode['data']['status']): WorkflowNode => ({
  id: `n-${status}`,
  type: 'agent',
  position: { x: 0, y: 0 },
  data: {
    agentId: 'a',
    status,
    task: 'Plan Rollout',
    tokensUsed: 12_000,
    costUsed: 0.24,
    activeModel: 'claude-sonnet-5-5'
  }
})

const savedWorkspace = (running: boolean) =>
  JSON.stringify({
    projects: [
      {
        id: 'p',
        name: 'Core Monorepo',
        tag: 'PR #1482',
        activeWorkflowId: 'w',
        workflows: [
          {
            id: 'w',
            name: 'swe-fleet',
            nodes: [node('active'), node('queued')],
            edges: [],
            running,
            lastRunAt: null,
            log: [],
            sample: true
          }
        ]
      }
    ],
    agents: [],
    downloads: {},
    activeProjectId: 'p',
    theme: 'dark'
  })

describe('hydrate', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    loadState.mockReset()
    saveState.mockReset()
    saveState.mockResolvedValue(undefined)
    downloadPackage.mockClear()
    useApp.setState({
      hydrated: false,
      projects: [],
      agents: [],
      downloads: {},
      activeProjectId: '',
      theme: 'dark',
      builderDraft: null
    })
  })

  it('opens one empty project when nothing is saved', async () => {
    loadState.mockResolvedValue(null)
    await useApp.getState().hydrate()
    const state = useApp.getState()
    expect(state.hydrated).toBe(true)
    expect(state.agents).toEqual([])
    expect(state.projects).toHaveLength(1)
    expect(state.projects[0].name).toBe('Untitled')
    expect(state.projects[0].workflows[0].nodes).toEqual([])
    expect(state.projects[0].workflows[0].name).toBe('main')
    expect(downloadPackage).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    const saved = JSON.parse(String(saveState.mock.calls.at(-1)?.[0]))
    expect(saved.agents).toEqual([])
    expect(saved.projects).toHaveLength(1)
    expect(JSON.stringify(saved)).not.toContain('Core Monorepo')
  })

  it('does not replace a save file that cannot be parsed', async () => {
    loadState.mockResolvedValue('{')
    await useApp.getState().hydrate()
    expect(useApp.getState().hydrated).toBe(false)
    expect(useApp.getState().projects).toEqual([])
    await vi.advanceTimersByTimeAsync(500)
    expect(saveState).not.toHaveBeenCalled()
  })

  it('loads active and queued nodes as idle so the ribbon is not a live run', async () => {
    loadState.mockResolvedValue(savedWorkspace(false))
    await useApp.getState().hydrate()
    const workflow = useApp.getState().projects[0].workflows[0]
    expect(workflow.running).toBe(false)
    expect(workflow.nodes.map((item) => item.data.status)).toEqual(['idle', 'idle'])
    expect(workflow.nodes.map((item) => item.data.task)).toEqual(['Interrupted', 'Interrupted'])
    expect(workflowStatus(workflow)).toBe('stopped')
  })
})

describe('saveDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    loadState.mockReset()
    saveState.mockReset()
    saveState.mockResolvedValue(undefined)
    useApp.setState({
      hydrated: true,
      projects: [],
      agents: [],
      downloads: {},
      activeProjectId: '',
      theme: 'dark',
      builderDraft: null
    })
  })

  it('writes the agent before the chip can read it as saved', async () => {
    useApp.getState().createAgent()
    useApp.getState().updateDraft({ name: 'Renamed' })
    await useApp.getState().saveDraft()
    expect(useApp.getState().agents[0].name).toBe('Renamed')
    const written = saveState.mock.calls.map((call) => JSON.parse(String(call[0])) as { agents: { name: string }[] })
    expect(written.some((state) => state.agents[0]?.name === 'Renamed')).toBe(true)
  })

  it('leaves the draft unsaved when the write fails', async () => {
    useApp.getState().createAgent()
    await vi.advanceTimersByTimeAsync(400)
    useApp.getState().updateDraft({ name: 'Renamed' })
    saveState.mockRejectedValueOnce(new Error('disk full'))
    await useApp.getState().saveDraft()
    expect(useApp.getState().agents[0].name).toBe('Untitled Agent')
    expect(useApp.getState().builderDraft?.name).toBe('Renamed')
  })
})
