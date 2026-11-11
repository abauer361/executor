import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSaveScheduler } from './saveScheduler'

describe('save scheduling', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('saves once shortly after changes stop', () => {
    const save = vi.fn()
    const scheduler = createSaveScheduler(save, 400, 2000)

    scheduler.request()
    vi.advanceTimersByTime(300)
    scheduler.request()
    vi.advanceTimersByTime(399)
    expect(save).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('still saves while changes never stop, as during a streaming run', () => {
    const save = vi.fn()
    const scheduler = createSaveScheduler(save, 400, 2000)

    for (let elapsed = 0; elapsed < 5000; elapsed += 100) {
      scheduler.request()
      vi.advanceTimersByTime(100)
    }

    expect(save).toHaveBeenCalledTimes(2)
  })

  it('saves at once when the window is closing', () => {
    const save = vi.fn()
    const scheduler = createSaveScheduler(save, 400, 2000)

    scheduler.request()
    scheduler.flush()
    expect(save).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(5000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('does not save on close when nothing changed', () => {
    const save = vi.fn()
    createSaveScheduler(save).flush()
    expect(save).not.toHaveBeenCalled()
  })
})
