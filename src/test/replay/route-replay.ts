/**
 * GPS replay helpers (test-only).
 *
 * Builds deterministic synthetic GPS traces along an exam route line so the
 * real ExamDriveSession pipeline (GPS filter → route match → PIN trigger →
 * audio queue) can be replayed in vitest. Recorded field traces (see
 * gps-trace-recorder.ts) use the same `GpsPosition` shape and can be replayed
 * through the same runner.
 */
import type { GpsPosition } from '@/lib/gps'
import {
  positionAtChainageMeters,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'

export type TraceOutage = {
  /** Route chainage (m) where GPS stops reporting. */
  readonly fromChainageMeters: number
  /** Route chainage (m) where GPS reports again. */
  readonly toChainageMeters: number
}

export type TraceOptions = {
  readonly speedMps: number
  readonly intervalMs: number
  /** Gaussian-like positional noise (m, ~1 sigma). 0 = exact road centreline. */
  readonly jitterMeters?: number
  readonly seed?: number
  readonly accuracyMeters?: number
  readonly startChainageMeters?: number
  readonly endChainageMeters?: number
  readonly outages?: readonly TraceOutage[]
  /** Stationary fixes (speed 0) at the start chainage before driving, like a car idling at the agency. */
  readonly startDwellFixes?: number
  /** Pull away gently: the first N metres at 4 m/s with 1 fix/s before the configured speed/interval. */
  readonly slowStartMeters?: number
  readonly startTimestampMs: number
}

export type TraceFix = GpsPosition & {
  /** Ground-truth chainage the synthetic vehicle was at (test bookkeeping only). */
  readonly truthChainageMeters: number
}

/** Deterministic PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rng: () => number): number {
  const u = Math.max(1e-12, rng())
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function bearingDegrees(from: readonly [number, number], to: readonly [number, number]): number {
  const toRad = Math.PI / 180
  const lat1 = from[0] * toRad
  const lat2 = to[0] * toRad
  const dLng = (to[1] - from[1]) * toRad
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) / toRad) + 360) % 360
}

const M_PER_DEG_LAT = 111_320

export function synthesizeTrace(
  geometry: PreparedRouteGeometry,
  options: TraceOptions,
): TraceFix[] {
  const rng = createRng(options.seed ?? 1)
  const start = Math.max(0, options.startChainageMeters ?? 0)
  const end = Math.min(geometry.totalLengthMeters, options.endChainageMeters ?? geometry.totalLengthMeters)
  const step = options.speedMps * (options.intervalMs / 1000)
  const fixes: TraceFix[] = []
  let timestamp = options.startTimestampMs
  const dwellAt = positionAtChainageMeters(geometry, start)
  const dwellAhead = positionAtChainageMeters(geometry, Math.min(geometry.totalLengthMeters, start + 5))
  for (let index = 0; dwellAt && dwellAhead && index < (options.startDwellFixes ?? 0); index += 1) {
    timestamp += options.intervalMs
    fixes.push({
      lat: dwellAt[0],
      lng: dwellAt[1],
      accuracy: options.accuracyMeters ?? 5,
      heading: bearingDegrees(dwellAt, dwellAhead),
      speed: 0,
      timestamp,
      truthChainageMeters: start,
    })
  }
  const slowUntil = start + (options.slowStartMeters ?? 0)
  for (let s = start; s <= end + 1e-6; s += s < slowUntil ? 4 : step) {
    timestamp += s < slowUntil ? 1000 : options.intervalMs
    const inOutage = (options.outages ?? []).some(
      (outage) => s >= outage.fromChainageMeters && s < outage.toChainageMeters,
    )
    if (inOutage) continue
    const at = positionAtChainageMeters(geometry, s)
    const ahead = positionAtChainageMeters(geometry, Math.min(geometry.totalLengthMeters, s + 5))
    if (!at || !ahead) continue
    const jitter = options.jitterMeters ?? 0
    const northM = jitter > 0 ? gaussian(rng) * jitter : 0
    const eastM = jitter > 0 ? gaussian(rng) * jitter : 0
    const lat = at[0] + northM / M_PER_DEG_LAT
    const lng = at[1] + eastM / (M_PER_DEG_LAT * Math.cos((at[0] * Math.PI) / 180))
    fixes.push({
      lat,
      lng,
      accuracy: options.accuracyMeters ?? 5,
      heading: bearingDegrees(at, ahead),
      speed: s < slowUntil ? 4 : options.speedMps,
      timestamp,
      truthChainageMeters: s,
    })
  }
  return fixes
}
