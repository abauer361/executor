import type { ExecutorBridge } from '../../shared/types'

declare global {
  interface Window {
    executor?: ExecutorBridge
  }
}

const STATE_KEY = 'executor-state'

// Lets `npm run dev:web` run the renderer alone for UI checks. The app itself always uses the preload bridge.
const browserPreview: ExecutorBridge = {
  platform: 'web',
  loadState: async () => localStorage.getItem(STATE_KEY),
  saveState: async (json) => localStorage.setItem(STATE_KEY, json),
  downloadPackage: async (pkg) => `preview://${pkg.kind}/${pkg.id}.json`,
  removePackage: async () => {},
  revealPath: async () => {},
  pickDocs: async () => [],
  openExternal: async (url) => void window.open(url, '_blank')
}

export const bridge: ExecutorBridge = window.executor ?? browserPreview
