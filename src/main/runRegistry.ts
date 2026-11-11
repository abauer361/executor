import type { RunHandle } from './runEngine'

// Tracks live runs by the window that started them. A run reports only to that window, so once the
// window is gone nobody could see, approve or stop it, and it must not keep spending.
export function createRunRegistry() {
  const runs = new Map<string, { ownerId: number; handle: RunHandle }>()

  return {
    get size() {
      return runs.size
    },

    has: (runId: string) => runs.has(runId),
    get: (runId: string) => runs.get(runId)?.handle,

    add(ownerId: number, runId: string, handle: RunHandle) {
      runs.set(runId, { ownerId, handle })
      const forget = () => {
        if (runs.get(runId)?.handle === handle) runs.delete(runId)
      }
      handle.done.then(forget, forget)
    },

    stopOwnedBy(ownerId: number) {
      for (const run of runs.values()) {
        if (run.ownerId === ownerId) run.handle.stop()
      }
    },

    // Stops every run and waits for them to close their servers, but never longer than the limit.
    async stopAll(limitMs: number) {
      const pending = [...runs.values()].map(({ handle }) => {
        handle.stop()
        return handle.done
      })
      let timer: ReturnType<typeof setTimeout> | undefined
      const limit = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, limitMs)
      })
      await Promise.race([Promise.allSettled(pending), limit])
      clearTimeout(timer)
    }
  }
}
