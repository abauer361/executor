import type { McpStoredSetup } from './mcpServers'

export type PackageKind = 'mcp' | 'skill' | 'agent' | 'workflow'
export type AgentStatus = 'active' | 'queued' | 'warning' | 'stopped' | 'idle'
export type WorkflowStatus = 'active' | 'warning' | 'stopped' | 'completed'
export type RunOutcome = 'completed' | 'stopped' | 'halted' | 'failed'
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
  costUsed: number
  activeModel: string
  output?: string
  instructions?: string[]
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
  sample?: boolean
  runId?: string
  goal?: string
  outcome?: RunOutcome
  approvals?: PendingApproval[]
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

export interface McpCheckResult {
  ok: boolean
  tools?: number
  message?: string
}

export interface DownloadRecord {
  packageId: string
  path: string
  downloadedAt: number
  check?: McpCheckResult
}

export interface PickedDoc {
  name: string
  path: string
  size: number
}

export interface RunNodeSpec {
  id: string
  name: string
  prompt: string
  model: string
  limiter: Limiter
  instructions: string[]
  mcpServers: string[]
  skills: string[]
  memory: MemoryDoc[]
}

export interface PendingApproval {
  id: string
  nodeId: string
  agent: string
  tool: string
  input: string
}

export type ApprovalDecision = 'allow' | 'always' | 'deny'

export interface RunRequest {
  runId: string
  goal: string
  nodes: RunNodeSpec[]
  edges: { source: string; target: string }[]
}

export type RunEvent =
  | { type: 'node'; runId: string; nodeId: string; status: AgentStatus; task: string }
  | { type: 'usage'; runId: string; nodeId: string; tokens: number; cost: number }
  | { type: 'output'; runId: string; nodeId: string; text: string }
  | { type: 'log'; runId: string; nodeId: string | null; agent: string; message: string }
  | { type: 'approval'; runId: string; approval: PendingApproval }
  | { type: 'approval-resolved'; runId: string; approvalId: string }
  | { type: 'end'; runId: string; outcome: RunOutcome; message?: string }

export interface KeyResult {
  ok: boolean
  message?: string
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
  hasApiKey(): Promise<boolean>
  saveApiKey(key: string): Promise<KeyResult>
  removeApiKey(): Promise<void>
  startRun(request: RunRequest): Promise<void>
  stopRun(runId: string): Promise<void>
  injectInstruction(runId: string, nodeId: string, text: string): Promise<void>
  resolveApproval(runId: string, approvalId: string, decision: ApprovalDecision): Promise<void>
  getMcpSetups(): Promise<Record<string, McpStoredSetup>>
  pickFolders(multiple: boolean): Promise<string[]>
  saveMcpFolders(id: string, key: string, folders: string[]): Promise<void>
  saveMcpSecret(id: string, key: string, value: string): Promise<void>
  checkMcpServer(id: string): Promise<McpCheckResult>
  onRunEvent(listener: (event: RunEvent) => void): () => void
}
