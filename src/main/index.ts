import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import type { CatalogPackage, KeyResult, PickedDoc, RunEvent, RunRequest } from '../shared/types'
import { createModelClient, verifyApiKey } from './anthropicClient'
import { launchRun, type RunHandle } from './runEngine'
import { hasApiKey, loadApiKey, removeApiKey, saveApiKey } from './secrets'

const KINDS = new Set(['mcp', 'skill', 'agent', 'workflow'])
const runs = new Map<string, RunHandle>()

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
  const temp = `${path}.tmp`
  await writeFile(temp, text)
  await rename(temp, path)
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

  ipcMain.handle('state:save', (_event, json: string) => writeAtomic(statePath(), json))

  ipcMain.handle('library:download', async (_event, pkg: CatalogPackage) => {
    const path = packagePath(pkg)
    const manifest = { ...pkg, downloadedAt: new Date().toISOString() }
    await writeAtomic(path, JSON.stringify(manifest, null, 2))
    return path
  })

  ipcMain.handle('library:remove', (_event, pkg: CatalogPackage) => rm(packagePath(pkg), { force: true }))

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

  ipcMain.handle('key:status', () => hasApiKey())
  ipcMain.handle('key:remove', () => removeApiKey())
  ipcMain.handle('key:save', async (_event, key: string): Promise<KeyResult> => {
    const result = await verifyApiKey(key)
    if (result.ok) await saveApiKey(key)
    return result
  })

  ipcMain.handle('run:start', async (event, request: RunRequest) => {
    const { sender } = event
    const emit = (runEvent: RunEvent) => {
      if (!sender.isDestroyed()) sender.send('run:event', runEvent)
    }
    const key = await loadApiKey()
    if (!key) {
      emit({ type: 'end', runId: request.runId, outcome: 'failed', message: 'Add an Anthropic API key to run agents.' })
      return
    }
    const handle = launchRun(request, createModelClient(key), emit)
    runs.set(request.runId, handle)
    void handle.done.finally(() => runs.delete(request.runId))
  })

  ipcMain.handle('run:stop', (_event, runId: string) => runs.get(runId)?.stop())
  ipcMain.handle('run:inject', (_event, runId: string, nodeId: string, text: string) =>
    runs.get(runId)?.inject(nodeId, text)
  )
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

app.on('before-quit', () => {
  for (const run of runs.values()) run.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
