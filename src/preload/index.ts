import { contextBridge, ipcRenderer } from 'electron'
import type { ExecutorBridge, RunEvent } from '../shared/types'

const bridge: ExecutorBridge = {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (json) => ipcRenderer.invoke('state:save', json),
  downloadPackage: (pkg) => ipcRenderer.invoke('library:download', pkg),
  removePackage: (pkg) => ipcRenderer.invoke('library:remove', pkg),
  revealPath: (path) => ipcRenderer.invoke('library:reveal', path),
  pickDocs: () => ipcRenderer.invoke('docs:pick'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  apiKeyStatus: () => ipcRenderer.invoke('key:status'),
  saveApiKey: (provider, key) => ipcRenderer.invoke('key:save', provider, key),
  removeApiKey: (provider) => ipcRenderer.invoke('key:remove', provider),
  listOpenRouterModels: () => ipcRenderer.invoke('openrouter:models'),
  startRun: (request) => ipcRenderer.invoke('run:start', request),
  stopRun: (runId) => ipcRenderer.invoke('run:stop', runId),
  injectInstruction: (runId, nodeId, text) => ipcRenderer.invoke('run:inject', runId, nodeId, text),
  resolveApproval: (runId, approvalId, decision) => ipcRenderer.invoke('run:approve', runId, approvalId, decision),
  getMcpSetups: () => ipcRenderer.invoke('mcp:setups'),
  pickFolders: (multiple) => ipcRenderer.invoke('mcp:pick-folders', multiple),
  saveMcpFolders: (id, key, folders) => ipcRenderer.invoke('mcp:save-folders', id, key, folders),
  saveMcpSecret: (id, key, value) => ipcRenderer.invoke('mcp:save-secret', id, key, value),
  checkMcpServer: (id) => ipcRenderer.invoke('mcp:check', id),
  searchRegistry: (query, cursor) => ipcRenderer.invoke('registry:search', query, cursor),
  installRegistryServer: (name, version) => ipcRenderer.invoke('registry:install', name, version),
  removeRegistryServer: (id) => ipcRenderer.invoke('registry:remove', id),
  getRegistryServers: () => ipcRenderer.invoke('registry:servers'),
  searchClawHub: (query, cursor) => ipcRenderer.invoke('clawhub:search', query, cursor),
  previewClawHubSkill: (owner, slug) => ipcRenderer.invoke('clawhub:preview', owner, slug),
  installClawHubSkill: (owner, slug, version, sha256) => ipcRenderer.invoke('clawhub:install', owner, slug, version, sha256),
  removeClawHubSkill: (id) => ipcRenderer.invoke('clawhub:remove', id),
  getClawHubSkills: () => ipcRenderer.invoke('clawhub:skills'),
  onRunEvent: (listener) => {
    const handler = (_event: unknown, runEvent: RunEvent) => listener(runEvent)
    ipcRenderer.on('run:event', handler)
    return () => ipcRenderer.removeListener('run:event', handler)
  }
}

contextBridge.exposeInMainWorld('executor', bridge)
