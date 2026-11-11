import { describe, expect, it, vi } from 'vitest'
import { createExamSessionLifecycle } from './exam-session-lifecycle'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('Exam Session lease lifecycle', () => {
  it('waits for the final remote autosave before releasing on unmount', async () => {
    const save = deferred<void>()
    const release = vi.fn(async () => undefined)
    const lifecycle = createExamSessionLifecycle({
      save: () => save.promise,
      waitForPendingWrites: async () => undefined,
      releaseLease: release,
      onSaveFailure: vi.fn(),
      onReleaseFailure: vi.fn(),
    })

    lifecycle.unmount()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()

    save.resolve()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  })

  it('retains the lease for expiry when pagehide prevents async save confirmation', async () => {
    const save = deferred<void>()
    const release = vi.fn(async () => undefined)
    const lifecycle = createExamSessionLifecycle({
      save: vi.fn(() => save.promise),
      waitForPendingWrites: async () => undefined,
      releaseLease: release,
      onSaveFailure: vi.fn(),
      onReleaseFailure: vi.fn(),
    })

    lifecycle.pagehide()
    lifecycle.unmount()
    await Promise.resolve()

    expect(release).not.toHaveBeenCalled()
    save.reject(new Error('page is closing'))
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()
  })

  it('waits for pending writes during unmount even if the final save fails', async () => {
    const save = deferred<void>()
    const release = vi.fn(async () => undefined)
    const lifecycle = createExamSessionLifecycle({
      save: () => save.promise,
      waitForPendingWrites: async () => undefined,
      releaseLease: release,
      onSaveFailure: vi.fn(),
      onReleaseFailure: vi.fn(),
    })

    lifecycle.unmount()
    save.reject(new Error('remote save failed'))
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  })

  it('releases after pending writes settle on a normal unmount', async () => {
    const writes = deferred<void>()
    const release = vi.fn(async () => undefined)
    const lifecycle = createExamSessionLifecycle({
      save: () => undefined,
      waitForPendingWrites: () => writes.promise,
      releaseLease: release,
      onSaveFailure: vi.fn(),
      onReleaseFailure: vi.fn(),
    })

    lifecycle.unmount()
    await Promise.resolve()
    expect(release).not.toHaveBeenCalled()

    writes.resolve()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
  })
})
