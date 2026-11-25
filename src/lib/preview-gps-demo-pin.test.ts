import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { selectableRoutes } from '@/data/selectable-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import {
  projectOrderedPointsToRoute,
  projectPointToRoute,
  projectPointToRouteNearChainage,
  type ActiveRouteId,
} from '@/lib/pure-route-geometry'
import {
  prepareDemoRouteGeometry,
  resolveDemoNextPinAfterChainage,
  resolveDemoPinChainage,
  resolveDemoStartPinChainage,
} from '@/lib/preview-gps-demo-pin'

describe('preview-gps-demo-pin chainage', () => {
  it('resolves Route 3 PINs 5–7 in road order through the Alazani turn', () => {
    const route = selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === 'route-3')!
    const geometry = prepareDemoRouteGeometry('route-3', examRouteLine('route-3', route.pins))
    const pin5 = resolveDemoPinChainage(geometry, route.pins, 5, 0)
    const pin6 = resolveDemoPinChainage(geometry, route.pins, 6, pin5 ?? 0)
    const pin7 = resolveDemoPinChainage(geometry, route.pins, 7, pin6 ?? 0)
    const pin8 = resolveDemoPinChainage(geometry, route.pins, 8, pin7 ?? 0)
    const pin6Point = route.pins.find((pin) => pin.sort_order === 6)!
    const pin7Point = route.pins.find((pin) => pin.sort_order === 7)!
    const nearestPin6 = projectPointToRoute(geometry, [pin6Point.lat, pin6Point.lng])
    const nearestPin7 = projectPointToRoute(geometry, [pin7Point.lat, pin7Point.lng])

    expect(pin5).not.toBeNull()
    expect(pin6).not.toBeNull()
    expect(pin7).not.toBeNull()
    expect(pin8).not.toBeNull()
    expect(nearestPin6).not.toBeNull()
    expect(nearestPin7).not.toBeNull()
    expect(pin5!).toBeLessThan(pin6!)
    expect(pin6!).toBeLessThan(1_000)
    expect(pin6!).toBeCloseTo(nearestPin6!.chainageMeters, 0)
    expect(pin6!).toBeLessThan(pin7!)
    expect(pin7!).toBeCloseTo(nearestPin7!.chainageMeters, 0)
    expect(pin7!).toBeLessThan(pin8!)
  })

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

  it.each([
    ['route-2', 9],
    ['route-4', 6],
  ] as const)('%s PIN %i resolves to its nearest road occurrence', (slug, sortOrder) => {
    const route = selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === slug)!
    const geometry = prepareDemoRouteGeometry(
      slug,
      examRouteLine(slug, route.pins),
    )
    const pin = route.pins.find((item) => item.sort_order === sortOrder)!
    const nearest = projectPointToRoute(geometry, [pin.lat, pin.lng])

    expect(nearest).not.toBeNull()
    expect(resolveDemoPinChainage(geometry, route.pins, sortOrder, 0)).toBeCloseTo(
      nearest!.chainageMeters,
      5,
    )
  })

  it('resolves Route 2 PIN 25 to the forward road projection, not its earlier occurrence', () => {
    const route = selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === 'route-2')!
    const geometry = prepareDemoRouteGeometry(
      'route-2',
      examRouteLine('route-2', route.pins),
    )
    const pin = route.pins.find((item) => item.sort_order === 25)!
    const ordered = projectOrderedPointsToRoute(
      geometry,
      route.pins
        .filter((item) => item.sort_order <= 25)
        .sort((first, second) => first.sort_order - second.sort_order)
        .map((item) => [item.lat, item.lng] as const),
    )
    expect(ordered).not.toBeNull()
    const forward = projectPointToRouteNearChainage(
      geometry,
      [pin.lat, pin.lng],
      ordered!.chainageMeters,
      40,
    )

    expect(forward).not.toBeNull()
    expect(forward!.chainageMeters).toBeGreaterThan(ordered!.chainageMeters)
    expect(resolveDemoPinChainage(geometry, route.pins, 25, 0)).toBeCloseTo(
      forward!.chainageMeters,
      5,
    )
  })

  it('keeps Route 3 PIN 15 between PIN 14 and PIN 16 on the forward loop return', () => {
    const route = selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === 'route-3')!
    const geometry = prepareDemoRouteGeometry('route-3', examRouteLine('route-3', route.pins))
    const pin14 = resolveDemoPinChainage(geometry, route.pins, 14, 0)
    const pin15 = resolveDemoPinChainage(geometry, route.pins, 15, pin14 ?? 0)
    const pin16 = resolveDemoPinChainage(geometry, route.pins, 16, pin15 ?? 0)
    const pin15Point = route.pins.find((pin) => pin.sort_order === 15)!
    const nearestPin15 = projectPointToRoute(geometry, [pin15Point.lat, pin15Point.lng])

    expect(pin14).not.toBeNull()
    expect(pin15).not.toBeNull()
    expect(pin16).not.toBeNull()
    expect(nearestPin15).not.toBeNull()
    expect(nearestPin15!.chainageMeters).toBeLessThan(pin14!)
    expect(pin15!).toBeGreaterThan(pin14!)
    expect(pin15!).toBeGreaterThan(3_850)
    expect(pin15!).toBeLessThan(4_050)
    expect(pin16!).toBeGreaterThan(pin15!)
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

  it('starts Route 3 PIN 16/17 on their forward occurrences and progresses in order', () => {
    const route = selectableRoutes(TELAVI_ROUTES_FALLBACK).find((item) => item.slug === 'route-3')!
    const geometry = prepareDemoRouteGeometry('route-3', examRouteLine('route-3', route.pins))
    const pin15 = resolveDemoPinChainage(geometry, route.pins, 15, 0)
    expect(pin15).not.toBeNull()

    const start16 = resolveDemoStartPinChainage(geometry, route.pins, 16, pin15!)
    const start17 = resolveDemoStartPinChainage(geometry, route.pins, 17, pin15!)
    const sequential16 = resolveDemoPinChainage(geometry, route.pins, 16, pin15!)
    const sequential17 = resolveDemoPinChainage(geometry, route.pins, 17, sequential16 ?? 0)
    const pin16 = route.pins.find((pin) => pin.sort_order === 16)!
    const pin17 = route.pins.find((pin) => pin.sort_order === 17)!
    const nearest16 = projectPointToRoute(geometry, [pin16.lat, pin16.lng])
    const nearest17 = projectPointToRoute(geometry, [pin17.lat, pin17.lng])

    expect(start16).not.toBeNull()
    expect(start17).not.toBeNull()
    expect(sequential16).not.toBeNull()
    expect(sequential17).not.toBeNull()
    expect(nearest16).not.toBeNull()
    expect(nearest17).not.toBeNull()
    expect(start16!).toBeGreaterThan(pin15!)
    expect(start17!).toBeGreaterThan(start16!)
    expect(start16!).toBeCloseTo(nearest16!.chainageMeters, 0)
    expect(start17!).toBeCloseTo(nearest17!.chainageMeters, 0)
    expect(sequential16!).toBeCloseTo(nearest16!.chainageMeters, 0)
    expect(sequential17!).toBeCloseTo(nearest17!.chainageMeters, 0)
    expect(sequential17!).toBeGreaterThan(sequential16!)
  })
})