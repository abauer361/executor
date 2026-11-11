import { contextBridge, ipcRenderer } from 'electron'
import { RUN_EVENT_CHANNEL, type IpcArgs, type IpcChannel, type IpcResult } from '../shared/ipc'
import type { ExecutorBridge, RunEvent } from '../shared/types'

const call =
  <C extends IpcChannel>(channel: C) =>
  (...args: IpcArgs<C>): Promise<IpcResult<C>> =>
    ipcRenderer.invoke(channel, ...args)

const bridge: ExecutorBridge = {
  platform: process.platform,
  loadState: call('state:load'),
  saveState: call('state:save'),
  downloadPackage: call('library:download'),
  removePackage: call('library:remove'),
  revealPath: call('library:reveal'),
  pickDocs: call('docs:pick'),
  openExternal: call('shell:open'),
  apiKeyStatus: call('key:status'),
  saveApiKey: call('key:save'),
  removeApiKey: call('key:remove'),
  startRun: call('run:start'),
  stopRun: call('run:stop'),
  injectInstruction: call('run:inject'),
  resolveApproval: call('run:approve'),
  getMcpSetups: call('mcp:setups'),
  pickFolders: call('mcp:pick-folders'),
  saveMcpFolders: call('mcp:save-folders'),
  saveMcpSecret: call('mcp:save-secret'),
  checkMcpServer: call('mcp:check'),
  searchRegistry: call('registry:search'),
  installRegistryServer: call('registry:install'),
  removeRegistryServer: call('registry:remove'),
  getRegistryServers: call('registry:servers'),
  searchClawHub: call('clawhub:search'),
  previewClawHubSkill: call('clawhub:preview'),
  installClawHubSkill: call('clawhub:install'),
  removeClawHubSkill: call('clawhub:remove'),
  getClawHubSkills: call('clawhub:skills'),
  onRunEvent: (listener) => {
    const handler = (_event: unknown, runEvent: RunEvent) => listener(runEvent)
    ipcRenderer.on(RUN_EVENT_CHANNEL, handler)
    return () => ipcRenderer.removeListener(RUN_EVENT_CHANNEL, handler)
  }
}

contextBridge.exposeInMainWorld('executor', bridge)
