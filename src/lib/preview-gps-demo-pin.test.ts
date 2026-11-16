import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { selectableRoutes } from '@/data/selectable-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import { prepareDemoRouteGeometry, resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'

describe('preview-gps-demo-pin chainage', () => {
  it('resolves every active-route PIN forward on the exam line', () => {
    const routes = selectableRoutes(TELAVI_ROUTES_FALLBACK)
    const failures: string[] = []

    for (const route of routes) {
      const geometry = prepareDemoRouteGeometry(
        route.slug,
        examRouteLine(route.slug, route.pins),
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
})