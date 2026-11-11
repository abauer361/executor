import type { Account } from '../../shared/account'
import type { ExecutorBridge, RunEvent } from '../../shared/types'

declare global {
  interface Window {
    executor?: ExecutorBridge
  }
}

const STATE_KEY = 'executor-state'
const previewListeners = new Set<(event: RunEvent) => void>()

// A made-up person, so the signed-in profile can be looked at in the browser preview.
const PREVIEW_ACCOUNT: Account = { id: 'preview', name: 'Sample Person', email: 'sample@example.com', provider: 'github' }
let previewAccount: Account | null = null

// Lets `npm run dev:web` run the renderer alone for UI checks. The app itself always uses the preload bridge.
const browserPreview: ExecutorBridge = {
  platform: 'web',
  loadState: async () => ({ json: localStorage.getItem(STATE_KEY) }),
  saveState: async (json) => localStorage.setItem(STATE_KEY, json),
  downloadPackage: async (pkg) => `preview://${pkg.kind}/${pkg.id}.json`,
  removePackage: async () => {},
  revealPath: async () => {},
  pickDocs: async () => [],
  openExternal: async (url) => void window.open(url, '_blank'),
  apiKeyStatus: async () => ({ anthropic: false, openai: false, google: false }),
  saveApiKey: async () => ({ ok: false, message: 'API keys need the desktop app.' }),
  removeApiKey: async () => {},
  startRun: async ({ runId }) => {
    const message = 'Runs need the desktop app.'
    for (const listener of previewListeners) listener({ type: 'end', runId, outcome: 'failed', message })
  },
  stopRun: async () => {},
  injectInstruction: async () => {},
  resolveApproval: async () => {},
  getMcpSetups: async () => ({}),
  pickFolders: async () => [],
  saveMcpFolders: async () => {},
  saveMcpSecret: async () => {},
  checkMcpServer: async () => ({ ok: false, message: 'MCP servers need the desktop app.' }),
  searchRegistry: async () => ({ entries: [], nextCursor: null }),
  installRegistryServer: async () => {
    throw new Error('MCP servers need the desktop app.')
  },
  removeRegistryServer: async () => {},
  getRegistryServers: async () => ({}),
  searchClawHub: async () => ({ entries: [], nextCursor: null }),
  previewClawHubSkill: async () => {
    throw new Error('ClawHub skills need the desktop app.')
  },
  installClawHubSkill: async () => {
    throw new Error('ClawHub skills need the desktop app.')
  },
  removeClawHubSkill: async () => {},
  getClawHubSkills: async () => ({}),
  getAccount: async () => ({
    connected: true,
    account: previewAccount,
    plan: previewAccount && { name: 'Preview', status: 'active' }
  }),
  signIn: async (provider) => {
    previewAccount = { ...PREVIEW_ACCOUNT, provider }
    return { ok: true }
  },
  signOut: async () => {
    previewAccount = null
  },
  onRunEvent: (listener) => {
    previewListeners.add(listener)
    return () => previewListeners.delete(listener)
  }
}

export const bridge: ExecutorBridge = window.executor ?? browserPreview
