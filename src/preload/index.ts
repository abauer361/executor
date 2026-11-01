import { contextBridge, ipcRenderer } from 'electron'
import type { ExecutorBridge } from '../shared/types'

const bridge: ExecutorBridge = {
  platform: process.platform,
  loadState: () => ipcRenderer.invoke('state:load'),
  saveState: (json) => ipcRenderer.invoke('state:save', json),
  downloadPackage: (pkg) => ipcRenderer.invoke('library:download', pkg),
  removePackage: (pkg) => ipcRenderer.invoke('library:remove', pkg),
  revealPath: (path) => ipcRenderer.invoke('library:reveal', path),
  pickDocs: () => ipcRenderer.invoke('docs:pick'),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url)
}

contextBridge.exposeInMainWorld('executor', bridge)
