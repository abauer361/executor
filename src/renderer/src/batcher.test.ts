import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBatcher } from './batcher'

describe('batching', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('hands over a burst together and in order', () => {
    const apply = vi.fn()
    const batch = createBatcher<number>(apply, 50)

    batch.add(1)
    batch.add(2)
    vi.advanceTimersByTime(49)
    batch.add(3)
    expect(apply).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(apply).toHaveBeenCalledExactlyOnceWith([1, 2, 3])
  })

  it('starts a new batch after each handover', () => {
    const apply = vi.fn()
    const batch = createBatcher<number>(apply, 50)

    batch.add(1)
    vi.advanceTimersByTime(50)
    batch.add(2)
    vi.advanceTimersByTime(50)

    expect(apply.mock.calls).toEqual([[[1]], [[2]]])
  })

  it('hands over what is waiting when flushed, and nothing when empty', () => {
    const apply = vi.fn()
    const batch = createBatcher<number>(apply, 50)

    batch.flush()
    batch.add(1)
    batch.flush()
    vi.advanceTimersByTime(100)

    expect(apply).toHaveBeenCalledExactlyOnceWith([1])
  })
})
