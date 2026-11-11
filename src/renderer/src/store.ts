import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import {
  DEFAULT_PREFERENCES,
  RUN_HISTORY_LIMIT,
  type AccountResult,
  type AccountState,
  type Preferences,
  type RunRecord,
  type SignInProvider
} from '../../shared/account'
import type { McpStoredSetup } from '../../shared/mcpServers'
import { parsePersisted, STATE_VERSION, type Persisted, type Theme } from '../../shared/persisted'
import type { Provider } from '../../shared/pricing'
import type { ClawHubPreview, InstalledClawHubSkill } from '../../shared/clawhub'
import type { InstalledRegistryServer, RegistryEntry } from '../../shared/registry'
import type {
  Agent,
  AgentTemplate,
  ApprovalDecision,
  CatalogPackage,
  DownloadRecord,
  KeyResult,
  Project,
  RunEvent,
  Workflow,
  WorkflowEdge,
  WorkflowNode
} from '../../shared/types'
import { bridge } from './bridge'
import { clawhubPackage, packageById, PREINSTALLED, registryPackage } from './data/catalog'
import { RETIRED_MODELS } from './data/models'
import { createSeed } from './data/seed'
import { buildRunRequest, prepareRun, reduceRunEvents, runRecord, serverState } from './runState'
import { createSaveScheduler } from './saveScheduler'
import { appendLog, logEntry, sampleCost } from './usage'

export type Page = 'canvas' | 'builder' | 'marketplace'
export type BuilderSection = 'prompt' | 'mcp' | 'skills' | 'memory'
export type { Theme }

const NODE_WIDTH = 180
const COLUMN_GAP = 64
const ROW_GAP = 40
const NODE_HEIGHT = 104

interface AppState extends Persisted {
  hydrated: boolean
  notice: string | null
  loadError: string | null
  accountState: AccountState
  runs: RunRecord[]
  preferences: Preferences
  profileOpen: boolean
  apiKeys: Record<Provider, boolean>
  mcpSetups: Record<string, McpStoredSetup>
  mcpChecking: string[]
  registryServers: Record<string, InstalledRegistryServer>
  clawhubSkills: Record<string, InstalledClawHubSkill>
  page: Page
  drawerTab: 'workflows' | 'agents'
  drawerOpen: boolean
  inspectorOpen: boolean
  logsOpen: boolean
  switcherOpen: boolean
  settingsOpen: boolean
  runPanelOpen: boolean
  creatingWorkflow: boolean
  builderDraft: Agent | null
  builderSection: BuilderSection | null

  hydrate(): Promise<void>
  dismissNotice(): void
  setPage(page: Page): void
  setUi(patch: Partial<Pick<AppState, 'drawerTab' | 'drawerOpen' | 'inspectorOpen' | 'logsOpen' | 'switcherOpen' | 'settingsOpen' | 'profileOpen' | 'runPanelOpen' | 'creatingWorkflow' | 'builderSection'>>): void
  setTheme(theme: Theme): void
  signIn(provider: SignInProvider): Promise<AccountResult>
  signOut(): Promise<void>
  setPreferences(patch: Partial<Preferences>): void
  saveApiKey(provider: Provider, key: string): Promise<KeyResult>
  removeApiKey(provider: Provider): Promise<void>
  saveMcpFolders(id: string, key: string, folders: string[]): Promise<void>
  saveMcpSecret(id: string, key: string, value: string): Promise<void>
  checkMcpServer(id: string): Promise<void>
  installRegistryServer(entry: RegistryEntry): Promise<void>
  installClawHubSkill(preview: ClawHubPreview): Promise<void>

  selectProject(id: string): void
  addProject(name: string): void
  selectWorkflow(id: string): void
  addWorkflow(name: string): void

  applyNodes(changes: NodeChange<WorkflowNode>[]): void
  applyEdges(changes: EdgeChange<WorkflowEdge>[]): void
  connect(connection: Connection): void
  addAgentNode(agentId: string, position: { x: number; y: number }): void
  autoLayout(): void
  beginRun(goal: string): void
  stopRun(): void
  applyRunEvents(events: RunEvent[]): void
  answerApproval(approvalId: string, decision: ApprovalDecision): void
  inject(nodeId: string, text: string): void
  setNodeModel(nodeId: string, model: string): void

  openBuilder(agentId: string, section?: BuilderSection): void
  updateDraft(patch: Partial<Agent>): void
  saveDraft(): void
  createAgent(): void
  deleteAgent(agentId: string): void

  downloadPackage(pkg: CatalogPackage): Promise<void>
  removePackage(pkg: CatalogPackage): Promise<void>
  addTemplateToProject(pkg: CatalogPackage): void
}

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

export const activeProject = (state: Persisted) =>
  state.projects.find((project) => project.id === state.activeProjectId) ?? state.projects[0]

export const activeWorkflow = (state: Persisted) => {
  const project = activeProject(state)
  return project.workflows.find((workflow) => workflow.id === project.activeWorkflowId) ?? project.workflows[0]
}

function withActiveWorkflow(state: Persisted, update: (workflow: Workflow) => Workflow) {
  const current = activeWorkflow(state)
  return {
    projects: state.projects.map((project) =>
      project.id !== state.activeProjectId
        ? project
        : {
            ...project,
            workflows: project.workflows.map((workflow) => (workflow === current ? update(workflow) : workflow))
          }
    )
  }
}

function emptyWorkflow(name: string): Workflow {
  return { id: uid('wf'), name, nodes: [], edges: [], running: false, lastRunAt: null, log: [] }
}

function createNode(agent: Agent, position: { x: number; y: number }): WorkflowNode {
  return {
    id: uid('node'),
    type: 'agent',
    position,
    data: {
      agentId: agent.id,
      status: 'idle',
      task: 'Ready',
      tokensUsed: 0,
      costUsed: 0,
      activeModel: agent.models[0] ?? ''
    }
  }
}

const currentModel = (model: string) => RETIRED_MODELS[model] ?? model

// A run cannot survive a restart, and state saved by older versions has no cost field.
function restoreWorkflow(workflow: Workflow): Workflow {
  return {
    ...workflow,
    running: false,
    sample: workflow.sample ?? (workflow.runId === undefined && workflow.nodes.some((node) => node.data.tokensUsed > 0)),
    nodes: workflow.nodes.map((node) => {
      const interrupted = workflow.running && ['active', 'queued'].includes(node.data.status)
      return {
        ...node,
        data: {
          ...node.data,
          activeModel: currentModel(node.data.activeModel),
          costUsed: node.data.costUsed ?? sampleCost(node.data.tokensUsed),
          status: interrupted ? 'idle' : node.data.status,
          task: interrupted ? 'Interrupted' : node.data.task
        }
      }
    })
  }
}

const agentFromTemplate = (template: AgentTemplate, id: string, packageId: string): Agent => ({
  ...template,
  id,
  memory: [],
  source: 'downloaded',
  packageId
})

function removeAgentFromProjects(projects: Project[], agentId: string) {
  return projects.map((project) => ({
    ...project,
    workflows: project.workflows.map((workflow) => {
      const removed = new Set(workflow.nodes.filter((node) => node.data.agentId === agentId).map((node) => node.id))
      if (removed.size === 0) return workflow
      return {
        ...workflow,
        nodes: workflow.nodes.filter((node) => !removed.has(node.id)),
        edges: workflow.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
      }
    })
  }))
}

const agentInUse = (projects: Project[], agentId: string) =>
  projects.some((project) =>
    project.workflows.some((workflow) => workflow.nodes.some((node) => node.data.agentId === agentId))
  )

// Places each node one column to the right of its deepest upstream node.
function layeredPositions(workflow: Workflow) {
  const depth = new Map(workflow.nodes.map((node) => [node.id, 0]))
  for (let pass = 0; pass < workflow.nodes.length; pass++) {
    for (const edge of workflow.edges) {
      const next = (depth.get(edge.source) ?? 0) + 1
      if (next > (depth.get(edge.target) ?? 0) && next < workflow.nodes.length) depth.set(edge.target, next)
    }
  }
  const rows = new Map<number, number>()
  const columnSize = new Map<number, number>()
  for (const value of depth.values()) columnSize.set(value, (columnSize.get(value) ?? 0) + 1)
  const tallest = Math.max(1, ...columnSize.values())

  return new Map(
    workflow.nodes.map((node) => {
      const column = depth.get(node.id) ?? 0
      const row = rows.get(column) ?? 0
      rows.set(column, row + 1)
      const offset = ((tallest - (columnSize.get(column) ?? 1)) * (NODE_HEIGHT + ROW_GAP)) / 2
      return [
        node.id,
        { x: 32 + column * (NODE_WIDTH + COLUMN_GAP), y: 96 + offset + row * (NODE_HEIGHT + ROW_GAP) }
      ]
    })
  )
}

export const useApp = create<AppState>((set, get) => ({
  hydrated: false,
  notice: null,
  loadError: null,
  accountState: { connected: false, account: null, plan: null },
  runs: [],
  preferences: DEFAULT_PREFERENCES,
  profileOpen: false,
  apiKeys: { anthropic: false, openai: false, google: false },
  mcpSetups: {},
  mcpChecking: [],
  registryServers: {},
  clawhubSkills: {},
  projects: [],
  agents: [],
  downloads: {},
  activeProjectId: '',
  theme: 'dark',
  page: 'canvas',
  drawerTab: 'agents',
  drawerOpen: true,
  inspectorOpen: false,
  logsOpen: false,
  switcherOpen: false,
  settingsOpen: false,
  runPanelOpen: false,
  creatingWorkflow: false,
  builderDraft: null,
  builderSection: null,

  async hydrate() {
    set({ loadError: null })
    try {
      await loadWorkspace()
    } catch (error) {
      set({ loadError: error instanceof Error ? error.message : String(error) })
    }
  },

  setPage(page) {
    if (page === 'builder' && !get().builderDraft) {
      const first = get().agents[0]
      if (first) set({ builderDraft: structuredClone(first) })
    }
    set({ page })
  },

  dismissNotice: () => set({ notice: null }),

  setUi: (patch) => set(patch),
  setTheme: (theme) => set({ theme }),

  async signIn(provider) {
    const result = await bridge.signIn(provider)
    if (result.ok) set({ accountState: await bridge.getAccount() })
    return result
  },

  async signOut() {
    await bridge.signOut()
    set({ accountState: await bridge.getAccount() })
  },

  setPreferences: (patch) => set((state) => ({ preferences: { ...state.preferences, ...patch } })),

  async saveApiKey(provider, key) {
    const result = await bridge.saveApiKey(provider, key)
    if (result.ok) set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: true } }))
    return result
  },

  async removeApiKey(provider) {
    await bridge.removeApiKey(provider)
    set((state) => ({ apiKeys: { ...state.apiKeys, [provider]: false } }))
  },

  async installRegistryServer(entry) {
    const server = await bridge.installRegistryServer(entry.name, entry.version)
    const path = await bridge.downloadPackage(registryPackage(server))
    const mcpSetups = await bridge.getMcpSetups()
    set((state) => ({
      mcpSetups,
      registryServers: { ...state.registryServers, [server.id]: server },
      downloads: { ...state.downloads, [server.id]: { packageId: server.id, path, downloadedAt: Date.now() } }
    }))
    const { downloads, registryServers } = get()
    if (serverState(server.id, downloads, mcpSetups, registryServers) === 'ready') await get().checkMcpServer(server.id)
  },

  async installClawHubSkill(preview) {
    const { owner, slug } = preview.entry
    const skill = await bridge.installClawHubSkill(owner, slug, preview.version, preview.sha256)
    let path: string
    try {
      path = await bridge.downloadPackage(clawhubPackage(skill))
    } catch (error) {
      await bridge.removeClawHubSkill(skill.id)
      throw error
    }
    set((state) => ({
      clawhubSkills: { ...state.clawhubSkills, [skill.id]: skill },
      downloads: { ...state.downloads, [skill.id]: { packageId: skill.id, path, downloadedAt: Date.now() } }
    }))
  },

  async saveMcpFolders(id, key, folders) {
    await bridge.saveMcpFolders(id, key, folders)
    set({ mcpSetups: await bridge.getMcpSetups() })
    await get().checkMcpServer(id)
  },

  async saveMcpSecret(id, key, value) {
    await bridge.saveMcpSecret(id, key, value)
    set({ mcpSetups: await bridge.getMcpSetups() })
    await get().checkMcpServer(id)
  },

  async checkMcpServer(id) {
    set((state) => ({ mcpChecking: [...state.mcpChecking, id] }))
    const check = await bridge.checkMcpServer(id)
    set((state) => ({
      mcpChecking: state.mcpChecking.filter((candidate) => candidate !== id),
      downloads: state.downloads[id]
        ? { ...state.downloads, [id]: { ...state.downloads[id], check } }
        : state.downloads
    }))
  },

  selectProject: (id) => set({ activeProjectId: id, switcherOpen: false }),

  addProject(name) {
    const workflow = emptyWorkflow('main')
    const project: Project = {
      id: uid('project'),
      name,
      tag: 'New project',
      activeWorkflowId: workflow.id,
      workflows: [workflow]
    }
    set((state) => ({ projects: [...state.projects, project], activeProjectId: project.id, switcherOpen: false }))
  },

  selectWorkflow: (id) =>
    set((state) => ({
      projects: state.projects.map((project) =>
        project.id === state.activeProjectId ? { ...project, activeWorkflowId: id } : project
      )
    })),

  addWorkflow(name) {
    const workflow = emptyWorkflow(name)
    set((state) => ({
      creatingWorkflow: false,
      projects: state.projects.map((project) =>
        project.id === state.activeProjectId
          ? { ...project, workflows: [...project.workflows, workflow], activeWorkflowId: workflow.id }
          : project
      )
    }))
  },

  applyNodes: (changes) =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => ({
        ...workflow,
        nodes: applyNodeChanges(changes, workflow.nodes)
      }))
    ),

  applyEdges: (changes) =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => ({
        ...workflow,
        edges: applyEdgeChanges(changes, workflow.edges)
      }))
    ),

  connect: (connection) =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => ({
        ...workflow,
        edges: addEdge<WorkflowEdge>({ ...connection, id: uid('edge') }, workflow.edges)
      }))
    ),

  addAgentNode(agentId, position) {
    const agent = get().agents.find((candidate) => candidate.id === agentId)
    if (!agent) return
    set((state) =>
      withActiveWorkflow(state, (workflow) => ({ ...workflow, nodes: [...workflow.nodes, createNode(agent, position)] }))
    )
  },

  autoLayout: () =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => {
        const positions = layeredPositions(workflow)
        return {
          ...workflow,
          nodes: workflow.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }))
        }
      })
    ),

  beginRun(goal) {
    const state = get()
    const runId = crypto.randomUUID()
    const request = buildRunRequest(activeWorkflow(state), state.agents, goal, runId)
    set({ runPanelOpen: false, ...withActiveWorkflow(state, (workflow) => prepareRun(workflow, goal, runId)) })
    bridge.startRun(request).catch((error: Error) => {
      get().applyRunEvents([{ type: 'end', runId, outcome: 'failed', message: error.message }])
    })
  },

  stopRun() {
    const { runId } = activeWorkflow(get())
    if (runId) void bridge.stopRun(runId)
  },

  // Takes a batch so that a burst of streaming events costs one update.
  applyRunEvents: (events) =>
    set((state) => {
      const activeRunId = activeWorkflow(state).runId
      const needsAttention = events.some(
        (event) =>
          event.runId === activeRunId &&
          (event.type === 'approval' || (event.type === 'end' && event.outcome === 'completed'))
      )
      const projects = reduceRunEvents(state.projects, events)
      const inspectorOpen = state.inspectorOpen || needsAttention
      if (projects === state.projects && inspectorOpen === state.inspectorOpen) return state

      // Each run that just ended leaves one record of its numbers behind.
      const ended = new Set(events.flatMap((event) => (event.type === 'end' ? [event.runId] : [])))
      const known = new Set(state.runs.map((record) => record.runId))
      const finished = projects
        .flatMap((project) => project.workflows)
        .filter((workflow) => workflow.runId && ended.has(workflow.runId) && !known.has(workflow.runId))
        .flatMap((workflow) => runRecord(workflow, state.agents) ?? [])
      const runs = finished.length ? [...state.runs, ...finished].slice(-RUN_HISTORY_LIMIT) : state.runs
      return { projects, inspectorOpen, runs }
    }),

  answerApproval(approvalId, decision) {
    const { runId } = activeWorkflow(get())
    if (runId) void bridge.resolveApproval(runId, approvalId, decision)
  },

  // Instructions join an agent's opening message, so they can only reach one that has not started.
  inject(nodeId, text) {
    const state = get()
    const current = activeWorkflow(state)
    const node = current.nodes.find((candidate) => candidate.id === nodeId)
    const agent = state.agents.find((candidate) => candidate.id === node?.data.agentId)
    if (!node) return

    if (current.running && current.runId) void bridge.injectInstruction(current.runId, nodeId, text)
    set(
      withActiveWorkflow(state, (workflow) => ({
        ...workflow,
        log: appendLog(workflow.log, [logEntry(nodeId, agent?.name ?? 'Agent', `Instruction added: ${text}`)]),
        nodes: workflow.nodes.map((candidate) =>
          candidate.id === nodeId && !workflow.running
            ? {
                ...candidate,
                data: { ...candidate.data, instructions: [...(candidate.data.instructions ?? []), text] }
              }
            : candidate
        )
      }))
    )
  },

  setNodeModel: (nodeId, model) =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => ({
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, activeModel: model } } : node
        )
      }))
    ),

  openBuilder(agentId, section) {
    const { builderDraft, agents } = get()
    const saved = agents.find((agent) => agent.id === builderDraft?.id)
    const dirty = builderDraft && saved && JSON.stringify(saved) !== JSON.stringify(builderDraft)
    if (dirty && builderDraft.id !== agentId && !window.confirm(`Discard unsaved changes to ${builderDraft.name}?`)) {
      set({ page: 'builder' })
      return
    }
    const agent = agents.find((candidate) => candidate.id === agentId)
    if (agent) set({ page: 'builder', builderDraft: structuredClone(agent), builderSection: section ?? null })
  },

  updateDraft: (patch) =>
    set((state) => (state.builderDraft ? { builderDraft: { ...state.builderDraft, ...patch } } : state)),

  saveDraft() {
    const { builderDraft } = get()
    if (!builderDraft) return
    set((state) => ({
      agents: state.agents.map((agent) => (agent.id === builderDraft.id ? structuredClone(builderDraft) : agent))
    }))
  },

  createAgent() {
    const agent: Agent = {
      id: uid('agent'),
      name: 'Untitled Agent',
      description: '',
      face: get().agents.length % 5,
      models: [get().preferences.defaultModel],
      prompt: '',
      mcpServers: [],
      skills: [],
      memory: [],
      limiter: { ...get().preferences.defaultLimiter },
      source: 'mine'
    }
    set((state) => ({ agents: [...state.agents, agent] }))
    get().openBuilder(agent.id)
  },

  deleteAgent(agentId) {
    const { projects, agents } = get()
    const agent = agents.find((candidate) => candidate.id === agentId)
    if (!agent) return
    const message = agentInUse(projects, agentId)
      ? `Delete ${agent.name}? It will also be removed from every workflow that uses it.`
      : `Delete ${agent.name}?`
    if (!window.confirm(message)) return

    const remaining = agents.filter((candidate) => candidate.id !== agentId)
    set({
      agents: remaining,
      projects: removeAgentFromProjects(projects, agentId),
      builderDraft: remaining[0] ? structuredClone(remaining[0]) : null
    })
  },

  async downloadPackage(pkg) {
    const path = await bridge.downloadPackage(pkg)
    set((state) => ({
      downloads: { ...state.downloads, [pkg.id]: { packageId: pkg.id, path, downloadedAt: Date.now() } },
      agents: pkg.agent
        ? [...state.agents, agentFromTemplate(pkg.agent, `pkg-${pkg.id}`, pkg.id)]
        : state.agents
    }))
    if (pkg.kind === 'mcp' && serverState(pkg.id, get().downloads, get().mcpSetups, get().registryServers) === 'ready') {
      await get().checkMcpServer(pkg.id)
    }
  },

  async removePackage(pkg) {
    const { projects, agents } = get()
    const owned = agents.filter((agent) => agent.packageId === pkg.id)
    if (
      owned.some((agent) => agentInUse(projects, agent.id)) &&
      !window.confirm(`Remove ${pkg.name}? Its agents will also be removed from your workflows.`)
    ) {
      return
    }

    await bridge.removePackage(pkg)
    if (get().registryServers[pkg.id]) await bridge.removeRegistryServer(pkg.id)
    if (get().clawhubSkills[pkg.id]) await bridge.removeClawHubSkill(pkg.id)
    set((state) => {
      const { [pkg.id]: _removed, ...downloads } = state.downloads
      const { [pkg.id]: _removedServer, ...registryServers } = state.registryServers
      const { [pkg.id]: _removedSkill, ...clawhubSkills } = state.clawhubSkills
      const ownedIds = new Set(owned.map((agent) => agent.id))
      const detach = (ids: string[]) => ids.filter((id) => id !== pkg.id)
      return {
        downloads,
        registryServers,
        clawhubSkills,
        projects: owned.reduce((next, agent) => removeAgentFromProjects(next, agent.id), state.projects),
        agents: state.agents
          .filter((agent) => !ownedIds.has(agent.id))
          .map((agent) => ({ ...agent, mcpServers: detach(agent.mcpServers), skills: detach(agent.skills) })),
        builderDraft:
          state.builderDraft && ownedIds.has(state.builderDraft.id)
            ? null
            : state.builderDraft && {
                ...state.builderDraft,
                mcpServers: detach(state.builderDraft.mcpServers),
                skills: detach(state.builderDraft.skills)
              }
      }
    })
  },

  addTemplateToProject(pkg) {
    const template = pkg.workflow
    if (!template) return

    const created = template.agents.map((agent, index) =>
      agentFromTemplate(agent, `pkg-${pkg.id}-${index}`, pkg.id)
    )
    const workflow = emptyWorkflow(template.name)
    workflow.nodes = created.map((agent, index) =>
      createNode(agent, { x: 32 + index * (NODE_WIDTH + COLUMN_GAP), y: 180 })
    )
    workflow.edges = template.edges.map(([source, target]) => ({
      id: uid('edge'),
      source: workflow.nodes[source].id,
      target: workflow.nodes[target].id
    }))
    const positions = layeredPositions(workflow)
    workflow.nodes = workflow.nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }))

    set((state) => ({
      page: 'canvas',
      agents: [
        ...state.agents,
        ...created.filter((agent) => !state.agents.some((existing) => existing.id === agent.id))
      ],
      projects: state.projects.map((project) =>
        project.id === state.activeProjectId
          ? { ...project, workflows: [...project.workflows, workflow], activeWorkflowId: workflow.id }
          : project
      )
    }))
  }
}))

// Reads everything the app needs to draw its first screen.
async function loadWorkspace() {
  const { setState: set } = useApp
  set({
    apiKeys: await bridge.apiKeyStatus().catch(() => useApp.getState().apiKeys),
    mcpSetups: await bridge.getMcpSetups().catch(() => ({})),
    registryServers: await bridge.getRegistryServers().catch(() => ({})),
    clawhubSkills: await bridge.getClawHubSkills().catch(() => ({})),
    accountState: await bridge.getAccount().catch(() => useApp.getState().accountState)
  })
  const saved = await bridge.loadState()
  const state = saved.json === null ? null : parsePersisted(saved.json)
  if (state) {
    set({
      projects: state.projects.map((project) => ({
        ...project,
        workflows: project.workflows.map(restoreWorkflow)
      })),
      agents: state.agents.map((agent) => ({ ...agent, models: [...new Set(agent.models.map(currentModel))] })),
      downloads: state.downloads,
      activeProjectId: state.activeProjectId,
      theme: state.theme === 'light' ? 'light' : 'dark',
      runs: Array.isArray(state.runs) ? state.runs : [],
      preferences: { ...DEFAULT_PREFERENCES, ...state.preferences },
      hydrated: true
    })
    return
  }
  if (saved.backup) {
    set({
      notice: `Your saved workspace could not be read, so Executor started fresh. The old file was kept at ${saved.backup}`
    })
  }

  // Preinstalled packages are a convenience. One that cannot be fetched, such as a skill while
  // offline, is left for the Marketplace instead of holding up the first launch.
  const downloads: Record<string, DownloadRecord> = {}
  await Promise.all(
    PREINSTALLED.map(async (id) => {
      const pkg = packageById(id)
      if (!pkg) return
      try {
        downloads[id] = { packageId: id, path: await bridge.downloadPackage(pkg), downloadedAt: Date.now() }
      } catch {
        // Not downloaded.
      }
    })
  )
  set({ ...createSeed(), downloads, hydrated: true })
}

const saves = createSaveScheduler(() => {
  const { projects, agents, downloads, activeProjectId, theme, runs, preferences } = useApp.getState()
  const saved: Persisted = { version: STATE_VERSION, projects, agents, downloads, activeProjectId, theme, runs, preferences }
  void bridge.saveState(JSON.stringify(saved))
})

useApp.subscribe((state, previous) => {
  if (!state.hydrated) return
  const keys = ['projects', 'agents', 'downloads', 'activeProjectId', 'theme', 'runs', 'preferences'] as const
  if (keys.every((key) => state[key] === previous[key])) return
  saves.request()
})

// Closing the window or quitting must not drop the last changes.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', saves.flush)
  window.addEventListener('pagehide', saves.flush)
}
