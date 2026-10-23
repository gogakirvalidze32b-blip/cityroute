import { afterEach, describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { clearActiveExam } from '@/lib/exam-persistence'
import { nextSortOrder } from '@/lib/route-resume'
import { loadRoutePinProgress, saveRoutePinProgress } from './route-pin-progress'

const ROUTES = ['route-1', 'route-2', 'route-3', 'route-4'].map((slug) => {
  const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
  return {
    slug,
    id: route.id,
    name: route.name_ka,
    pins: route.pins,
  }
})

describe('route PIN progress is independent from the active session', () => {
  afterEach(() => localStorage.clear())

  it.each(ROUTES)('$slug restores the next PIN for every completed-prefix length', ({ slug, pins }) => {
    for (let completed = 0; completed <= pins.length; completed += 1) {
      const orders = Array.from({ length: completed }, (_, index) => index + 1)
      saveRoutePinProgress(slug, orders)
      const restored = loadRoutePinProgress(slug)
      expect(restored).toEqual(orders)
      saveRoutePinProgress(slug, [])
      expect(loadRoutePinProgress(slug)).toEqual(orders)
      saveRoutePinProgress(slug, orders.slice(0, Math.floor(completed / 2)))
      expect(loadRoutePinProgress(slug)).toEqual(orders)
      expect(nextSortOrder(pins, new Set(restored ?? [])).nextSortOrder).toBe(
        completed < pins.length ? completed + 1 : null,
      )
    }
  })

  it('keeps each route progress separate and does not clear it with an active session', () => {
    const [route1, route2] = ROUTES
    saveRoutePinProgress(route1.slug, [1, 2, 3])
    saveRoutePinProgress(route2.slug, [1, 2])

    clearActiveExam(route1.id, route1.slug, route1.name)

    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2, 3])
    expect(loadRoutePinProgress(route2.slug)).toEqual([1, 2])
  })
})
