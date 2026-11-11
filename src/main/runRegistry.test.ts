import { describe, expect, it } from 'vitest'
import type { RunHandle } from './runEngine'
import { createRunRegistry } from './runRegistry'

function fakeRun(finishOnStop = true) {
  let finish = () => {}
  const state = { stopped: 0 }
  const done = new Promise<void>((resolve) => {
    finish = resolve
  })
  const handle: RunHandle = {
    stop: () => {
      state.stopped += 1
      if (finishOnStop) finish()
    },
    inject: () => {},
    resolveApproval: () => {},
    done
  }
  return { handle, state, finish }
}

describe('run registry', () => {
  it('stops only the runs started by the window that went away', () => {
    const registry = createRunRegistry()
    const mine = fakeRun()
    const other = fakeRun()
    registry.add(1, 'a', mine.handle)
    registry.add(2, 'b', other.handle)

    registry.stopOwnedBy(1)

    expect(mine.state.stopped).toBe(1)
    expect(other.state.stopped).toBe(0)
  })

  it('forgets a run once it finishes', async () => {
    const registry = createRunRegistry()
    const run = fakeRun()
    registry.add(1, 'a', run.handle)
    expect(registry.has('a')).toBe(true)

    run.finish()
    await run.handle.done

    expect(registry.size).toBe(0)
    expect(registry.get('a')).toBeUndefined()
  })

  it('forgets a run that fails', async () => {
    const registry = createRunRegistry()
    const handle: RunHandle = { ...fakeRun().handle, done: Promise.reject(new Error('broken')) }
    registry.add(1, 'a', handle)
    await handle.done.catch(() => {})
    expect(registry.size).toBe(0)
  })

  it('waits for every run to wind down before quitting', async () => {
    const registry = createRunRegistry()
    const runs = [fakeRun(), fakeRun()]
    runs.forEach((run, index) => registry.add(index, String(index), run.handle))

    await registry.stopAll(1000)

    expect(runs.map((run) => run.state.stopped)).toEqual([1, 1])
    expect(registry.size).toBe(0)
  })

  it('gives up waiting on a run that will not stop', async () => {
    const registry = createRunRegistry()
    const stuck = fakeRun(false)
    registry.add(1, 'a', stuck.handle)

    await registry.stopAll(5)

    expect(stuck.state.stopped).toBe(1)
  })
})
