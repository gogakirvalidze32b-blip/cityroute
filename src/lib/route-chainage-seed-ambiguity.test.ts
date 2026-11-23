import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import { resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'
import {
  prepareRouteGeometry,
  positionAtChainageMeters,
  projectPointToRoute,
  projectPointToRouteNearChainage,
} from '@/lib/pure-route-geometry'
import {
  decideChainageFromMatch,
  resolveGpsSeedChainageMeters,
} from '@/lib/route-chainage-progress'
import { distanceKmTenths } from '@/lib/route-odometer'

function loadRoute(slug: string) {
  const route = TELAVI_ROUTES_FALLBACK.find((row) => row.slug === slug)
  if (!route) throw new Error(`missing ${slug}`)
  const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
  const geometry = prepareRouteGeometry(slug, examRouteLine(slug, pins))
  return { route, pins, geometry }
}

function seedAtChainage(
  slug: string,
  chainageMeters: number,
  nextPinOrder: number,
) {
  const { pins, geometry } = loadRoute(slug)
  const position = positionAtChainageMeters(geometry, chainageMeters)
  if (!position) throw new Error('no position')
  const prior = [...pins]
    .map((pin) => pin.sort_order)
    .filter((order) => order < nextPinOrder)
    .sort((a, b) => b - a)[0]
  const after =
    prior !== undefined ? resolveDemoPinChainage(geometry, pins, prior, 0) ?? 0 : 0
  const exactPin = resolveDemoPinChainage(geometry, pins, nextPinOrder, after)
  const pin = pins.find((row) => row.sort_order === nextPinOrder)!
  const nearest = projectPointToRoute(geometry, position)
  const pinAnchored =
    exactPin != null
      ? projectPointToRouteNearChainage(geometry, position, exactPin, 150)
      : null
  const hintAnchored = projectPointToRouteNearChainage(
    geometry,
    position,
    chainageMeters,
    80,
  )
  const distToPin = Math.hypot(
    (position[0] - pin.lat) * 111_320,
    (position[1] - pin.lng) * 111_320 * Math.cos((position[0] * Math.PI) / 180),
  )
  return resolveGpsSeedChainageMeters({
    nearest: nearest
      ? {
          chainageMeters: nearest.chainageMeters,
          crossTrackMeters: nearest.crossTrackMeters,
        }
      : null,
    pinAnchored: pinAnchored
      ? {
          chainageMeters: pinAnchored.chainageMeters,
          crossTrackMeters: pinAnchored.crossTrackMeters,
        }
      : null,
    hintAnchored: hintAnchored
      ? {
          chainageMeters: hintAnchored.chainageMeters,
          crossTrackMeters: hintAnchored.crossTrackMeters,
        }
      : null,
    exactPinChainageMeters: exactPin,
    distanceToPinMeters: distToPin,
    hintChainageMeters: chainageMeters,
  })
}

describe('route chainage seed ambiguity (real geometry)', () => {
  it('Route 1 at 2.25 km seeds ~2250 m, not PIN12 approach ~2572 m', () => {
    const decision = seedAtChainage('route-1', 2_250, 12)
    expect(decision.chainageMeters).toBeGreaterThan(2_200)
    expect(decision.chainageMeters).toBeLessThan(2_300)
    // HUD tenths must not show the false 2.6 km (PIN12−120 m pull)
    expect(distanceKmTenths(decision.chainageMeters)).toBeLessThan(2.5)
    expect(distanceKmTenths(decision.chainageMeters)).not.toBe(2.6)
  })

  it('Route 1 near PIN12 approach (~2572 m) keeps approach chainage', () => {
    const { pins, geometry } = loadRoute('route-1')
    const pin12 = resolveDemoPinChainage(
      geometry,
      pins,
      12,
      resolveDemoPinChainage(geometry, pins, 11, 0) ?? 0,
    )!
    const approach = pin12 - 120
    const decision = seedAtChainage('route-1', approach, 12)
    expect(decision.chainageMeters).toBeGreaterThan(approach - 5)
    expect(decision.chainageMeters).toBeLessThan(approach + 5)
  })

  it('live match freezes an ambiguous forward pull after a valid 2.25 km lock', () => {
    expect(
      decideChainageFromMatch({
        previousChainageMeters: 2_250,
        candidateChainageMeters: 2_572,
        matchAccepted: true,
        elapsedMs: 500,
      }),
    ).toEqual({
      action: 'freeze',
      chainageMeters: 2_250,
      reason: 'implausible-jump',
    })
  })

  it('Route 2 / Route 4 km-seek seeds stay near the requested chainage', () => {
    for (const [slug, meters, nextPin] of [
      ['route-2', 2_250, 12],
      ['route-2', 4_450, 20],
      ['route-4', 2_250, 12],
      ['route-4', 2_750, 14],
      ['route-4', 4_450, 20],
    ] as const) {
      const decision = seedAtChainage(slug, meters, nextPin)
      expect(
        Math.abs(decision.chainageMeters - meters),
        `${slug} @ ${meters}`,
      ).toBeLessThan(40)
    }
  })
})
