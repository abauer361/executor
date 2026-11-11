import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createListCache } from './listCache'

const folder = mkdtempSync(join(tmpdir(), 'executor-cache-'))
afterAll(() => rmSync(folder, { recursive: true, force: true }))

let files = 0
const freshPath = () => join(folder, `list-${(files += 1)}.json`)

// Keeps only strings, the way the real parsers keep only entries they can validate.
const parse = (raw: unknown) => (Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [])

function cacheAt(path: string, responses: unknown[], clock = { now: 1_000_000 }) {
  const state = { fetches: 0 }
  const cache = createListCache({
    path: () => path,
    fetchRaw: async () => {
      const response = responses[Math.min(state.fetches, responses.length - 1)]
      state.fetches += 1
      if (response instanceof Error) throw response
      return response
    },
    parse,
    worthKeeping: (value) => value.length > 0,
    maxAgeMs: 1000,
    now: () => clock.now
  })
  return { cache, state, clock }
}

describe('list cache', () => {
  it('fetches the first time and answers from memory after that', async () => {
    const { cache, state } = cacheAt(freshPath(), [['a', 'b']])

    expect(await cache.read()).toEqual({ value: ['a', 'b'], stale: false })
    expect(await cache.read()).toEqual({ value: ['a', 'b'], stale: false })
    expect(state.fetches).toBe(1)
  })

  it('answers at once from disk after a restart, without the network', async () => {
    const path = freshPath()
    await cacheAt(path, [['a']]).cache.read()

    const restarted = cacheAt(path, [new Error('offline')])
    expect(await restarted.cache.read()).toEqual({ value: ['a'], stale: false })
    expect(restarted.state.fetches).toBe(0)
  })

  it('still shows an old list, and says it is due a refresh', async () => {
    const path = freshPath()
    const { cache, clock } = cacheAt(path, [['old'], ['new']])
    await cache.read()

    clock.now += 5000
    expect(await cache.read()).toEqual({ value: ['old'], stale: true })
    expect(await cache.refresh()).toEqual(['new'])
    expect(await cache.read()).toEqual({ value: ['new'], stale: false })
  })

  it('keeps the remembered list when a refresh fails or comes back empty', async () => {
    const { cache } = cacheAt(freshPath(), [['a'], new Error('offline'), []])
    await cache.read()

    await expect(cache.refresh()).rejects.toThrow('offline')
    expect((await cache.read()).value).toEqual(['a'])
    await cache.refresh()
    expect((await cache.read()).value).toEqual(['a'])
  })

  it('shares one request between callers that ask at the same time', async () => {
    const { cache, state } = cacheAt(freshPath(), [['a']])
    await Promise.all([cache.refresh(), cache.refresh(), cache.warm()])
    expect(state.fetches).toBe(1)
  })

  it('runs a saved file through the parser, so edits to it are not trusted', async () => {
    const path = freshPath()
    writeFileSync(path, JSON.stringify({ savedAt: 999_999, raw: ['kept', { evil: true }, 42] }))
    expect((await cacheAt(path, [new Error('offline')]).cache.read()).value).toEqual(['kept'])
  })

  it('ignores a damaged file and a date from the future', async () => {
    const damaged = freshPath()
    writeFileSync(damaged, '{"raw": [')
    expect(await cacheAt(damaged, [['net']]).cache.read()).toEqual({ value: ['net'], stale: false })

    const future = freshPath()
    writeFileSync(future, JSON.stringify({ savedAt: 9_999_999_999_999, raw: ['a'] }))
    expect(await cacheAt(future, [['net']]).cache.read()).toEqual({ value: ['a'], stale: true })
  })

  it('warms from disk at launch and refreshes only what is out of date', async () => {
    const path = freshPath()
    await cacheAt(path, [['a']]).cache.read()

    const soon = cacheAt(path, [['b']])
    await soon.cache.warm()
    expect(soon.state.fetches).toBe(0)

    const later = cacheAt(path, [['b']], { now: 2_000_000 })
    await later.cache.warm()
    expect(later.state.fetches).toBe(1)
    expect(JSON.parse(readFileSync(path, 'utf8')).raw).toEqual(['b'])
  })
})
