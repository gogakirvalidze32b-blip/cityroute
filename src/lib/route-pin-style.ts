/**
 * Route PIN marker look shared by the live navigation map and the demo route
 * preview (visual only): golden markers that stand out from the turquoise
 * route and the blue vehicle arrow. The upcoming / selected PIN is the
 * brightest and largest; passed PINs are small and dim.
 */
export const ROUTE_PIN_STYLE = {
  next: { radius: 8, fill: '#ffd43b', fillOpacity: 1, stroke: '#fff4c2', strokeOpacity: 1, weight: 2.5 },
  upcoming: { radius: 6, fill: '#f5b524', fillOpacity: 0.95, stroke: '#3a2a05', strokeOpacity: 0.55, weight: 1.5 },
  passed: { radius: 4.5, fill: '#9c8247', fillOpacity: 0.55, stroke: '#f5b524', strokeOpacity: 0.3, weight: 1 },
} as const

export type RoutePinStyle = (typeof ROUTE_PIN_STYLE)[keyof typeof ROUTE_PIN_STYLE]
