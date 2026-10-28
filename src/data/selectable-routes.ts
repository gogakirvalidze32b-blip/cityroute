import type { RouteWithPins } from '@/types/database'

const SELECTABLE_ROUTE_SLUGS = new Set(['route-1', 'route-2', 'route-3', 'route-4'])

export function selectableRoutes(
  routes: readonly RouteWithPins[],
  includeTbilisiTest = false,
): RouteWithPins[] {
  return routes.filter(
    (route) =>
      SELECTABLE_ROUTE_SLUGS.has(route.slug) ||
      (includeTbilisiTest && route.slug === 'test-route-tbilisi'),
  )
}
