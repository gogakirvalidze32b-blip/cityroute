import type { LatLng } from '@/lib/gps'
import { SPEED_ZONES, type SpeedZone } from '@/data/speed-limits'

const M_PER_DEG_LAT = 110_540
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

/** A point beyond the end of a stretch (along the line) only counts if it is this close to the end. */
const END_TOLERANCE_M = 5
/** Two zones this close in distance, with different limits, cannot be told apart. */
const AMBIGUOUS_DELTA_M = 1
/** When matching with a known along-road position, allow this much u slack past the zone ends. */
const ROAD_U_SLACK = 0.35
/** Monotonic snap: how far back/forward (in segments) to search from the previous u. */
const PROGRESS_LOOKBACK = 3
const PROGRESS_LOOKAHEAD = 24
/** Reject a backward u jump larger than this many segment units (GPS noise only). */
const PROGRESS_BACK_TOLERANCE_U = 1

function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/** Distance (m) from `point` to the segment a→b, plus the unclamped projection parameter along it. */
function toSegment(point: LatLng, a: LatLng, b: LatLng) {
  const kx = mPerDegLng(a[0])
  const bx = (b[1] - a[1]) * kx
  const by = (b[0] - a[0]) * M_PER_DEG_LAT
  const px = (point[1] - a[1]) * kx
  const py = (point[0] - a[0]) * M_PER_DEG_LAT
  const len2 = bx * bx + by * by
  const raw = len2 === 0 ? 0 : (px * bx + py * by) / len2
  const t = Math.max(0, Math.min(1, raw))
  return { d: Math.hypot(px - bx * t, py - by * t), raw }
}

/**
 * Distance (m) from `point` to the part of `road` between positions `from` and `to`
 * (u = vertex index + fraction). `beyondEnd` is true when the closest point is a clipped end of the span
 * and the point lies past it, i.e. the vehicle is outside the stretch along the line.
 */
export function distanceToSpanM(point: LatLng, road: readonly LatLng[], from: number, to: number) {
  const first = Math.max(0, Math.floor(from))
  const last = Math.min(Math.ceil(to) - 1, road.length - 2)
  let best = { d: Infinity, beyondEnd: false }
  let firstUsed = -1
  let lastUsed = -1
  for (let i = first; i <= last; i += 1) {
    if (Math.min(to - i, 1) > Math.max(from - i, 0)) {
      if (firstUsed < 0) firstUsed = i
      lastUsed = i
    }
  }
  for (let i = firstUsed; i >= 0 && i <= lastUsed; i += 1) {
    const start = lerp(road[i], road[i + 1], Math.max(from - i, 0))
    const end = lerp(road[i], road[i + 1], Math.min(to - i, 1))
    const { d, raw } = toSegment(point, start, end)
    if (d < best.d) {
      best = { d, beyondEnd: (i === firstUsed && raw < 0) || (i === lastUsed && raw > 1) }
    }
  }
  return best
}

/** The coordinate at road position `u` (vertex index + fraction). */
export function roadPointAt(road: readonly LatLng[], u: number): LatLng {
  const i = Math.min(Math.max(Math.floor(u), 0), road.length - 2)
  return lerp(road[i], road[i + 1], u - i)
}

/**
 * Along-road position `u` for `position`, locked to the current pass when `prevU` is set.
 * Uses the same road array as the speed zones (exam street trace), not the OSRM polyline.
 */
export function advanceRoadProgressU(
  position: LatLng,
  road: readonly LatLng[],
  prevU: number | null | undefined,
): number {
  if (road.length < 2) return 0
  const hasPrev = prevU != null && Number.isFinite(prevU)
  const prevSeg = hasPrev ? Math.floor(prevU as number) : undefined
  const searchStart = prevSeg !== undefined ? Math.max(0, prevSeg - PROGRESS_LOOKBACK) : 0
  const searchEnd =
    prevSeg !== undefined ? Math.min(road.length - 2, prevSeg + PROGRESS_LOOKAHEAD) : road.length - 2

  let bestU = 0
  let bestD = Infinity
  const nearStartEnd: { u: number; d: number }[] = []
  for (let i = searchStart; i <= searchEnd; i += 1) {
    const { d, raw } = toSegment(position, road[i], road[i + 1])
    const t = Math.max(0, Math.min(1, raw))
    const u = i + t
    if (d < bestD) {
      bestD = d
      bestU = u
    }
    // Loop start/end only matter on the first fix (full-road search).
    if (!hasPrev && (u < 2 || u > road.length - 3)) nearStartEnd.push({ u, d })
  }

  // Closed loops share the start plaza with the last vertices. The nearest point is often
  // the END; without prior progress that locks the driver there and every later forward
  // GPS step is rejected as a backward jump (pin #1 ≈ end, pin #2 ≈ 3).
  if (!hasPrev) {
    const atStart = nearStartEnd.filter((c) => c.u < 2 && c.d <= bestD + 5)
    const atEnd = nearStartEnd.filter((c) => c.u > road.length - 3 && c.d <= bestD + 5)
    if (atStart.length > 0 && atEnd.length > 0) {
      bestU = atStart.reduce((min, c) => (c.u < min ? c.u : min), atStart[0].u)
    }
  }

  if (hasPrev && bestU < (prevU as number) - PROGRESS_BACK_TOLERANCE_U) {
    return prevU as number
  }
  return bestU
}

function zoneContainsU(zone: SpeedZone, roadU: number): boolean {
  return roadU >= zone.from - ROAD_U_SLACK && roadU <= zone.to + ROAD_U_SLACK
}

/**
 * True when `position` also lies equally close to another part of the road outside `zone`.
 * Without along-road progress that means the limit for this pass cannot be known.
 */
function revisitAmbiguous(
  position: LatLng,
  road: readonly LatLng[],
  zone: SpeedZone,
  offsetM: number,
  zones: readonly SpeedZone[],
): boolean {
  const threshold = offsetM + AMBIGUOUS_DELTA_M
  for (let i = 0; i < road.length - 1; i += 1) {
    const { d, raw } = toSegment(position, road[i], road[i + 1])
    if (d > threshold) continue
    const u = i + Math.max(0, Math.min(1, raw))
    if (zoneContainsU(zone, u)) continue
    const other = zones.find((z) => z.to <= road.length - 1 && zoneContainsU(z, u))
    if (!other || other.limitKmh !== zone.limitKmh) return true
  }
  return false
}

export type SpeedZoneMatch = { zone: SpeedZone; offsetM: number }

/**
 * The zone the vehicle is in, decided by its real position relative to the route's road line.
 * When `roadU` is provided (progress along the same road), only zones covering that pass count —
 * required where the route revisits the same street. Returns null when the position is not inside
 * any zone, or when two different limits fit equally well — a limit is never guessed.
 */
export function resolveSpeedZone(
  slug: string,
  position: LatLng | null | undefined,
  road: readonly LatLng[] | null | undefined,
  roadU?: number | null,
): SpeedZoneMatch | null {
  const zones = SPEED_ZONES[slug]
  if (!zones || !road || road.length < 2 || !position) return null
  if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) return null

  const hasU = roadU != null && Number.isFinite(roadU)
  const hits: SpeedZoneMatch[] = []
  for (const zone of zones) {
    if (zone.to > road.length - 1) continue
    if (hasU && !zoneContainsU(zone, roadU as number)) continue
    const { d, beyondEnd } = distanceToSpanM(position, road, zone.from, zone.to)
    if (d > zone.maxOffsetM) continue
    if (beyondEnd && d > END_TOLERANCE_M) continue
    hits.push({ zone, offsetM: d })
  }
  if (hits.length === 0) return null
  hits.sort((a, b) => a.offsetM - b.offsetM)
  const [best, next] = hits
  if (next && next.zone.limitKmh !== best.zone.limitKmh && next.offsetM - best.offsetM < AMBIGUOUS_DELTA_M) {
    return null
  }
  if (!hasU && revisitAmbiguous(position, road, best.zone, best.offsetM, zones)) {
    return null
  }
  return best
}

/** Posted limit (km/h) at the vehicle's position, or null when it cannot be determined. */
export function resolveSpeedLimit(
  slug: string,
  position: LatLng | null | undefined,
  road: readonly LatLng[] | null | undefined,
  roadU?: number | null,
): number | null {
  return resolveSpeedZone(slug, position, road, roadU)?.zone.limitKmh ?? null
}
