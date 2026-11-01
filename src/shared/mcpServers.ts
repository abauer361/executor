export type McpSettingKind = 'folders' | 'folder' | 'secret'

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
}

export interface McpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

// The only commands the app will run. The interface passes a server id, never a command.
export const MCP_SERVERS: Record<string, McpServerSpec> = {
  filesystem: {
    id: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    settings: [{ key: 'folders', label: 'Folders agents can access', kind: 'folders' }]
  },
  github: {
    id: 'github',
    command: 'docker',
    args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
    settings: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub access token', kind: 'secret' }]
  },
  git: {
    id: 'git',
    command: 'uvx',
    args: ['mcp-server-git'],
    settings: [{ key: 'repository', label: 'Repository folder', kind: 'folder', flag: '--repository' }]
  },
  fetch: { id: 'fetch', command: 'uvx', args: ['mcp-server-fetch'], settings: [] },
  memory: {
    id: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    settings: [],
    dataFileEnv: { name: 'MEMORY_FILE_PATH', file: 'mcp-memory.jsonl' }
  },
  'sequential-thinking': {
    id: 'sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    settings: []
  },
  time: { id: 'time', command: 'uvx', args: ['mcp-server-time'], settings: [] },
  playwright: { id: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest'], settings: [] }
}

export interface McpStoredSetup {
  folders: Record<string, string[]>
  secrets: string[]
}

export const emptySetup = (): McpStoredSetup => ({ folders: {}, secrets: [] })

export function missingSettings(spec: McpServerSpec, setup: McpStoredSetup) {
  return spec.settings.filter((setting) =>
    setting.kind === 'secret' ? !setup.secrets.includes(setting.key) : !setup.folders[setting.key]?.length
  )
}

export function buildLaunch(
  spec: McpServerSpec,
  folders: Record<string, string[]>,
  secrets: Record<string, string>,
  dataDirectory: string
): McpLaunch {
  const args = [...spec.args]
  const env: Record<string, string> = { ...secrets }

  for (const setting of spec.settings) {
    if (setting.kind === 'secret') continue
    for (const folder of folders[setting.key] ?? []) {
      args.push(...(setting.flag ? [setting.flag, folder] : [folder]))
    }
  }
  if (spec.dataFileEnv) env[spec.dataFileEnv.name] = `${dataDirectory}/${spec.dataFileEnv.file}`

  return { command: spec.command, args, env }
}

export function installCommand(id: string) {
  const spec = MCP_SERVERS[id]
  const placeholders = spec.settings.flatMap((setting) => {
    if (setting.kind === 'secret') return []
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
export const toolNeedsApproval = (hints: ToolHints | undefined) =>
  hints?.readOnlyHint !== true || hints.openWorldHint === true
