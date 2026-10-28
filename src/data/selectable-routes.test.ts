import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from './telavi-routes'
import { selectableRoutes } from './selectable-routes'
import { applyLocalTbilisiTestPin, LOCAL_TBILISI_TEST_ROUTE } from './local-tbilisi-test-pin'

describe('selectable routes', () => {
  it('exposes only Routes 1–4 without removing other route data', () => {
    const routes = selectableRoutes(TELAVI_ROUTES_FALLBACK)

    expect(routes.map((route) => route.slug)).toEqual([
      'route-1',
      'route-2',
      'route-3',
      'route-4',
    ])
    expect(TELAVI_ROUTES_FALLBACK.some((route) => route.slug === 'route-5')).toBe(true)
  })

  it('exposes the local Tbilisi test route only when explicitly enabled', () => {
    const withTestRoute = applyLocalTbilisiTestPin(TELAVI_ROUTES_FALLBACK)
    const withoutTestRoute = applyLocalTbilisiTestPin(TELAVI_ROUTES_FALLBACK, false)

    expect(selectableRoutes(withoutTestRoute).some((route) => route.slug === LOCAL_TBILISI_TEST_ROUTE.slug)).toBe(false)
    expect(
      selectableRoutes(withTestRoute, true).some((route) => route.slug === LOCAL_TBILISI_TEST_ROUTE.slug),
    ).toBe(true)
    expect(
      selectableRoutes(withTestRoute, false).some((route) => route.slug === LOCAL_TBILISI_TEST_ROUTE.slug),
    ).toBe(false)
  })
})
