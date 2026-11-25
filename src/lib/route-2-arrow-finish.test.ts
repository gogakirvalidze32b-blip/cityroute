import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import {
  forwardBearingAlongRoute,
  matchGpsPosition,
  positionAtChainageMeters,
  prepareRouteGeometry,
  projectPointToRoute,
  type RouteMatchState,
} from '@/lib/pure-route-geometry'
import { stabilizeRoadArrowHeading } from '@/lib/route-nav'
import { resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'

/**
 * R2 finish loop (PIN 25 double-left → PIN 26): arrow must follow the sequential
 * return pass, not the early nearest lat/lng occurrence (~0.5 km outbound).
 * Audio / 300 m trigger logic is intentionally out of scope here.
 */
describe('route-2 arrow finish corridor (PIN 25→26)', () => {
  const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')
  if (!route) throw new Error('route-2 missing')

  const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
  const geometry = prepareRouteGeometry('route-2', examRouteLine('route-2', pins))
  const pin25 = pins.find((pin) => pin.sort_order === 25)!
  const pin26 = pins.find((pin) => pin.sort_order === 26)!

  function pointAt(chainageMeters: number): [number, number] {
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

  it('PIN 25 has an early nearest occurrence far behind the sequential finish pass', () => {
    const sequential25 = resolveDemoPinChainage(geometry, pins, 25, 0)
    const sequential26 = resolveDemoPinChainage(geometry, pins, 26, sequential25 ?? 0)
    const nearest25 = projectPointToRoute(geometry, [pin25.lat, pin25.lng])
    expect(sequential25).not.toBeNull()
    expect(sequential26).not.toBeNull()
    expect(nearest25).not.toBeNull()
    expect(sequential25!).toBeGreaterThan(8000)
    expect(nearest25!.chainageMeters).toBeLessThan(1500)
    expect(sequential25! - nearest25!.chainageMeters).toBeGreaterThan(5000)
    // First-fix lock must not use nearest25 — that freezes the arrow on the outbound pass.
    expect(Math.abs(nearest25!.segmentBearingDegrees - 26)).toBeLessThan(15)
    void pin26
  })

  it('keeps match/arrow on the finish pass when lit PIN uses sequential chainage', () => {
    const ch25 = resolveDemoPinChainage(geometry, pins, 25, 0)!
    const ch26 = resolveDemoPinChainage(geometry, pins, 26, ch25)!
    const start = Math.max(0, ch25 - 120)

    let previous: RouteMatchState | null = null
    let lastChainage = start
    let sawPostTurnBearing = false

    for (let step = 0; step <= 18; step++) {
      const chainage = start + step * 20
      const raw = pointAt(chainage)
      let expectedForward = ch26
      if (previous && expectedForward <= previous.chainageMeters + 5) {
        expectedForward = Math.min(geometry.totalLengthMeters, previous.chainageMeters + 80)
      }
      const match = matchGpsPosition(
        geometry,
        {
          position: raw,
          accuracyMeters: 8,
          timestampMs: 1_000 + step * 400,
          headingDegrees: null,
        },
        previous,
        {
          nowMs: 1_010 + step * 400,
          maxCrossTrackMeters: 80,
          expectedChainageMeters: previous ? undefined : ch25,
          expectedChainageWindowMeters: previous ? undefined : 160,
          expectedForwardChainageMeters: expectedForward,
        },
      )
      expect(match.accepted).toBe(true)
      expect(match.projection).not.toBeNull()
      // Never teleport back onto the early outbound occurrence.
      expect(match.projection!.chainageMeters).toBeGreaterThan(ch25 - 200)
      if (previous) {
        expect(match.projection!.chainageMeters).toBeGreaterThan(previous.chainageMeters - 40)
      }
      const bearing = match.projection!.segmentBearingDegrees
      if (bearing > 180 && bearing < 250) sawPostTurnBearing = true
      previous = match.nextState
      lastChainage = match.projection!.chainageMeters
    }

    expect(lastChainage).toBeGreaterThan(ch25)
    expect(sawPostTurnBearing).toBe(true)
  })

  it('Maps-style local crawl waits out the bend — no 26°↔206° jump/back', () => {
    const ch25 = resolveDemoPinChainage(geometry, pins, 25, 0)!
    let displayCh = ch25 - 20
    let heading = 26
    let maxStep = 0

    for (let step = 0; step <= 28; step++) {
      const trueCh = ch25 - 20 + step * 8
      // Match may teleport +140 m past the bend; display must ignore that.
      const matchCh = step >= 10 && step <= 20 ? trueCh + 140 : trueCh
      void matchCh
      const localCh = trueCh
      if (localCh >= displayCh - 5) {
        displayCh = Math.max(displayCh, Math.min(localCh, displayCh + 15))
      }
      const target = forwardBearingAlongRoute(geometry, displayCh, 6) ?? heading
      const before = heading
      heading = stabilizeRoadArrowHeading(heading, target, 12, 4, false)
      const stepDeg = Math.abs(((heading - before + 540) % 360) - 180)
      if (stepDeg > maxStep) maxStep = stepDeg
    }

    expect(maxStep).toBeLessThanOrEqual(18.01)
    // After crawling through the bend, heading must have left the NE approach (~26°).
    expect(Math.abs(((heading - 26 + 540) % 360) - 180)).toBeGreaterThan(40)
    expect(positionAtChainageMeters(geometry, displayCh)).not.toBeNull()
  })
})
