const QUIET_MS = 400
const MAX_WAIT_MS = 2000

// Saves shortly after changes stop, but never later than the maximum wait. A streaming run changes
// state several times a second, so waiting for quiet alone would save nothing until it ended.
export function createSaveScheduler(save: () => void, quietMs = QUIET_MS, maxWaitMs = MAX_WAIT_MS) {
  let quiet: ReturnType<typeof setTimeout> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined

  const run = () => {
    clearTimeout(quiet)
    clearTimeout(deadline)
    quiet = undefined
    deadline = undefined
    save()
  }

  return {
    request() {
      clearTimeout(quiet)
      quiet = setTimeout(run, quietMs)
      deadline ??= setTimeout(run, maxWaitMs)
    },

    // Saves now if anything is waiting, for when the window is about to close.
    flush() {
      if (quiet !== undefined) run()
    }
  }
}
