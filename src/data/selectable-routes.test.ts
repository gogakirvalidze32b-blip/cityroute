import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from './telavi-routes'
import { selectableRoutes } from './selectable-routes'

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
})
