import { describe, expect, it } from 'vitest'
import type { IpcChannel } from '../shared/ipc'
import type { RunRequest } from '../shared/types'
import { InvalidRequest, validators } from './ipcValidation'

const check = (channel: IpcChannel, ...args: unknown[]) => (validators[channel] as (args: unknown[]) => unknown[])(args)
const refuses = (channel: IpcChannel, ...args: unknown[]) => expect(() => check(channel, ...args)).toThrow(InvalidRequest)

const request = (patch: Record<string, unknown> = {}, nodePatch: Record<string, unknown> = {}): unknown => ({
  runId: 'r1',
  goal: 'Ship it',
  edges: [{ source: 'a', target: 'a' }],
  nodes: [
    {
      id: 'a',
      name: 'Agent',
      prompt: 'Do it',
      model: 'claude-sonnet-5-5',
      limiter: { mode: 'tokens', tokens: 1000, dollars: 5 },
      instructions: [],
      mcpServers: ['filesystem'],
      skills: [],
      memory: [{ id: 'd', name: 'notes.md', path: '/Users/me/notes.md', size: 10 }],
      ...nodePatch
    }
  ],
  ...patch
})

describe('IPC validation', () => {
  it('passes well-formed arguments through', () => {
    expect(check('key:save', 'openai', 'sk-test')).toEqual(['openai', 'sk-test'])
    expect(check('registry:search', 'git')).toEqual(['git', undefined, false])
    expect(check('registry:search', 'git', 'next')).toEqual(['git', 'next', false])
    expect(check('clawhub:search', '', undefined, true)).toEqual(['', undefined, true])
    expect(check('mcp:save-folders', 'filesystem', 'folders', ['/Users/me/code'])).toEqual([
      'filesystem',
      'folders',
      ['/Users/me/code']
    ])
    expect(check('state:load', 'ignored')).toEqual([])
  })

  it('refuses a provider that could become a file path', () => {
    refuses('key:save', '../../etc/x', 'sk-test')
    refuses('key:remove', '../../Library/Keychains/login')
    refuses('key:remove', undefined)
  })

  it('refuses folders that are not real locations, so none can act as a flag', () => {
    refuses('mcp:save-folders', 'git', 'repository', ['--upload-pack=evil'])
    refuses('mcp:save-folders', 'filesystem', 'folders', ['relative/folder'])
    refuses('mcp:save-folders', 'filesystem', 'folders', '/Users/me')
    refuses('mcp:save-folders', 'filesystem', 'folders', ['/Users/me\u0000'])
  })

  it('refuses a package whose id or kind is outside the library', () => {
    expect(check('library:download', { id: 'git', kind: 'mcp', name: 'Git' })).toEqual([{ id: 'git', kind: 'mcp', name: 'Git' }])
    refuses('library:download', { id: '../../x', kind: 'mcp' })
    refuses('library:remove', { id: 'git', kind: '../skill' })
    refuses('library:download', { id: 'git', kind: 'mcp', summary: 'x'.repeat(300_000) })
    refuses('library:download', null)
  })

  it('refuses decisions and types it does not know', () => {
    refuses('run:approve', 'r', 'a', 'yes')
    refuses('account:sign-in', 'facebook')
    expect(check('account:sign-in', 'github')).toEqual(['github'])
    refuses('run:stop', 42)
    refuses('run:stop', '')
    refuses('state:save', { not: 'text' })
    refuses('shell:open', ['https://example.com'])
    expect(check('mcp:pick-folders', 'yes')).toEqual([false])
  })

  it('accepts a normal run and keeps only the fields it knows', () => {
    const [checked] = check('run:start', request({ extra: 'dropped' }, { surprise: true })) as [RunRequest]
    expect(checked).toEqual(request())
    expect(checked.nodes[0].routeAmong).toBeUndefined()
  })

  it('accepts a sample memory doc with no file behind it', () => {
    const memory = [{ id: 'd', name: 'sample.md', path: '', size: 0 }]
    expect(() => check('run:start', request({}, { memory }))).not.toThrow()
  })

  it('refuses a run that names an unknown model or a relative memory path', () => {
    refuses('run:start', request({}, { model: 'made-up-model' }))
    refuses('run:start', request({}, { routeAmong: ['claude-sonnet-5-5', 'made-up-model'] }))
    refuses('run:start', request({}, { memory: [{ id: 'd', name: 'x', path: '../secrets.txt', size: 1 }] }))
  })

  it('refuses a run with broken limits or repeated agents', () => {
    refuses('run:start', request({}, { limiter: { mode: 'tokens', tokens: -1, dollars: 5 } }))
    refuses('run:start', request({}, { limiter: { mode: 'tokens', tokens: Number.NaN, dollars: 5 } }))
    refuses('run:start', request({}, { limiter: { mode: 'free', tokens: 1, dollars: 5 } }))
    const [node] = (request() as RunRequest).nodes
    refuses('run:start', request({ nodes: [node, node] }))
    refuses('run:start', request({ runId: '' }))
    refuses('run:start', request({ nodes: 'all of them' }))
  })

  it('has a validator for every channel', () => {
    expect(Object.keys(validators)).toHaveLength(31)
  })
})
