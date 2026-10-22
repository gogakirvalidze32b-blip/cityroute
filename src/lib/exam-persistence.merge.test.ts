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
  afterEach(() => localStorage.clear())

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

  it('keeps all four route progress records independently resumable', () => {
    const routes = [
      { slug: 'route-1', id: 'local-route-1', name: 'მარშრუტი 1', orders: [1, 2] },
      { slug: 'route-2', id: 'local-route-2', name: 'მარშრუტი 2', orders: [1, 2, 3] },
      { slug: 'route-3', id: 'local-route-3', name: 'მარშრუტი 3', orders: [1, 2, 3, 4] },
      { slug: 'route-4', id: 'local-route-4', name: 'მარშრუტი 4', orders: [1, 2, 3, 4, 5] },
    ] as const

    for (const route of routes) {
      saveActiveExam(
        saved({
          routeId: route.id,
          routeSlug: route.slug,
          routeName: route.name,
          exam: createExamSession(route.id, route.name),
          triggeredPins: route.orders.map((order) => `${route.slug}-${order}`),
          triggeredSortOrders: [...route.orders],
          lastPassedSortOrder: route.orders.at(-1)!,
          nextSortOrder: route.orders.at(-1)! + 1,
        }),
      )
    }

    for (const route of routes) {
      expect(loadActiveExam(route.id, route.slug, route.name)?.triggeredSortOrders).toEqual(route.orders)
      expect(loadActiveExam(route.id, route.slug, route.name)?.nextSortOrder).toBe(route.orders.at(-1)! + 1)
    }

    saveActiveExam(
      saved({
        routeId: 'local-route-1',
        routeSlug: 'route-1',
        routeName: 'მარშრუტი 1',
        triggeredSortOrders: [1, 2, 3],
        lastPassedSortOrder: 3,
        nextSortOrder: 4,
      }),
    )
    expect(loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')?.triggeredSortOrders).toEqual([1, 2, 3])
    expect(loadActiveExam('local-route-3', 'route-3', 'მარშრუტი 3')?.triggeredSortOrders).toEqual([1, 2, 3, 4])
    expect(loadActiveExam('local-route-4', 'route-4', 'მარშრუტი 4')?.triggeredSortOrders).toEqual([1, 2, 3, 4, 5])
  })

  it('migrates a legacy active route before saving progress for a different route', () => {
    saveActiveExam(saved({ routeId: 'local-route-3', routeSlug: 'route-3', routeName: 'მარშრუტი 3' }))

    saveActiveExam(
      saved({
        routeId: 'local-route-1',
        routeSlug: 'route-1',
        routeName: 'მარშრუტი 1',
        triggeredSortOrders: [1],
        nextSortOrder: 2,
      }),
    )

    expect(loadActiveExam('local-route-3', 'route-3', 'მარშრუტი 3')?.triggeredSortOrders).toEqual([1, 2])
    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')?.triggeredSortOrders).toEqual([1])
  })

  it('clearing one route leaves other route progress intact', () => {
    saveActiveExam(saved({ routeId: 'local-route-1', routeSlug: 'route-1' }))
    saveActiveExam(saved({ routeId: 'local-route-2', routeSlug: 'route-2' }))

    clearActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')

    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')).toBeNull()
    expect(loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')?.triggeredSortOrders).toEqual([1, 2])
  })

  it('persists the pending instruction independently from handled route progress', () => {
    saveActiveExam(saved({ pendingPinSortOrder: 3 }))
    const loaded = loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')
    expect(loaded?.triggeredSortOrders).toEqual([1, 2])
    expect(loaded?.nextSortOrder).toBe(3)
    expect(loaded?.pendingPinSortOrder).toBe(3)
  })
})
