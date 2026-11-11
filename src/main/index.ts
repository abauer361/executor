import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { rm, stat } from 'node:fs/promises'
import { basename, join, sep } from 'node:path'
import { RUN_EVENT_CHANNEL, type IpcArgs, type IpcChannel, type IpcResult } from '../shared/ipc'
import type { CatalogPackage, RunEvent } from '../shared/types'
import { checkServer, createAgentEnvironment, downloadSkill, removeSkill } from './agentEnvironment'
import { installClawHubSkill, installedClawHubSkills, previewClawHubSkill, removeClawHubSkill, searchClawHub } from './clawhub'
import { createModelClient, verifyApiKey } from './modelClients'
import { allServerSetups, removeServerSecrets, saveFolders, saveServerSecret } from './mcpSetup'
import { installedServers, installServer, removeServer, searchRegistry } from './registry'
import { launchRun } from './runEngine'
import { createRunRegistry } from './runRegistry'
import { apiKeyStatus, loadApiKeys, removeApiKey, saveApiKey } from './secrets'
import { loadStateFile, writeAtomic } from './stateFile'

const KINDS = new Set(['mcp', 'skill', 'agent', 'workflow'])
const runs = createRunRegistry()

// How long quitting waits for runs to stop their MCP servers.
const QUIT_WAIT_MS = 5000
const LAST_SAVE_GRACE_MS = 100

const statePath = () => join(app.getPath('userData'), 'state.json')
const libraryRoot = () => join(app.getPath('userData'), 'library')

function packagePath(pkg: Pick<CatalogPackage, 'id' | 'kind'>) {
  if (!KINDS.has(pkg.kind) || !/^[a-z0-9-]+$/.test(pkg.id)) {
    throw new Error(`Invalid package: ${pkg.kind}/${pkg.id}`)
  }
  return join(libraryRoot(), pkg.kind, `${pkg.id}.json`)
}

// State saves run one at a time, so an older save can never land after a newer one.
let stateWrites: Promise<void> = Promise.resolve()

function saveState(json: string) {
  stateWrites = stateWrites.catch(() => {}).then(() => writeAtomic(statePath(), json))
  return stateWrites
}

function isWebUrl(url: string) {
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcArgs<C>
) => IpcResult<C> | Promise<IpcResult<C>>

async function pickPaths(event: IpcMainInvokeEvent, options: OpenDialogOptions) {
  const window = BrowserWindow.fromWebContents(event.sender)
  const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options))
  return result.canceled ? [] : result.filePaths
}

// One entry per channel in the contract. A missing or mistyped handler does not compile.
const handlers: { [C in IpcChannel]: Handler<C> } = {
  'state:load': () => loadStateFile(statePath()),
  'state:save': (_event, json) => saveState(json),

  'library:download': async (_event, pkg) => {
    const path = packagePath(pkg)
    if (pkg.kind === 'skill') await downloadSkill(pkg.id)
    const manifest = { ...pkg, downloadedAt: new Date().toISOString() }
    await writeAtomic(path, JSON.stringify(manifest, null, 2))
    return path
  },
  'library:remove': async (_event, pkg) => {
    if (pkg.kind === 'skill') await removeSkill(pkg.id)
    await rm(packagePath(pkg), { force: true })
  },
  'library:reveal': (_event, path) => {
    if (!path.startsWith(libraryRoot() + sep)) throw new Error('Path is outside the library')
    shell.showItemInFolder(path)
  },

  'docs:pick': async (event) => {
    const paths = await pickPaths(event, { title: 'Attach memory docs', properties: ['openFile', 'multiSelections'] })
    return Promise.all(paths.map(async (path) => ({ name: basename(path), path, size: (await stat(path)).size })))
  },

  'shell:open': async (_event, url) => {
    if (isWebUrl(url)) await shell.openExternal(url)
  },

  'key:status': () => apiKeyStatus(),
  'key:remove': (_event, provider) => removeApiKey(provider),
  'key:save': async (_event, provider, key) => {
    const result = await verifyApiKey(provider, key)
    if (result.ok) await saveApiKey(provider, key)
    return result
  },

  'run:start': async ({ sender }, request) => {
    const emit = (runEvent: RunEvent) => {
      if (!sender.isDestroyed()) sender.send(RUN_EVENT_CHANNEL, runEvent)
    }
    if (runs.has(request.runId)) throw new Error('That run has already started.')
    const client = createModelClient(await loadApiKeys())
    if (sender.isDestroyed()) return
    runs.add(sender.id, request.runId, launchRun(request, client, createAgentEnvironment(), emit))
  },
  'run:stop': (_event, runId) => runs.get(runId)?.stop(),
  'run:inject': (_event, runId, nodeId, text) => runs.get(runId)?.inject(nodeId, text),
  'run:approve': (_event, runId, approvalId, decision) => runs.get(runId)?.resolveApproval(approvalId, decision),

  'registry:search': (_event, query, cursor) => searchRegistry(query, cursor),
  'registry:servers': () => installedServers(),
  'registry:install': (_event, name, version) => installServer(name, version),
  'registry:remove': async (_event, id) => {
    const server = (await installedServers())[id]
    if (server) await removeServerSecrets(server.spec)
    await removeServer(id)
  },

  'clawhub:search': (_event, query, cursor) => searchClawHub(query, cursor),
  'clawhub:skills': () => installedClawHubSkills(),
  'clawhub:preview': (_event, owner, slug) => previewClawHubSkill(owner, slug),
  'clawhub:install': (_event, owner, slug, version, sha256) => installClawHubSkill(owner, slug, version, sha256),
  'clawhub:remove': (_event, id) => removeClawHubSkill(id),

  'mcp:setups': () => allServerSetups(),
  'mcp:check': (_event, id) => checkServer(id),
  'mcp:save-folders': (_event, id, key, folders) => saveFolders(id, key, folders),
  'mcp:save-secret': (_event, id, key, value) => saveServerSecret(id, key, value),
  'mcp:pick-folders': (event, multiple) =>
    pickPaths(event, {
      title: 'Choose a folder',
      properties: multiple ? ['openDirectory', 'multiSelections'] : ['openDirectory']
    })
}

function registerIpc() {
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    const handler = handlers[channel] as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    ipcMain.handle(channel, handler)
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 20 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())

  // A run reports only to the page that started it. Once that page is closed, reloaded or crashed,
  // nobody can see or stop the run, so it ends here instead of spending unseen.
  const { webContents } = window
  const owner = webContents.id
  const stopRuns = () => runs.stopOwnedBy(owner)
  webContents.once('destroyed', stopRuns)
  webContents.on('render-process-gone', stopRuns)
  webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) stopRuns()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false

// Runs get a moment to close their MCP servers, so no child process outlives the app.
app.on('before-quit', (event) => {
  if (quitting || runs.size === 0) return
  event.preventDefault()
  quitting = true
  void runs.stopAll(QUIT_WAIT_MS).finally(() => app.quit())
})

let stateFlushed = false

// A closing window sends its last save on the way out. Give it a moment to arrive, then let it finish.
app.on('will-quit', (event) => {
  if (stateFlushed) return
  event.preventDefault()
  stateFlushed = true
  setTimeout(() => void stateWrites.catch(() => {}).finally(() => app.quit()), LAST_SAVE_GRACE_MS)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
