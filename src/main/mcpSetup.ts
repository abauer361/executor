import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildLaunch,
  emptySetup,
  isSecretSetting,
  MCP_SERVERS,
  missingSettings,
  type McpServerSpec,
  type McpStoredSetup
} from '../shared/mcpServers'
import { installedServers } from './registry'
import { loadSecret, removeSecret, saveSecret } from './secrets'

type FolderConfig = Record<string, Record<string, string[]>>

const configPath = () => join(app.getPath('userData'), 'mcp-config.json')
const secretName = (id: string, key: string) => `mcp-${id}-${key}`

async function readFolderConfig(): Promise<FolderConfig> {
  try {
    return JSON.parse(await readFile(configPath(), 'utf8')) as FolderConfig
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

export async function serverSpec(id: string): Promise<McpServerSpec | undefined> {
  return MCP_SERVERS[id] ?? (await installedServers())[id]?.spec
}

async function settingOf(id: string, key: string) {
  const setting = (await serverSpec(id))?.settings.find((candidate) => candidate.key === key)
  if (!setting) throw new Error(`Unknown MCP setting: ${id}/${key}`)
  return setting
}

export async function serverSetup(id: string): Promise<McpStoredSetup> {
  const spec = await serverSpec(id)
  if (!spec) return emptySetup()

  const config = await readFolderConfig()
  const secrets: string[] = []
  for (const setting of spec.settings) {
    if (isSecretSetting(setting) && (await loadSecret(secretName(id, setting.key))) !== null) secrets.push(setting.key)
  }
  return { folders: config[id] ?? {}, secrets }
}

export async function allServerSetups() {
  const ids = [...Object.keys(MCP_SERVERS), ...Object.keys(await installedServers())]
  const setups = await Promise.all(ids.map(serverSetup))
  return Object.fromEntries(ids.map((id, index) => [id, setups[index]]))
}

export async function saveFolders(id: string, key: string, folders: string[]) {
  await settingOf(id, key)
  const config = await readFolderConfig()
  config[id] = { ...config[id], [key]: folders }
  await writeFile(configPath(), JSON.stringify(config, null, 2))
}

export async function saveServerSecret(id: string, key: string, value: string) {
  if (!isSecretSetting(await settingOf(id, key))) throw new Error(`Not a secret setting: ${id}/${key}`)
  if (value) await saveSecret(secretName(id, key), value)
  else await removeSecret(secretName(id, key))
}

export async function removeServerSecrets(spec: McpServerSpec) {
  await Promise.all(spec.settings.filter(isSecretSetting).map((setting) => removeSecret(secretName(spec.id, setting.key))))
}

export async function launchFor(id: string) {
  const spec = await serverSpec(id)
  if (!spec) throw new Error(`Unknown MCP server: ${id}`)

  const setup = await serverSetup(id)
  const missing = missingSettings(spec, setup)
  if (missing.length) throw new Error(`Needs setup: ${missing.map((setting) => setting.label).join(', ')}`)

  const secrets: Record<string, string> = {}
  for (const key of setup.secrets) secrets[key] = (await loadSecret(secretName(id, key))) ?? ''
  return { spec, launch: buildLaunch(spec, setup.folders, secrets, app.getPath('userData')) }
}
