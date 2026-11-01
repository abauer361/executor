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
  hasApiKey: () => ipcRenderer.invoke('key:status'),
  saveApiKey: (key) => ipcRenderer.invoke('key:save', key),
  removeApiKey: () => ipcRenderer.invoke('key:remove'),
  startRun: (request) => ipcRenderer.invoke('run:start', request),
  stopRun: (runId) => ipcRenderer.invoke('run:stop', runId),
  injectInstruction: (runId, nodeId, text) => ipcRenderer.invoke('run:inject', runId, nodeId, text),
  onRunEvent: (listener) => {
    const handler = (_event: unknown, runEvent: RunEvent) => listener(runEvent)
    ipcRenderer.on('run:event', handler)
    return () => ipcRenderer.removeListener('run:event', handler)
  }
}

contextBridge.exposeInMainWorld('executor', bridge)
