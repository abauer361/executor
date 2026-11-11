import type { ClawHubEntry, ClawHubPreview, InstalledClawHubSkill } from './clawhub'
import type { McpStoredSetup } from './mcpServers'
import type { Provider } from './pricing'
import type { InstalledRegistryServer, RegistryEntry } from './registry'
import type {
  ApprovalDecision,
  CatalogPackage,
  KeyResult,
  LoadedState,
  McpCheckResult,
  PickedDoc,
  RunRequest
} from './types'

// Every request the interface can make of the main process: its channel, arguments and result.
// Preload and main are both typed from this, so a change here fails to compile until both agree.
export interface IpcContract {
  'state:load': { args: []; result: LoadedState }
  'state:save': { args: [json: string]; result: void }
  'library:download': { args: [pkg: CatalogPackage]; result: string }
  'library:remove': { args: [pkg: CatalogPackage]; result: void }
  'library:reveal': { args: [path: string]; result: void }
  'docs:pick': { args: []; result: PickedDoc[] }
  'shell:open': { args: [url: string]; result: void }
  'key:status': { args: []; result: Record<Provider, boolean> }
  'key:save': { args: [provider: Provider, key: string]; result: KeyResult }
  'key:remove': { args: [provider: Provider]; result: void }
  'run:start': { args: [request: RunRequest]; result: void }
  'run:stop': { args: [runId: string]; result: void }
  'run:inject': { args: [runId: string, nodeId: string, text: string]; result: void }
  'run:approve': { args: [runId: string, approvalId: string, decision: ApprovalDecision]; result: void }
  'mcp:setups': { args: []; result: Record<string, McpStoredSetup> }
  'mcp:pick-folders': { args: [multiple: boolean]; result: string[] }
  'mcp:save-folders': { args: [id: string, key: string, folders: string[]]; result: void }
  'mcp:save-secret': { args: [id: string, key: string, value: string]; result: void }
  'mcp:check': { args: [id: string]; result: McpCheckResult }
  'registry:search': {
    args: [query: string, cursor?: string]
    result: { entries: RegistryEntry[]; nextCursor: string | null }
  }
  'registry:install': { args: [name: string, version: string]; result: InstalledRegistryServer }
  'registry:remove': { args: [id: string]; result: void }
  'registry:servers': { args: []; result: Record<string, InstalledRegistryServer> }
  'clawhub:search': {
    args: [query: string, cursor?: string]
    result: { entries: ClawHubEntry[]; nextCursor: string | null }
  }
  'clawhub:preview': { args: [owner: string, slug: string]; result: ClawHubPreview }
  'clawhub:install': {
    args: [owner: string, slug: string, version: string, sha256: string]
    result: InstalledClawHubSkill
  }
  'clawhub:remove': { args: [id: string]; result: void }
  'clawhub:skills': { args: []; result: Record<string, InstalledClawHubSkill> }
}

export type IpcChannel = keyof IpcContract
export type IpcArgs<C extends IpcChannel> = IpcContract[C]['args']
export type IpcResult<C extends IpcChannel> = IpcContract[C]['result']

// Main pushes run events to the window on this channel.
export const RUN_EVENT_CHANNEL = 'run:event'
