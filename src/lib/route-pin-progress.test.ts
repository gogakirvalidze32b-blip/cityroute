import { afterEach, describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { clearActiveExam } from '@/lib/exam-persistence'
import { nextSortOrder } from '@/lib/route-resume'
import {
  clearRoutePinProgress,
  loadRoutePinProgress,
  readRoutePinProgress,
  saveRoutePinProgress,
} from './route-pin-progress'

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
      const orders = pins.slice(0, completed).map((pin) => pin.sort_order)
      saveRoutePinProgress(slug, orders)
      const restored = loadRoutePinProgress(slug)
      expect(restored).toEqual(orders)
      saveRoutePinProgress(slug, [])
      expect(loadRoutePinProgress(slug)).toEqual(orders)
      saveRoutePinProgress(slug, orders.slice(0, Math.floor(completed / 2)))
      expect(loadRoutePinProgress(slug)).toEqual(orders)
      expect(nextSortOrder(pins, new Set(restored ?? [])).nextSortOrder).toBe(
        pins[completed]?.sort_order ?? null,
      )
    }
  })

  it('drops the removed Route 3 PIN 12 from legacy and new persisted progress', () => {
    const legacy = Array.from({ length: 12 }, (_, index) => index + 1)
    localStorage.setItem('cityroute-pin-progress:route-3', JSON.stringify(legacy))

    expect(loadRoutePinProgress('route-3')).toEqual(Array.from({ length: 11 }, (_, index) => index + 1))

    saveRoutePinProgress('route-3', [...legacy, 13])
    expect(loadRoutePinProgress('route-3')).toEqual([
      ...Array.from({ length: 11 }, (_, index) => index + 1),
      13,
    ])
  })

  it('keeps each route progress separate and does not clear it with an active session', () => {
    const [route1, route2] = ROUTES
    saveRoutePinProgress(route1.slug, [1, 2, 3])
    saveRoutePinProgress(route2.slug, [1, 2])

    clearActiveExam(route1.id, route1.slug, route1.name)

    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2, 3])
    expect(loadRoutePinProgress(route2.slug)).toEqual([1, 2])
  })

  it('clears only the explicitly restarted route progress', () => {
    const [route1, route2] = ROUTES
    saveRoutePinProgress(route1.slug, [1, 2])
    saveRoutePinProgress(route2.slug, [1, 2, 3])

    clearRoutePinProgress(route1.slug)

    expect(loadRoutePinProgress(route1.slug)).toBeNull()
    expect(loadRoutePinProgress(route2.slug)).toEqual([1, 2, 3])
  })

  it('distinguishes missing progress from malformed saved progress', () => {
    const [route] = ROUTES
    expect(readRoutePinProgress(route.slug)).toEqual({ status: 'missing' })

    localStorage.setItem(`cityroute-pin-progress:${route.slug}`, '{')

    expect(readRoutePinProgress(route.slug)).toEqual({ status: 'invalid' })
    expect(loadRoutePinProgress(route.slug)).toBeNull()
  })
})
