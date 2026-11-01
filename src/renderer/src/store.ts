import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from '@xyflow/react'
import { create } from 'zustand'
import type {
  Agent,
  AgentTemplate,
  CatalogPackage,
  DownloadRecord,
  Project,
  Workflow,
  WorkflowEdge,
  WorkflowNode
} from '../../shared/types'
import { bridge } from './bridge'
import { packageById, PREINSTALLED } from './data/catalog'
import { createSeed } from './data/seed'
import { logEntry, startRun, stopRun, tickWorkflow } from './sim'

export type Page = 'canvas' | 'builder' | 'marketplace'
export type BuilderSection = 'prompt' | 'mcp' | 'skills' | 'memory'
export type Theme = 'dark' | 'light'

const NODE_WIDTH = 180
const COLUMN_GAP = 64
const ROW_GAP = 40
const NODE_HEIGHT = 104

interface Persisted {
  projects: Project[]
  agents: Agent[]
  downloads: Record<string, DownloadRecord>
  activeProjectId: string
  theme: Theme
}

interface AppState extends Persisted {
  hydrated: boolean
  page: Page
  drawerTab: 'workflows' | 'agents'
  drawerOpen: boolean
  inspectorOpen: boolean
  logsOpen: boolean
  switcherOpen: boolean
  creatingWorkflow: boolean
  builderDraft: Agent | null
  builderSection: BuilderSection | null

  hydrate(): Promise<void>
  setPage(page: Page): void
  setUi(patch: Partial<Pick<AppState, 'drawerTab' | 'drawerOpen' | 'inspectorOpen' | 'logsOpen' | 'switcherOpen' | 'creatingWorkflow' | 'builderSection'>>): void
  setTheme(theme: Theme): void

  selectProject(id: string): void
  addProject(name: string): void
  selectWorkflow(id: string): void
  addWorkflow(name: string): void

  applyNodes(changes: NodeChange<WorkflowNode>[]): void
  applyEdges(changes: EdgeChange<WorkflowEdge>[]): void
  connect(connection: Connection): void
  addAgentNode(agentId: string, position: { x: number; y: number }): void
  autoLayout(): void
  toggleRun(): void
  tick(): void
  inject(nodeId: string, text: string): void
  setNodeModel(nodeId: string, model: string): void
  togglePause(nodeId: string): void

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
    data: { agentId: agent.id, status: 'idle', task: 'Ready', tokensUsed: 0, activeModel: agent.models[0] ?? '' }
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
  creatingWorkflow: false,
  builderDraft: null,
  builderSection: null,

  async hydrate() {
    const saved = await bridge.loadState()
    if (saved) {
      try {
        const state = JSON.parse(saved) as Persisted
        set({
          ...state,
          projects: state.projects.map((project) => ({
            ...project,
            workflows: project.workflows.map((workflow) => ({ ...workflow, running: false }))
          })),
          hydrated: true
        })
        return
      } catch (error) {
        console.error('Saved state is unreadable, starting from sample data', error)
      }
    }

    const downloads: Record<string, DownloadRecord> = {}
    for (const id of PREINSTALLED) {
      const pkg = packageById(id)
      if (pkg) downloads[id] = { packageId: id, path: await bridge.downloadPackage(pkg), downloadedAt: Date.now() }
    }
    set({ ...createSeed(), downloads, hydrated: true })
  },

  setPage(page) {
    if (page === 'builder' && !get().builderDraft) {
      const first = get().agents[0]
      if (first) set({ builderDraft: structuredClone(first) })
    }
    set({ page })
  },

  setUi: (patch) => set(patch),
  setTheme: (theme) => set({ theme }),

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

  toggleRun: () =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => (workflow.running ? stopRun(workflow) : startRun(workflow)))
    ),

  tick() {
    const { projects, agents } = get()
    const anyRunning = projects.some((project) => project.workflows.some((workflow) => workflow.running))
    if (!anyRunning) return
    set({
      projects: projects.map((project) => ({
        ...project,
        workflows: project.workflows.map((workflow) => (workflow.running ? tickWorkflow(workflow, agents) : workflow))
      }))
    })
  },

  inject: (nodeId, text) =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => {
        const node = workflow.nodes.find((candidate) => candidate.id === nodeId)
        const agent = state.agents.find((candidate) => candidate.id === node?.data.agentId)
        return {
          ...workflow,
          log: [...workflow.log, logEntry(nodeId, agent?.name ?? 'Agent', `Instruction injected: ${text}`)]
        }
      })
    ),

  setNodeModel: (nodeId, model) =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => ({
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, activeModel: model } } : node
        )
      }))
    ),

  togglePause: (nodeId) =>
    set((state) =>
      withActiveWorkflow(state, (workflow) => {
        const nodes = workflow.nodes.map((node) => {
          if (node.id !== nodeId) return node
          const status = node.data.status === 'active' ? ('idle' as const) : ('active' as const)
          return { ...node, data: { ...node.data, status } }
        })
        return { ...workflow, nodes, running: workflow.running || nodes.some((node) => node.data.status === 'active') }
      })
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
      models: ['claude-sonnet-5-5'],
      prompt: '',
      mcpServers: [],
      skills: [],
      memory: [],
      limiter: { mode: 'tokens', tokens: 100_000, dollars: 5 },
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
    set((state) => {
      const { [pkg.id]: _removed, ...downloads } = state.downloads
      const ownedIds = new Set(owned.map((agent) => agent.id))
      const detach = (ids: string[]) => ids.filter((id) => id !== pkg.id)
      return {
        downloads,
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

let saveTimer: ReturnType<typeof setTimeout> | undefined

useApp.subscribe((state, previous) => {
  if (!state.hydrated) return
  const keys: (keyof Persisted)[] = ['projects', 'agents', 'downloads', 'activeProjectId', 'theme']
  if (keys.every((key) => state[key] === previous[key])) return

  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { projects, agents, downloads, activeProjectId, theme } = useApp.getState()
    void bridge.saveState(JSON.stringify({ projects, agents, downloads, activeProjectId, theme }))
  }, 400)
})
