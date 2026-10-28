import { afterEach, describe, expect, it } from 'vitest'
import { createExamSession } from '@/lib/exam-session'
import {
  clearActiveExam,
  loadActiveExam,
  mergeExamSave,
  saveActiveExam,
  type SavedExamState,
} from '@/lib/exam-persistence'

function saved(over: Partial<SavedExamState> = {}): SavedExamState {
  return {
    routeId: 'local-route-2',
    routeSlug: 'route-2',
    routeName: 'მარშრუტი 2',
    phase: 'active',
    exam: createExamSession('local-route-2', 'მარშრუტი 2'),
    userPos: null,
    heading: 0,
    speedKmh: 0,
    elapsedMs: 60_000,
    triggeredPins: ['p2-1', 'p2-2'],
    triggeredSortOrders: [1, 2],
    lastPassedSortOrder: 2,
    nextSortOrder: 3,
    savedAt: 1_000,
    ...over,
  }
}

describe('exam save merge: incomplete writes do not replace progress', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('keeps sort-order progress when a later save has no orders (empty pin list)', () => {
    const previous = saved()
    const incomplete = saved({
      triggeredPins: ['uuid-1', 'uuid-2'],
      triggeredSortOrders: undefined,
      lastPassedSortOrder: undefined,
      nextSortOrder: undefined,
      savedAt: 2_000,
    })
    const merged = mergeExamSave(previous, incomplete)
    expect(merged.triggeredSortOrders).toEqual([1, 2])
    expect(merged.nextSortOrder).toBe(3)
    expect(merged.lastPassedSortOrder).toBe(2)
    expect(merged.triggeredPins).toEqual(['uuid-1', 'uuid-2'])
  })

  it('keeps the richer prefix when a stale save has fewer handled pins', () => {
    const previous = saved({ triggeredSortOrders: [1, 2, 3], lastPassedSortOrder: 3, nextSortOrder: 4 })
    const stale = saved({ triggeredSortOrders: [1], lastPassedSortOrder: 1, nextSortOrder: 2, savedAt: 9_000 })
    expect(mergeExamSave(previous, stale)).toBe(previous)
  })

  it('accepts a later save that advanced further along the same route', () => {
    const previous = saved()
    const next = saved({
      triggeredPins: ['p2-1', 'p2-2', 'p2-3'],
      triggeredSortOrders: [1, 2, 3],
      lastPassedSortOrder: 3,
      nextSortOrder: 4,
      savedAt: 3_000,
    })
    expect(mergeExamSave(previous, next)).toEqual(next)
  })

  it('preserves an unfinished instruction across saves that predate pending-pin metadata', () => {
    const previous = saved({ pendingPinSortOrder: 3 })
    const legacyWrite = saved({ savedAt: 2_000 })
    expect(mergeExamSave(previous, legacyWrite).pendingPinSortOrder).toBe(3)
  })

  it('clears pending audio only when a newer save explicitly clears it', () => {
    const previous = saved({ pendingPinSortOrder: 3 })
    const completed = saved({
      triggeredPins: ['p2-1', 'p2-2', 'p2-3'],
      triggeredSortOrders: [1, 2, 3],
      lastPassedSortOrder: 3,
      nextSortOrder: 4,
      pendingPinSortOrder: null,
      savedAt: 2_000,
    })
    expect(mergeExamSave(previous, completed).pendingPinSortOrder).toBeNull()
  })

  it('preserves an audio queue when a later save predates queue metadata', () => {
    const previous = saved({ pendingPinSortOrder: 3, queuedPinSortOrders: [4, 5] })
    const legacyWrite = saved({ savedAt: 2_000 })
    expect(mergeExamSave(previous, legacyWrite).queuedPinSortOrders).toEqual([4, 5])
  })

  it('clears the queue only when a newer save explicitly writes an empty queue', () => {
    const previous = saved({ pendingPinSortOrder: 3, queuedPinSortOrders: [4, 5] })
    const completed = saved({
      triggeredPins: ['p2-1', 'p2-2', 'p2-3'],
      triggeredSortOrders: [1, 2, 3],
      lastPassedSortOrder: 3,
      nextSortOrder: 4,
      pendingPinSortOrder: null,
      queuedPinSortOrders: [],
      savedAt: 2_000,
    })
    expect(mergeExamSave(previous, completed).pendingPinSortOrder).toBeNull()
    expect(mergeExamSave(previous, completed).queuedPinSortOrders).toEqual([])
  })

  it('lets a different route replace the single active slot', () => {
    const previous = saved()
    const other = saved({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      triggeredPins: ['p1-1'],
      triggeredSortOrders: undefined,
    })
    expect(mergeExamSave(previous, other)).toEqual(other)
  })

  it('saveActiveExam does not drop stored orders when writing an incomplete snapshot', () => {
    saveActiveExam(saved())
    saveActiveExam(
      saved({
        triggeredPins: [],
        triggeredSortOrders: undefined,
        lastPassedSortOrder: undefined,
        nextSortOrder: undefined,
      }),
    )
    const loaded = loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')
    expect(loaded?.triggeredSortOrders).toEqual([1, 2])
    expect(loaded?.nextSortOrder).toBe(3)
  })

  it('persists the pending instruction independently from handled route progress', () => {
    saveActiveExam(saved({ pendingPinSortOrder: 3 }))
    const loaded = loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')
    expect(loaded?.triggeredSortOrders).toEqual([1, 2])
    expect(loaded?.nextSortOrder).toBe(3)
    expect(loaded?.pendingPinSortOrder).toBe(3)
  })

  it('keeps Route 1 and Route 2 progress independently resumable across route changes', () => {
    const route1 = saved({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      triggeredPins: ['p1-1', 'p1-2'],
      triggeredSortOrders: [1, 2],
      nextSortOrder: 3,
      pendingPinSortOrder: 2,
      queuedPinSortOrders: [3],
    })
    const route2 = saved({
      triggeredPins: ['p2-1', 'p2-2', 'p2-3'],
      triggeredSortOrders: [1, 2, 3],
      lastPassedSortOrder: 3,
      nextSortOrder: 4,
      pendingPinSortOrder: 1,
      queuedPinSortOrders: [2],
    })

    saveActiveExam(route1)
    saveActiveExam(route2)

    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')?.nextSortOrder).toBe(3)
    expect(loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')?.nextSortOrder).toBe(4)
    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')?.queuedPinSortOrders).toEqual([3])
    expect(loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')?.queuedPinSortOrders).toEqual([2])
    expect(localStorage.getItem('cityroute-active-exam:route-1')).not.toBeNull()
    expect(localStorage.getItem('cityroute-active-exam:route-2')).not.toBeNull()
  })

  it('clears only the selected route and leaves other route progress intact', () => {
    saveActiveExam(saved({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      triggeredSortOrders: [1],
      nextSortOrder: 2,
    }))
    saveActiveExam(saved())

    clearActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')

    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')).toBeNull()
    expect(loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')?.nextSortOrder).toBe(3)
  })

  it('migrates an older single-route save when its route is opened', () => {
    const legacy = saved({
      routeId: 'local-route-1',
      routeSlug: undefined,
      routeName: 'მარშრუტი 1',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      triggeredPins: ['p1-1'],
      triggeredSortOrders: undefined,
      nextSortOrder: undefined,
      savedAt: Date.now(),
    })
    localStorage.setItem('cityroute-active-exam', JSON.stringify(legacy))

    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')?.triggeredPins).toEqual(['p1-1'])
    expect(localStorage.getItem('cityroute-active-exam:route-1')).not.toBeNull()
    expect(loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')).toBeNull()
  })

  it('preserves a legacy route while another route is saved', () => {
    const legacy = saved({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      triggeredSortOrders: [1],
      nextSortOrder: 2,
      savedAt: Date.now(),
    })
    localStorage.setItem('cityroute-active-exam', JSON.stringify(legacy))

    saveActiveExam(saved())

    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')?.nextSortOrder).toBe(2)
    expect(loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')?.nextSortOrder).toBe(3)
  })

  it('rejects malformed legacy data without deleting or replacing it', () => {
    const malformed = JSON.stringify({ routeId: 'local-route-1', savedAt: Date.now() })
    localStorage.setItem('cityroute-active-exam', malformed)

    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')).toBeNull()
    expect(localStorage.getItem('cityroute-active-exam')).toBe(malformed)
  })

  it('expires only the selected route save', () => {
    const now = Date.now()
    saveActiveExam(saved({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      savedAt: now - 25 * 60 * 60 * 1000,
    }))
    saveActiveExam(saved())
    const expiredRoute = JSON.parse(localStorage.getItem('cityroute-active-exam:route-1')!)
    expiredRoute.savedAt = now - 25 * 60 * 60 * 1000
    localStorage.setItem('cityroute-active-exam:route-1', JSON.stringify(expiredRoute))

    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')).toBeNull()
    expect(loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')?.nextSortOrder).toBe(3)
  })
})
