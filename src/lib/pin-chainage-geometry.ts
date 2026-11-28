/**
 * Pure kilometre ⇄ coordinate maths for chainage-anchored PINs.
 *
 * The offset is stored in DEGREES (not metres): for two nearby latitudes the
 * subtraction `pin − base` is exact in IEEE-754 (Sterbenz lemma), so
 * `base + offset` reproduces the original PIN coordinate bit-for-bit. Existing
 * PIN locations therefore stay EXACTLY where they are.
 */
import type { LatLng } from '@/lib/gps'
import { positionAtChainageMeters, type PreparedRouteGeometry } from '@/lib/pure-route-geometry'

export type ChainageOffset = {
  readonly chainage_m: number
  readonly offset_lat_deg: number
  readonly offset_lng_deg: number
}

/** Real-world coordinate: route point at chainage + stored offset. */
export function coordinateFromChainage(
  geometry: PreparedRouteGeometry,
  entry: ChainageOffset,
): LatLng | null {
  const base = positionAtChainageMeters(geometry, entry.chainage_m)
  if (!base) return null
  return [base[0] + entry.offset_lat_deg, base[1] + entry.offset_lng_deg]
}

/** Offset (degrees) from the route point at `chainage` to `coordinate`. */
export function offsetFromChainage(
  geometry: PreparedRouteGeometry,
  chainage: number,
  coordinate: LatLng,
): { offset_lat_deg: number; offset_lng_deg: number } | null {
  const base = positionAtChainageMeters(geometry, chainage)
  if (!base) return null
  return { offset_lat_deg: coordinate[0] - base[0], offset_lng_deg: coordinate[1] - base[1] }
}

/** Approximate offset magnitude in metres (reporting only). */
export function offsetMeters(entry: Pick<ChainageOffset, 'offset_lat_deg' | 'offset_lng_deg'>, atLat: number): number {
  const north = entry.offset_lat_deg * 111_320
  const east = entry.offset_lng_deg * 111_320 * Math.cos((atLat * Math.PI) / 180)
  return Math.hypot(north, east)
}
