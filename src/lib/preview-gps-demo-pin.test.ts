import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { selectableRoutes } from '@/data/selectable-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import type { ActiveRouteId } from '@/lib/pure-route-geometry'
import {
  prepareDemoRouteGeometry,
  resolveDemoNextPinAfterChainage,
  resolveDemoPinChainage,
  resolveDemoStartPinChainage,
} from '@/lib/preview-gps-demo-pin'

describe('preview-gps-demo-pin chainage', () => {
  it('resolves every active-route PIN forward on the exam line', () => {
    const routes = selectableRoutes(TELAVI_ROUTES_FALLBACK)
    const failures: string[] = []

    for (const route of routes) {
      const slug = route.slug as ActiveRouteId
      const geometry = prepareDemoRouteGeometry(
        slug,
        examRouteLine(slug, route.pins),
      )
      const sorted = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      let cursor = 0
      for (const pin of sorted) {
        const chainage = resolveDemoPinChainage(geometry, route.pins, pin.sort_order, cursor)
        if (chainage === null) {
          failures.push(`${route.slug} PIN ${pin.sort_order}: unresolved`)
          continue
        }
        if (chainage + 1e-3 < cursor) {
          failures.push(
            `${route.slug} PIN ${pin.sort_order}: ${chainage.toFixed(1)}m before cursor ${cursor.toFixed(1)}m`,
          )
        }
        cursor = chainage
      }
    }

    expect(failures).toEqual([])
  })

  it('picks the forward Route 3 occurrence after PIN 14 (loop return)', () => {
    const route = selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === 'route-3')!
    const geometry = prepareDemoRouteGeometry('route-3', examRouteLine('route-3', route.pins))
    const pin14 = resolveDemoPinChainage(geometry, route.pins, 14, 0)
    const pin15 = resolveDemoPinChainage(geometry, route.pins, 15, pin14 ?? 0)

    expect(pin14).not.toBeNull()
    expect(pin15).not.toBeNull()
    expect(pin15!).toBeGreaterThan(pin14!)
    expect(pin15!).toBeGreaterThan(7_000)
  })

  it('resolveDemoNextPinAfterChainage picks the first PIN at/after a km jump', () => {
    const route = selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === 'route-2')!
    const geometry = prepareDemoRouteGeometry('route-2', examRouteLine('route-2', route.pins))
    const atStart = resolveDemoNextPinAfterChainage(geometry, route.pins, 0)
    expect(atStart?.sortOrder).toBe(1)

    const mid = resolveDemoNextPinAfterChainage(geometry, route.pins, 5_600)
    expect(mid).not.toBeNull()
    expect(mid!.sortOrder).toBeGreaterThan(1)
    expect(mid!.chainageMeters).toBeGreaterThanOrEqual(5_600 - 5)

    const pastEnd = resolveDemoNextPinAfterChainage(
      geometry,
      route.pins,
      geometry.totalLengthMeters + 100,
    )
    expect(pastEnd).toBeNull()
  })

  it('demo start for Route 3 PIN 16/17 drops on the west-loop pins, not at PIN 15', () => {
    const route = selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === 'route-3')!
    const geometry = prepareDemoRouteGeometry('route-3', examRouteLine('route-3', route.pins))
    const pin15 = resolveDemoPinChainage(geometry, route.pins, 15, 0)
    expect(pin15).not.toBeNull()

    const start16 = resolveDemoStartPinChainage(geometry, route.pins, 16, pin15!)
    const start17 = resolveDemoStartPinChainage(geometry, route.pins, 17, pin15!)
    const sequential16 = resolveDemoPinChainage(geometry, route.pins, 16, pin15!)

    expect(start16).not.toBeNull()
    expect(start17).not.toBeNull()
    expect(start16!).toBeLessThan(3_000)
    expect(start17!).toBeGreaterThan(start16!)
    expect(start17!).toBeLessThan(3_000)
    // Sequential resolver still parks near PIN 15 — start helper must diverge.
    expect(sequential16).not.toBeNull()
    expect(Math.abs(sequential16! - pin15!)).toBeLessThan(5)
    expect(start16!).toBeLessThan(pin15! - 1_000)
  })
})