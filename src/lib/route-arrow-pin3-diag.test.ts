import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import { resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'
import {
  forwardBearingAlongRoute,
  matchGpsPosition,
  prepareRouteGeometry,
  type RouteMatchState,
} from '@/lib/pure-route-geometry'
import { decideChainageFromMatch } from '@/lib/route-chainage-progress'
import { shortestHeadingTurnDegrees, stabilizeRoadArrowHeading } from '@/lib/route-nav'

/**
 * R2 PIN3: rejecting a tick must NOT refresh the lock timestamp. If it does,
 * elapsed stays ~0, catch-up is impossible, heading freezes at ~205° (entry)
 * and looks like it turned back after the zig-zag.
 */
describe('R2 PIN3 post-turn match recovery', () => {
  it('catch-up adopt works once elapsed accumulates after a freeze', () => {
    // Frozen at PIN3, candidate 80 m ahead — rejected at 200 ms, adopted at 2 s.
    expect(
      decideChainageFromMatch({
        previousChainageMeters: 132,
        candidateChainageMeters: 212,
        matchAccepted: true,
        elapsedMs: 200,
        maxReverseMeters: 2,
      }).action,
    ).toBe('freeze')

    expect(
      decideChainageFromMatch({
        previousChainageMeters: 132,
        candidateChainageMeters: 212,
        matchAccepted: true,
        elapsedMs: 2_000,
        maxReverseMeters: 2,
      }),
    ).toEqual({ action: 'adopt', chainageMeters: 212 })
  })

  it('rejects re-entry onto the zig-zag entry leg (no post-turn reverse)', () => {
    // Past corridor (~180 m) then ambiguous snap back to entry (~150 m).
    expect(
      decideChainageFromMatch({
        previousChainageMeters: 180,
        candidateChainageMeters: 150,
        matchAccepted: true,
        elapsedMs: 500,
        maxReverseMeters: 2,
      }),
    ).toEqual({ action: 'freeze', chainageMeters: 180, reason: 'implausible-jump' })
  })

  it('matchGpsPosition reacquires when lock timestamp is NOT refreshed on gaps', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === 'route-2')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const geometry = prepareRouteGeometry('route-2', examRouteLine('route-2', pins))
    const pin3Ch = resolveDemoPinChainage(geometry, pins, 3, 0) ?? 132
    const entryBearing = forwardBearingAlongRoute(geometry, pin3Ch, 20)!

    const posAt = (ch: number) => {
      let remaining = Math.max(0, Math.min(ch, geometry.totalLengthMeters))
      for (let i = 0; i < geometry.coordinates.length - 1; i++) {
        const seg =
          geometry.cumulativeMeters[i + 1] - geometry.cumulativeMeters[i]
        if (remaining <= seg || i === geometry.coordinates.length - 2) {
          const t = seg > 0 ? remaining / seg : 0
          const a = geometry.coordinates[i]
          const b = geometry.coordinates[i + 1]
          return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] as [number, number]
        }
        remaining -= seg
      }
      const last = geometry.coordinates[geometry.coordinates.length - 1]
      return [last[0], last[1]] as [number, number]
    }

    const lockPos = posAt(pin3Ch)
    const previous: RouteMatchState = {
      routeId: geometry.routeId,
      chainageMeters: pin3Ch,
      segmentIndex: Math.max(
        0,
        geometry.cumulativeMeters.findIndex(
          (chainage, index) =>
            index < geometry.cumulativeMeters.length - 1 &&
            chainage <= pin3Ch &&
            pin3Ch <= geometry.cumulativeMeters[index + 1]!,
        ),
      ),
      position: lockPos,
      timestampMs: 1_000,
      accuracyMeters: 8,
    }

    // Stale lock + GPS already past the zig-zag (~+120 m). Tiny elapsed → reject.
    const ahead = posAt(pin3Ch + 120)
    const tight = matchGpsPosition(
      geometry,
      { position: ahead, accuracyMeters: 8, timestampMs: 1_200, headingDegrees: null },
      previous,
      {
        nowMs: 1_200,
        maxGpsAgeMs: 15_000,
        maxAccuracyMeters: 50,
        maxCrossTrackMeters: 40,
        maxSpeedMetersPerSecond: 55,
        stationaryThresholdMeters: 2,
        ambiguityToleranceMeters: 5,
        ambiguitySeparationMeters: 100,
      },
    )
    expect(tight.accepted).toBe(false)

    // Same gap but lock timestamp left alone (elapsed ~3 s) → reacquire.
    const recovered = matchGpsPosition(
      geometry,
      { position: ahead, accuracyMeters: 8, timestampMs: 4_000, headingDegrees: null },
      previous,
      {
        nowMs: 4_000,
        maxGpsAgeMs: 15_000,
        maxAccuracyMeters: 50,
        maxCrossTrackMeters: 40,
        maxSpeedMetersPerSecond: 55,
        stationaryThresholdMeters: 2,
        ambiguityToleranceMeters: 5,
        ambiguitySeparationMeters: 100,
      },
    )
    expect(recovered.accepted).toBe(true)
    expect(recovered.nextState!.chainageMeters).toBeGreaterThan(pin3Ch + 80)

    // Heading can leave the entry bearing once chainage advances past the corridor.
    let heading = entryBearing
    for (let ch = pin3Ch; ch <= pin3Ch + 80; ch += 4) {
      const target = forwardBearingAlongRoute(geometry, ch, 20)!
      heading = stabilizeRoadArrowHeading(heading, target, 10, 5, false)
    }
    expect(Math.abs(shortestHeadingTurnDegrees(heading, entryBearing))).toBeGreaterThan(90)
  })
})
