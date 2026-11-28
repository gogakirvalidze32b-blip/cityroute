/**
 * Frozen exam route geometry — the single source of truth for route chainage.
 *
 * Each JSON file is an exact export of the pre-migration runtime geometry
 * (examRouteLine / examMapRouteLines built from the bundled PINs on
 * 2026-11-27). The line no longer depends on PIN coordinates at runtime, so
 * moving or editing a PIN can never reshape the route or shift the chainage
 * (HUD km, speed bands, PIN kilometres) of everything after it.
 *
 * `version` is a content hash of `matchLine`. Persisted progress and the PIN
 * chainage table record the version they were computed against; a mismatch
 * means route kilometres are no longer comparable.
 */
import type { LatLng } from '@/lib/gps'
import route1 from './route-geometry/route-1.geometry.json'
import route2 from './route-geometry/route-2.geometry.json'
import route3 from './route-geometry/route-3.geometry.json'
import route4 from './route-geometry/route-4.geometry.json'

export type FrozenRouteGeometry = {
  readonly routeId: string
  readonly version: string
  readonly source: string
  /** Matching / chainage / HUD km / arrow line. */
  readonly matchLine: readonly LatLng[]
  /** Lines the live map and preview map draw. */
  readonly mapLines: readonly (readonly LatLng[])[]
}

const FROZEN: Readonly<Record<string, FrozenRouteGeometry>> = {
  'route-1': route1 as unknown as FrozenRouteGeometry,
  'route-2': route2 as unknown as FrozenRouteGeometry,
  'route-3': route3 as unknown as FrozenRouteGeometry,
  'route-4': route4 as unknown as FrozenRouteGeometry,
}

export function frozenRouteGeometry(slug: string): FrozenRouteGeometry | null {
  return FROZEN[slug] ?? null
}

export function routeGeometryVersion(slug: string): string | null {
  return FROZEN[slug]?.version ?? null
}

export function frozenMatchLine(slug: string): LatLng[] | null {
  const frozen = FROZEN[slug]
  return frozen ? frozen.matchLine.map(([lat, lng]) => [lat, lng] as LatLng) : null
}

export function frozenMapLines(slug: string): LatLng[][] | null {
  const frozen = FROZEN[slug]
  return frozen
    ? frozen.mapLines.map((line) => line.map(([lat, lng]) => [lat, lng] as LatLng))
    : null
}
