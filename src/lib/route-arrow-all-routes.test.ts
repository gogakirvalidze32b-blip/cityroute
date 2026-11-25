import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import {
  forwardBearingAlongRoute,
  matchGpsPosition,
  prepareRouteGeometry,
  type RouteMatchState,
} from '@/lib/pure-route-geometry'
import { stabilizeRoadArrowHeading, shortestHeadingTurnDegrees } from '@/lib/route-nav'

/** Same Maps-style arrow path as ExamDriveSession (look-ahead, no reverse+180). */
function arrowHeadingForMatch(
  geometry: ReturnType<typeof prepareRouteGeometry>,
  match: ReturnType<typeof matchGpsPosition>,
  previous: RouteMatchState | null,
  lookAheadM = 14,
): number | null {
  if (!match.accepted || !match.nextState) {
    // Mirror ExamDriveSession: ignore finish-loop projections before first lock.
    const chainage =
      previous?.chainageMeters ??
      (match.projection != null && match.projection.chainageMeters <= 150
        ? match.projection.chainageMeters
        : null)
    return chainage != null ? forwardBearingAlongRoute(geometry, chainage, lookAheadM) : null
  }
  return forwardBearingAlongRoute(geometry, match.nextState.chainageMeters, lookAheadM)
}

function pointAt(
  geometry: ReturnType<typeof prepareRouteGeometry>,
  chainageMeters: number,
): [number, number] {
  let remaining = Math.max(0, Math.min(chainageMeters, geometry.totalLengthMeters))
  for (let index = 0; index < geometry.coordinates.length - 1; index++) {
    const from = geometry.coordinates[index]
    const to = geometry.coordinates[index + 1]
    const segment = geometry.cumulativeMeters[index + 1] - geometry.cumulativeMeters[index]
    if (remaining <= segment || index === geometry.coordinates.length - 2) {
      const t = segment > 0 ? remaining / segment : 0
      return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
    }
    remaining -= segment
  }
  const last = geometry.coordinates[geometry.coordinates.length - 1]
  return [last[0], last[1]]
}

describe('Maps-style arrow forward on all routes', () => {
  it('does not use finish-loop projection for arrow before first accepted match', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const geometry = prepareRouteGeometry('route-2', examRouteLine('route-2', pins))
    const start = geometry.coordinates[0]
    // Nudge toward plaza noise that often nearest-hits the finish pass.
    const noisy: [number, number] = [start[0] + 0.00004, start[1] - 0.00004]
    const match = matchGpsPosition(
      geometry,
      { position: noisy, accuracyMeters: 8, timestampMs: 1_000, headingDegrees: null },
      null,
      {
        nowMs: 1_000,
        maxGpsAgeMs: 15_000,
        maxAccuracyMeters: 50,
        maxCrossTrackMeters: 40,
        maxSpeedMetersPerSecond: 55,
        stationaryThresholdMeters: 2,
        ambiguityToleranceMeters: 5,
        ambiguitySeparationMeters: 100,
      },
    )
    const startBearing = forwardBearingAlongRoute(geometry, 0, 14)!
    const target = arrowHeadingForMatch(geometry, match, null)
    if (target != null) {
      expect(Math.abs(shortestHeadingTurnDegrees(target, startBearing))).toBeLessThan(40)
    }
  })

  it.each(['route-1', 'route-2', 'route-3', 'route-4'] as const)(
    '%s: slewed arrow never jumps >12°/tick and stays within 90° of forward look-ahead',
    (slug) => {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const geometry = prepareRouteGeometry(slug, examRouteLine(slug, pins))
      let previous: RouteMatchState | null = null
      let heading = forwardBearingAlongRoute(geometry, 0, 14) ?? 0
      const stepM = 6
      let samples = 0

      for (let ch = 0; ch <= geometry.totalLengthMeters; ch += stepM) {
        const raw = pointAt(geometry, ch)
        const match = matchGpsPosition(
          geometry,
          {
            position: raw,
            accuracyMeters: 5,
            timestampMs: 1_000 + ch * 50,
            headingDegrees: null,
          },
          previous,
          {
            nowMs: 1_000 + ch * 50,
            maxGpsAgeMs: 15_000,
            maxAccuracyMeters: 50,
            maxCrossTrackMeters: 40,
            maxSpeedMetersPerSecond: 55,
            stationaryThresholdMeters: 2,
            ambiguityToleranceMeters: 5,
            ambiguitySeparationMeters: 100,
            expectedForwardChainageMeters: Math.min(geometry.totalLengthMeters, ch + 80),
          },
        )

        const target = arrowHeadingForMatch(geometry, match, previous)
        if (match.accepted && match.nextState) previous = match.nextState
        if (target == null) continue

        // Target must be forward look-ahead — never opposite of travel on the matched chainage.
        const truthCh = previous?.chainageMeters ?? match.projection?.chainageMeters ?? ch
        const truth = forwardBearingAlongRoute(geometry, truthCh, 14)
        if (truth != null) {
          expect(Math.abs(shortestHeadingTurnDegrees(target, truth))).toBeLessThan(1)
        }

        const next = stabilizeRoadArrowHeading(heading, target, 10, 5, false)
        const step = Math.abs(shortestHeadingTurnDegrees(heading, next))
        // Maps-style: adaptive slew (up to ~18° on large lag) — never a 180° flip.
        expect(step).toBeLessThanOrEqual(18.01)

        heading = next
        samples += 1
      }

      expect(samples).toBeGreaterThan(100)
    },
  )
})
