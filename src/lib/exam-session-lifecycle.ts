export interface ExamSessionLifecycleOptions {
  save: () => void | Promise<unknown>
  waitForPendingWrites: () => Promise<unknown>
  releaseLease: () => Promise<unknown>
  onSaveFailure: (error: unknown) => void
  onReleaseFailure: (error: unknown) => void
}

export function createExamSessionLifecycle({
  save,
  waitForPendingWrites,
  releaseLease,
  onSaveFailure,
  onReleaseFailure,
}: ExamSessionLifecycleOptions) {
  let pagehideOccurred = false

  return {
    pagehide() {
      pagehideOccurred = true
      let pendingSave: void | Promise<unknown>
      try {
        pendingSave = save()
      } catch (error) {
        onSaveFailure(error)
        return
      }
      if (pendingSave) void Promise.resolve(pendingSave).catch(() => undefined)
    },
    pageshow() {
      pagehideOccurred = false
    },
    unmount() {
      if (pagehideOccurred) return

      let finalSave: void | Promise<unknown>
      try {
        finalSave = save()
      } catch (error) {
        onSaveFailure(error)
        return
      }

      void Promise.resolve(finalSave)
        .catch(() => undefined)
        .then(waitForPendingWrites)
        .then(releaseLease)
        .catch(onReleaseFailure)
    },
  }
}
