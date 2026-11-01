import { describe, expect, it } from 'vitest'
import { buildLaunch, toolNeedsApproval } from './mcpServers'
import { parseRegistryEntry } from './registry'

const entry = (server: Record<string, unknown>, status = 'active') => ({
  server: { name: 'com.example/tool', version: '1.2.3', description: 'A tool', ...server },
  _meta: { 'io.modelcontextprotocol.registry/official': { status } }
})

const npm = (patch: Record<string, unknown> = {}) => ({
  registryType: 'npm',
  identifier: '@acme/tool',
  version: '1.2.3',
  transport: { type: 'stdio' },
  ...patch
})

describe('building commands', () => {
  it('pins npm packages to an exact version', () => {
    const parsed = parseRegistryEntry(entry({ packages: [npm()] }))
    expect(parsed?.spec).toMatchObject({ command: 'npx', args: ['-y', '@acme/tool@1.2.3'] })
    expect(parsed?.source).toBe('npm')
  })

  it('pins PyPI packages to an exact version', () => {
    const parsed = parseRegistryEntry(entry({ packages: [npm({ registryType: 'pypi', identifier: 'acme-tool' })] }))
    expect(parsed?.spec).toMatchObject({ command: 'uvx', args: ['acme-tool==1.2.3'] })
  })

  it('prefers a remote server because nothing runs locally', () => {
    const parsed = parseRegistryEntry(
      entry({ packages: [npm()], remotes: [{ type: 'streamable-http', url: 'https://mcp.example.com/mcp' }] })
    )
    expect(parsed).toMatchObject({ source: 'remote', target: 'https://mcp.example.com/mcp' })
  })
})

describe('rejecting unsafe entries', () => {
  const unsupported = (server: Record<string, unknown>) => parseRegistryEntry(entry(server))?.unsupported

  it.each([
    ['a package name that is really a flag', '--package=evil'],
    ['a package name with a shell command', 'tool; rm -rf ~'],
    ['a local path', '../../evil'],
    ['a url', 'https://evil.example/pkg.tgz'],
    ['a git url', 'git+https://evil.example/x.git'],
    ['spaces', 'tool --flag']
  ])('rejects %s', (_label, identifier) => {
    expect(unsupported({ packages: [npm({ identifier })] })).toBe('Its package name is not valid')
  })

  it.each(['latest', '*', '^1.0.0', '>=1', '', '1.0.0; rm -rf ~', '--flag'])('rejects the version %j', (version) => {
    expect(unsupported({ packages: [npm({ version })] })).toBe('It does not pin an exact version')
  })

  it('never uses free-form launch fields', () => {
    const parsed = parseRegistryEntry(
      entry({
        packages: [
          npm({
            runtimeHint: 'bash',
            runtimeArguments: [{ type: 'positional', value: '-c evil' }],
            packageArguments: [{ type: 'named', name: '--evil', value: 'x' }]
          })
        ]
      })
    )
    expect(parsed?.spec).toMatchObject({ command: 'npx', args: ['-y', '@acme/tool@1.2.3'] })
    expect(JSON.stringify(parsed?.spec)).not.toContain('evil')
  })

  it.each(['NODE_OPTIONS', 'PATH', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', 'PYTHONPATH', 'ANTHROPIC_API_KEY', 'NPM_CONFIG_REGISTRY', 'UV_INDEX_URL'])(
    'rejects a server that requires %s',
    (name) => {
      const environmentVariables = [{ name, isRequired: true }]
      expect(unsupported({ packages: [npm({ environmentVariables })] })).toBe('It asks for a protected setting')
    }
  )

  it('rejects plain http remotes', () => {
    expect(unsupported({ remotes: [{ type: 'streamable-http', url: 'http://mcp.example.com/mcp' }] })).toContain('https')
  })

  it('explains an address that needs custom values', () => {
    expect(unsupported({ remotes: [{ type: 'streamable-http', url: 'https://{env}.example.com/mcp' }] })).toContain('custom values')
  })

  it('rejects remotes with embedded credentials', () => {
    expect(unsupported({ remotes: [{ type: 'streamable-http', url: 'https://a:b@mcp.example.com/' }] })).toContain('https')
  })

  it('rejects headers that could affect the connection', () => {
    const remotes = [
      { type: 'streamable-http', url: 'https://mcp.example.com', headers: [{ name: 'Host', isRequired: true }] }
    ]
    expect(unsupported({ remotes })).toBe('It asks for a header that is not allowed')
  })

  it('explains unsupported package types', () => {
    expect(unsupported({ packages: [npm({ registryType: 'oci' })] })).toBe('oci packages are not supported yet')
  })

  it('explains required custom arguments', () => {
    const packageArguments = [{ type: 'named', name: '--out', isRequired: true }]
    expect(unsupported({ packages: [npm({ packageArguments })] })).toContain('custom arguments')
  })

  it('explains an entry with nothing to install', () => {
    expect(unsupported({})).toBe('It has nothing to install')
  })

  it('ignores malformed entries', () => {
    expect(parseRegistryEntry(null)).toBeNull()
    expect(parseRegistryEntry({ server: { name: 'x' } })).toBeNull()
    expect(parseRegistryEntry(entry({ packages: 'nope', remotes: 42 }))?.unsupported).toBe('It has nothing to install')
  })

  it('caps long text from the registry', () => {
    expect(parseRegistryEntry(entry({ description: 'x'.repeat(5000) }))?.description).toHaveLength(500)
  })
})

describe('settings', () => {
  it('asks for required variables as secrets', () => {
    const environmentVariables = [
      { name: 'ACME_KEY', description: 'Your key', isRequired: true, isSecret: true },
      { name: 'OPTIONAL', isRequired: false }
    ]
    const parsed = parseRegistryEntry(entry({ packages: [npm({ environmentVariables })] }))
    expect(parsed?.settings).toEqual([{ key: 'ACME_KEY', label: 'Your key', kind: 'secret' }])
  })

  it('asks for required remote headers', () => {
    const remotes = [
      {
        type: 'streamable-http',
        url: 'https://mcp.example.com',
        headers: [
          { name: 'Authorization', description: 'Bearer token', isRequired: true },
          { name: 'X-Optional' }
        ]
      }
    ]
    const parsed = parseRegistryEntry(entry({ remotes }))
    expect(parsed?.settings).toEqual([{ key: 'Authorization', label: 'Bearer token', kind: 'header' }])
  })

  it('sends remote headers only to the server', () => {
    const parsed = parseRegistryEntry(
      entry({
        remotes: [
          {
            type: 'streamable-http',
            url: 'https://mcp.example.com/mcp',
            headers: [{ name: 'Authorization', isRequired: true }]
          }
        ]
      })
    )
    const launch = buildLaunch({ id: 'reg-x', ...parsed!.spec! }, {}, { Authorization: 'Bearer x' }, '/data')
    expect(launch).toEqual({
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer x' }
    })
  })
})

describe('labels', () => {
  it('flags deprecated servers', () => {
    expect(parseRegistryEntry(entry({ packages: [npm()] }, 'deprecated'))?.deprecated).toBe(true)
  })

  it('only accepts secure repository links', () => {
    expect(parseRegistryEntry(entry({ repository: { url: 'javascript:alert(1)' } }))?.repository).toBeUndefined()
    expect(parseRegistryEntry(entry({ repository: { url: 'https://github.com/a/b' } }))?.repository).toBe('https://github.com/a/b')
  })
})

describe('approval for registry tools', () => {
  it('ignores read-only claims from untrusted servers', () => {
    expect(toolNeedsApproval({ readOnlyHint: true }, false)).toBe(true)
    expect(toolNeedsApproval({ readOnlyHint: true }, true)).toBe(false)
  })
})
