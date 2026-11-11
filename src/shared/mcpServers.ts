export type McpSettingKind = 'folders' | 'folder' | 'secret' | 'header'

export interface McpSetting {
  key: string
  label: string
  kind: McpSettingKind
  // Passed before each folder on the command line. Without it, folders are positional.
  flag?: string
}

export interface McpServerSpec {
  id: string
  command: string
  args: string[]
  settings: McpSetting[]
  dataFileEnv?: { name: string; file: string }
  remoteUrl?: string
  // Registry servers are unreviewed, so their claims about their own tools are ignored.
  trustHints?: boolean
}

export type McpLaunch =
  | { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> }
  | { transport: 'http'; url: string; headers: Record<string, string> }

// The only commands the app will run. The interface passes a server id, never a command.
//
// Every server is pinned to one exact release, so a launch never runs code published since it was
// chosen. Versions were set on 2026-11-11 to releases at least a week old. To update one, read its
// changelog, change the version here and check the server from Settings.
export const MCP_SERVERS: Record<string, McpServerSpec> = {
  filesystem: {
    id: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem@2.2.0'],
    settings: [{ key: 'folders', label: 'Folders agents can access', kind: 'folders' }]
  },
  github: {
    id: 'github',
    command: 'docker',
    args: [
      'run',
      '-i',
      '--rm',
      '-e',
      'GITHUB_PERSONAL_ACCESS_TOKEN',
      // v2.1.0, by digest so the tag cannot be moved to a different image.
      'ghcr.io/github/github-mcp-server@sha256:f6056fc10bfffcc8c81a6417a2e9ca12808647e8dd6049642a4feaadee0e0f8a'
    ],
    settings: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub access token', kind: 'secret' }]
  },
  git: {
    id: 'git',
    command: 'uvx',
    args: ['mcp-server-git==2026.11.4'],
    settings: [{ key: 'repository', label: 'Repository folder', kind: 'folder', flag: '--repository' }]
  },
  fetch: { id: 'fetch', command: 'uvx', args: ['mcp-server-fetch==2026.11.4'], settings: [] },
  memory: {
    id: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory@2.1.0'],
    settings: [],
    dataFileEnv: { name: 'MEMORY_FILE_PATH', file: 'mcp-memory.jsonl' }
  },
  'sequential-thinking': {
    id: 'sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking@2.1.1'],
    settings: []
  },
  time: { id: 'time', command: 'uvx', args: ['mcp-server-time==2026.11.4'], settings: [] },
  playwright: { id: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp@0.0.84'], settings: [] }
}

export interface McpStoredSetup {
  folders: Record<string, string[]>
  secrets: string[]
}

export const emptySetup = (): McpStoredSetup => ({ folders: {}, secrets: [] })

export const isSecretSetting = (setting: McpSetting) => setting.kind === 'secret' || setting.kind === 'header'

export function missingSettings(spec: McpServerSpec, setup: McpStoredSetup) {
  return spec.settings.filter((setting) =>
    isSecretSetting(setting) ? !setup.secrets.includes(setting.key) : !setup.folders[setting.key]?.length
  )
}

export function buildLaunch(
  spec: McpServerSpec,
  folders: Record<string, string[]>,
  secrets: Record<string, string>,
  dataDirectory: string
): McpLaunch {
  if (spec.remoteUrl) return { transport: 'http', url: spec.remoteUrl, headers: secrets }

  const args = [...spec.args]
  const env: Record<string, string> = { ...secrets }

  for (const setting of spec.settings) {
    if (isSecretSetting(setting)) continue
    for (const folder of folders[setting.key] ?? []) {
      args.push(...(setting.flag ? [setting.flag, folder] : [folder]))
    }
  }
  if (spec.dataFileEnv) env[spec.dataFileEnv.name] = `${dataDirectory}/${spec.dataFileEnv.file}`

  return { transport: 'stdio', command: spec.command, args, env }
}

export function installCommand(id: string) {
  const spec = MCP_SERVERS[id]
  const placeholders = spec.settings.flatMap((setting) => {
    if (isSecretSetting(setting)) return []
    return setting.flag ? [setting.flag, '<folder>'] : ['<folder>']
  })
  return [spec.command, ...spec.args, ...placeholders].join(' ')
}

const TOOL_NAME_LIMIT = 64

// Tool names must be unique across servers and fit the API's naming rules.
export function apiToolName(serverId: string, toolName: string) {
  return `${serverId}__${toolName}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, TOOL_NAME_LIMIT)
}

interface ToolHints {
  readOnlyHint?: boolean
  openWorldHint?: boolean
}

// Runs without asking only if it is declared read-only and cannot reach outside this Mac.
export const toolNeedsApproval = (hints: ToolHints | undefined, trustHints = true) =>
  !trustHints || hints?.readOnlyHint !== true || hints.openWorldHint === true
