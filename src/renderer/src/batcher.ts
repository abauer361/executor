const BATCH_MS = 50

// Collects items that arrive in a burst and hands them over together. A timer is used, not an
// animation frame, so a hidden window still receives its events.
export function createBatcher<T>(apply: (items: T[]) => void, delayMs = BATCH_MS) {
  let pending: T[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    clearTimeout(timer)
    timer = undefined
    if (pending.length === 0) return
    const items = pending
    pending = []
    apply(items)
  }

  return {
    add(item: T) {
      pending.push(item)
      timer ??= setTimeout(flush, delayMs)
    },
    flush
  }
}
