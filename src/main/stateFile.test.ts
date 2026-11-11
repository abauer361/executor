import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { isPersisted } from '../shared/persisted'
import { loadStateFile, writeAtomic } from './stateFile'

const folder = mkdtempSync(join(tmpdir(), 'executor-state-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

const workflow = { id: 'w', name: 'main', nodes: [], edges: [], running: false, lastRunAt: null, log: [] }
const valid = {
  version: 1,
  projects: [{ id: 'p', name: 'Project', tag: '', activeWorkflowId: 'w', workflows: [workflow] }],
  agents: [],
  downloads: {},
  activeProjectId: 'p',
  theme: 'dark'
}

const fileIn = (name: string, text?: string) => {
  const path = join(folder, name, 'state.json')
  if (text !== undefined) return writeAtomic(path, text).then(() => path)
  return Promise.resolve(path)
}

describe('saved state', () => {
  it('reports a first launch as having nothing saved', async () => {
    expect(await loadStateFile(await fileIn('first'))).toEqual({ json: null })
  })

  it('returns a readable file untouched', async () => {
    const path = await fileIn('good', JSON.stringify(valid))
    expect(await loadStateFile(path)).toEqual({ json: JSON.stringify(valid) })
  })

  it('moves a damaged file aside instead of letting it be overwritten', async () => {
    const path = await fileIn('damaged', '{"projects": [')
    const loaded = await loadStateFile(path, 42)

    expect(loaded).toEqual({ json: null, backup: join(folder, 'damaged', 'state.unreadable-42.json') })
    expect(readFileSync(loaded.backup!, 'utf8')).toBe('{"projects": [')
    expect(readdirSync(join(folder, 'damaged'))).toEqual(['state.unreadable-42.json'])
  })

  it('moves aside a file that parses but has the wrong shape', async () => {
    const path = await fileIn('shape', JSON.stringify({ ...valid, projects: 'none' }))
    expect((await loadStateFile(path, 7)).backup).toContain('state.unreadable-7.json')
  })

  it('keeps every write whole when saves overlap', async () => {
    const path = await fileIn('overlap')
    await Promise.all(Array.from({ length: 20 }, (_, index) => writeAtomic(path, JSON.stringify({ index }))))

    expect(JSON.parse(readFileSync(path, 'utf8'))).toHaveProperty('index')
    expect(readdirSync(join(folder, 'overlap'))).toEqual(['state.json'])
  })
})

describe('state shape', () => {
  it('accepts state saved before versions existed', () => {
    const { version: _version, ...unversioned } = valid
    expect(isPersisted(unversioned)).toBe(true)
  })

  it('refuses state from a newer version of the app', () => {
    expect(isPersisted({ ...valid, version: 99 })).toBe(false)
  })

  it('refuses a workspace with no project or a project with no workflow', () => {
    expect(isPersisted({ ...valid, projects: [] })).toBe(false)
    expect(isPersisted({ ...valid, projects: [{ ...valid.projects[0], workflows: [] }] })).toBe(false)
  })

  it('refuses a node that points at no agent', () => {
    const node = { id: 'n', type: 'agent', position: { x: 0, y: 0 }, data: {} }
    const projects = [{ ...valid.projects[0], workflows: [{ ...workflow, nodes: [node] }] }]
    expect(isPersisted({ ...valid, projects })).toBe(false)
  })
})
