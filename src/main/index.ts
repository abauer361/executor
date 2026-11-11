import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, sep } from 'node:path'
import type { Provider } from '../shared/pricing'
import type { ApprovalDecision, CatalogPackage, KeyResult, PickedDoc, RunEvent, RunRequest } from '../shared/types'
import { checkServer, createAgentEnvironment, downloadSkill, removeSkill } from './agentEnvironment'
import { installClawHubSkill, installedClawHubSkills, previewClawHubSkill, removeClawHubSkill, searchClawHub } from './clawhub'
import { createModelClient, verifyApiKey } from './modelClients'
import { allServerSetups, removeServerSecrets, saveFolders, saveServerSecret } from './mcpSetup'
import { installedServers, installServer, removeServer, searchRegistry } from './registry'
import { launchRun } from './runEngine'
import { createRunRegistry } from './runRegistry'
import { apiKeyStatus, loadApiKeys, removeApiKey, saveApiKey } from './secrets'

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

async function writeAtomic(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  try {
    await writeFile(temp, text)
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
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

function registerIpc() {
  ipcMain.handle('state:load', async () => {
    try {
      return await readFile(statePath(), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  })

  ipcMain.handle('state:save', (_event, json: string) => saveState(json))

  ipcMain.handle('library:download', async (_event, pkg: CatalogPackage) => {
    const path = packagePath(pkg)
    if (pkg.kind === 'skill') await downloadSkill(pkg.id)
    const manifest = { ...pkg, downloadedAt: new Date().toISOString() }
    await writeAtomic(path, JSON.stringify(manifest, null, 2))
    return path
  })

  ipcMain.handle('library:remove', async (_event, pkg: CatalogPackage) => {
    if (pkg.kind === 'skill') await removeSkill(pkg.id)
    await rm(packagePath(pkg), { force: true })
  })

  ipcMain.handle('library:reveal', (_event, path: string) => {
    if (!path.startsWith(libraryRoot() + sep)) throw new Error('Path is outside the library')
    shell.showItemInFolder(path)
  })

  ipcMain.handle('docs:pick', async (event): Promise<PickedDoc[]> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = { title: 'Attach memory docs', properties: ['openFile', 'multiSelections'] as const }
    const result = await (window
      ? dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
      : dialog.showOpenDialog({ ...options, properties: [...options.properties] }))
    if (result.canceled) return []
    return Promise.all(
      result.filePaths.map(async (path) => ({ name: basename(path), path, size: (await stat(path)).size }))
    )
  })

  ipcMain.handle('shell:open', async (_event, url: string) => {
    if (isWebUrl(url)) await shell.openExternal(url)
  })

  ipcMain.handle('key:status', () => apiKeyStatus())
  ipcMain.handle('key:remove', (_event, provider: Provider) => removeApiKey(provider))
  ipcMain.handle('key:save', async (_event, provider: Provider, key: string): Promise<KeyResult> => {
    const result = await verifyApiKey(provider, key)
    if (result.ok) await saveApiKey(provider, key)
    return result
  })

  ipcMain.handle('run:start', async (event, request: RunRequest) => {
    const { sender } = event
    const emit = (runEvent: RunEvent) => {
      if (!sender.isDestroyed()) sender.send('run:event', runEvent)
    }
    if (runs.has(request.runId)) throw new Error('That run has already started.')
    const client = createModelClient(await loadApiKeys())
    if (sender.isDestroyed()) return
    runs.add(sender.id, request.runId, launchRun(request, client, createAgentEnvironment(), emit))
  })

  ipcMain.handle('run:stop', (_event, runId: string) => runs.get(runId)?.stop())
  ipcMain.handle('run:inject', (_event, runId: string, nodeId: string, text: string) =>
    runs.get(runId)?.inject(nodeId, text)
  )
  ipcMain.handle('run:approve', (_event, runId: string, approvalId: string, decision: ApprovalDecision) =>
    runs.get(runId)?.resolveApproval(approvalId, decision)
  )

  ipcMain.handle('registry:search', (_event, query: string, cursor?: string) => searchRegistry(query, cursor))
  ipcMain.handle('registry:servers', () => installedServers())
  ipcMain.handle('registry:install', (_event, name: string, version: string) => installServer(name, version))
  ipcMain.handle('registry:remove', async (_event, id: string) => {
    const server = (await installedServers())[id]
    if (server) await removeServerSecrets(server.spec)
    await removeServer(id)
  })

  ipcMain.handle('clawhub:search', (_event, query: string, cursor?: string) => searchClawHub(query, cursor))
  ipcMain.handle('clawhub:skills', () => installedClawHubSkills())
  ipcMain.handle('clawhub:preview', (_event, owner: string, slug: string) => previewClawHubSkill(owner, slug))
  ipcMain.handle('clawhub:install', (_event, owner: string, slug: string, version: string, sha256: string) =>
    installClawHubSkill(owner, slug, version, sha256)
  )
  ipcMain.handle('clawhub:remove', (_event, id: string) => removeClawHubSkill(id))

  ipcMain.handle('mcp:setups', () => allServerSetups())
  ipcMain.handle('mcp:check', (_event, id: string) => checkServer(id))
  ipcMain.handle('mcp:save-folders', (_event, id: string, key: string, folders: string[]) =>
    saveFolders(id, key, folders)
  )
  ipcMain.handle('mcp:save-secret', (_event, id: string, key: string, value: string) =>
    saveServerSecret(id, key, value)
  )
  ipcMain.handle('mcp:pick-folders', async (event, multiple: boolean) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Choose a folder',
      properties: multiple ? (['openDirectory', 'multiSelections'] as const) : (['openDirectory'] as const)
    }
    const result = await (window
      ? dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
      : dialog.showOpenDialog({ ...options, properties: [...options.properties] }))
    return result.canceled ? [] : result.filePaths
  })
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
