export type PackageKind = 'mcp' | 'skill' | 'agent' | 'workflow'
export type AgentStatus = 'active' | 'warning' | 'stopped' | 'idle'
export type WorkflowStatus = 'active' | 'warning' | 'stopped'
export type LimiterMode = 'tokens' | 'dollars'

export interface Limiter {
  mode: LimiterMode
  tokens: number
  dollars: number
}

export interface MemoryDoc {
  id: string
  name: string
  path: string
  size: number
}

export interface AgentTemplate {
  name: string
  description: string
  face: number
  models: string[]
  prompt: string
  mcpServers: string[]
  skills: string[]
  limiter: Limiter
}

export interface Agent extends AgentTemplate {
  id: string
  memory: MemoryDoc[]
  source: 'mine' | 'downloaded'
  packageId?: string
}

// A type alias, not an interface: React Flow requires node data to be a Record.
export type NodeRun = {
  agentId: string
  status: AgentStatus
  task: string
  tokensUsed: number
  activeModel: string
}

export interface WorkflowNode {
  id: string
  type: 'agent'
  position: { x: number; y: number }
  data: NodeRun
  measured?: { width?: number; height?: number }
  selected?: boolean
  dragging?: boolean
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  selected?: boolean
}

export interface LogEntry {
  id: string
  time: string
  nodeId: string | null
  agent: string
  message: string
}

export interface Workflow {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  running: boolean
  lastRunAt: number | null
  schedule?: string
  note?: string
  log: LogEntry[]
}

export interface Project {
  id: string
  name: string
  tag: string
  activeWorkflowId: string
  workflows: Workflow[]
}

export interface WorkflowTemplate {
  name: string
  agents: AgentTemplate[]
  edges: [number, number][]
}

export interface CatalogPackage {
  id: string
  kind: PackageKind
  name: string
  author: string
  summary: string
  tags: string[]
  repo?: string
  install?: string
  transport?: string
  agent?: AgentTemplate
  workflow?: WorkflowTemplate
}

export interface DownloadRecord {
  packageId: string
  path: string
  downloadedAt: number
}

export interface PickedDoc {
  name: string
  path: string
  size: number
}

export interface ExecutorBridge {
  platform: string
  loadState(): Promise<string | null>
  saveState(json: string): Promise<void>
  downloadPackage(pkg: CatalogPackage): Promise<string>
  removePackage(pkg: CatalogPackage): Promise<void>
  revealPath(path: string): Promise<void>
  pickDocs(): Promise<PickedDoc[]>
  openExternal(url: string): Promise<void>
}
