import { describe, expect, it } from 'vitest'
import { ROUTE_POLYLINES } from '@/data/route-polylines'
import auditedPins from '@/data/audio-audit-pins.fixture.json'
import route3Road from '@/data/route-3-road.json'
import {
  ACTIVE_ROUTE_IDS,
  evaluatePinRouteCompletion,
  findNearestSegment,
  matchGpsPosition,
  prepareRouteGeometry,
  projectOrderedPointsToRoute,
  projectPointToRoute,
  type ActiveRouteId,
  type LatLng,
  type RouteMatchState,
} from './pure-route-geometry'

const straightRoute = prepareRouteGeometry('route-1', [
  [41.9, 45.5],
  [41.9, 45.51],
])

function makeState(chainageMeters: number, timestampMs = 1_000): RouteMatchState {
  return {
    routeId: 'route-1',
    chainageMeters,
    segmentIndex: 0,
    position: [41.9, 45.5],
    timestampMs,
    accuracyMeters: 3,
  }
}

describe('pure route geometry', () => {
  it('prepares cumulative metric chainage in coordinate order', () => {
    const route = prepareRouteGeometry('route-1', [
      [41.9, 45.5],
      [41.9, 45.501],
      [41.901, 45.501],
    ])

    expect(route.cumulativeMeters[0]).toBe(0)
    expect(route.cumulativeMeters[1]).toBeGreaterThan(80)
    expect(route.cumulativeMeters[2]).toBeGreaterThan(route.cumulativeMeters[1])
    expect(route.totalLengthMeters).toBe(route.cumulativeMeters[2])
  })

  it('rejects invalid and zero-length geometries', () => {
    expect(() => prepareRouteGeometry('route-1', [[41.9, 45.5]])).toThrow(RangeError)
    expect(() => prepareRouteGeometry('route-1', [[41.9, 45.5], [41.9, 45.5]])).toThrow(RangeError)
    expect(() =>
      prepareRouteGeometry('route-1', [[91, 45.5], [41.9, 45.5]]),
    ).toThrow(RangeError)
  })

  it('projects a point onto the closest segment and reports cross-track distance', () => {
    const point: LatLng = [41.9005, 45.505]
    const projection = projectPointToRoute(straightRoute, point)

    expect(projection).not.toBeNull()
    expect(projection?.segmentIndex).toBe(0)
    expect(projection?.segmentFraction).toBeCloseTo(0.5, 2)
    expect(projection?.chainageMeters).toBeCloseTo(straightRoute.totalLengthMeters / 2, 0)
    expect(projection?.crossTrackMeters).toBeGreaterThan(50)
    expect(projection?.crossTrackMeters).toBeLessThan(60)
    expect(findNearestSegment(straightRoute, [NaN, 45.5])).toBeNull()
  })

  it('finds the nearest segment on a multi-segment route', () => {
    const route = prepareRouteGeometry('route-2', [
      [41.9, 45.5],
      [41.9, 45.501],
      [41.901, 45.501],
    ])
    const projection = findNearestSegment(route, [41.9005, 45.50102])

    expect(projection?.segmentIndex).toBe(1)
    expect(projection?.crossTrackMeters).toBeLessThan(3)
  })

  it('classifies forward, reverse, stationary, and initial direction', () => {
    const start = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.501], accuracyMeters: 3, timestampMs: 30_000 },
      makeState(0),
      { nowMs: 30_000 },
    )
    expect(start.status).toBe('matched')
    expect(start.direction).toBe('forward')

    const reverse = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.5], accuracyMeters: 3, timestampMs: 50_000 },
      makeState(straightRoute.totalLengthMeters, 30_000),
      { nowMs: 50_000 },
    )
    expect(reverse.direction).toBe('reverse')

    const stationary = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.5], accuracyMeters: 3, timestampMs: 2_000 },
      makeState(0),
      { nowMs: 2_000 },
    )
    expect(stationary.direction).toBe('stationary')

    const initial = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.5], accuracyMeters: 3, timestampMs: 2_000 },
      null,
      { nowMs: 2_000 },
    )
    expect(initial.direction).toBe('unknown')
  })

  it.each([
    ['invalid-fix', { position: [91, 45.5] as LatLng, accuracyMeters: 2, timestampMs: 1_000 }, 1_000],
    ['poor-accuracy', { position: [41.9, 45.5] as LatLng, accuracyMeters: 80, timestampMs: 1_000 }, 1_000],
    ['stale-fix', { position: [41.9, 45.5] as LatLng, accuracyMeters: 2, timestampMs: 1_000 }, 20_000],
    ['future-fix', { position: [41.9, 45.5] as LatLng, accuracyMeters: 2, timestampMs: 5_000 }, 1_000],
  ] as const)('rejects unreliable GPS as %s', (expectedStatus, fix, nowMs) => {
    const result = matchGpsPosition(straightRoute, fix, null, { nowMs })
    expect(result.status).toBe(expectedStatus)
    expect(result.accepted).toBe(false)
  })

  it('rejects out-of-order fixes and implausible chainage jumps', () => {
    const outOfOrder = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.501], accuracyMeters: 3, timestampMs: 900 },
      makeState(0, 1_000),
      { nowMs: 1_000 },
    )
    expect(outOfOrder.status).toBe('out-of-order-fix')

    const jump = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.509], accuracyMeters: 3, timestampMs: 1_100 },
      makeState(0, 1_000),
      { nowMs: 1_100, maxSpeedMetersPerSecond: 10 },
    )
    expect(jump.status).toBe('gps-jump')
    expect(jump.accepted).toBe(false)
  })

  it('does not use match state from a different route', () => {
    const result = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.501], accuracyMeters: 3, timestampMs: 2_000 },
      { ...makeState(0), routeId: 'route-2' },
      { nowMs: 2_000 },
    )
    expect(result.status).toBe('route-mismatch')
    expect(result.accepted).toBe(false)
  })

  it('reports off-route fixes without accepting them', () => {
    const result = matchGpsPosition(
      straightRoute,
      { position: [41.91, 45.505], accuracyMeters: 3, timestampMs: 1_000 },
      null,
      { nowMs: 1_000, maxCrossTrackMeters: 20 },
    )
    expect(result.status).toBe('off-route')
    expect(result.projection).not.toBeNull()
    expect(result.accepted).toBe(false)
  })

  it('flags an ambiguous loop crossing without prior match context', () => {
    const loop = prepareRouteGeometry('route-3', [
      [41.9, 45.5],
      [41.9, 45.501],
      [41.901, 45.501],
      [41.901, 45.5],
      [41.9, 45.5],
    ])
    const ambiguous = matchGpsPosition(
      loop,
      { position: [41.9, 45.5], accuracyMeters: 2, timestampMs: 10_000 },
      null,
      { nowMs: 10_000 },
    )
    expect(ambiguous.status).toBe('ambiguous-route-match')
    expect(ambiguous.accepted).toBe(false)
  })

  it('uses a nearby sequential PIN as initial route context without bypassing movement checks', () => {
    const loop = prepareRouteGeometry('route-3', [
      [41.9, 45.5],
      [41.9, 45.501],
      [41.901, 45.501],
      [41.901, 45.5],
      [41.9, 45.5],
    ])
    const anchored = matchGpsPosition(
      loop,
      { position: [41.9, 45.5], accuracyMeters: 2, timestampMs: 10_000 },
      null,
      { nowMs: 10_000, expectedChainageMeters: 0 },
    )

    expect(anchored.status).toBe('matched')
    expect(anchored.direction).toBe('unknown')
    expect(anchored.projection?.chainageMeters).toBeLessThan(40)

    const next = matchGpsPosition(
      loop,
      { position: [41.9, 45.5001], accuracyMeters: 2, timestampMs: 12_000 },
      anchored.nextState,
      { nowMs: 12_000 },
    )
    expect(next.status).toBe('matched')
    expect(next.direction).toBe('forward')
  })

  it('uses Route 3 PIN order to select the later occurrence on its repeated road trace', () => {
    const route = prepareRouteGeometry(
      'route-3',
      route3Road.map(([lat, lng]) => [lat, lng] as const),
    )
    const pinPosition = (order: number): LatLng => {
      const pin = auditedPins.find((item) => item.route === 3 && item.pin === order)!
      return [pin.lat, pin.lng]
    }
    const nearestOccurrence = projectPointToRoute(route, pinPosition(13))
    const orderedOccurrence = projectOrderedPointsToRoute(route, [
      pinPosition(10),
      pinPosition(11),
      pinPosition(13),
    ])

    expect(nearestOccurrence).not.toBeNull()
    expect(orderedOccurrence).not.toBeNull()
    expect(orderedOccurrence!.chainageMeters).toBeGreaterThan(6_000)
    expect(orderedOccurrence!.chainageMeters - nearestOccurrence!.chainageMeters).toBeGreaterThan(300)
    expect(orderedOccurrence!.crossTrackMeters).toBeLessThan(10)
  })

  it('uses forward PIN sequence and GPS heading to resolve an opposing repeated segment', () => {
    const route = prepareRouteGeometry(
      'route-3',
      route3Road.map(([lat, lng]) => [lat, lng] as const),
    )
    const previous: RouteMatchState = {
      routeId: 'route-3',
      chainageMeters: 5_994,
      segmentIndex: 247,
      position: route.coordinates[247],
      timestampMs: 1_000,
      accuracyMeters: 3,
    }
    const fix = {
      position: route.coordinates[257],
      accuracyMeters: 3,
      timestampMs: 11_000,
      headingDegrees: 72,
    }

    expect(matchGpsPosition(route, fix, previous, { nowMs: 11_000 }).status)
      .toBe('ambiguous-route-match')
    const result = matchGpsPosition(route, fix, previous, {
      nowMs: 11_000,
      expectedForwardChainageMeters: 6_232,
    })
    expect(result.status).toBe('matched')
    expect(result.direction).toBe('forward')
    expect(result.projection?.chainageMeters).toBeGreaterThan(6_000)
    expect(matchGpsPosition(
      route,
      { ...fix, headingDegrees: 252 },
      previous,
      { nowMs: 11_000, expectedForwardChainageMeters: 6_232 },
    ).status).toBe('ambiguous-route-match')
  })

  it('uses recent chainage context to disambiguate a repeated location', () => {
    const loop = prepareRouteGeometry('route-4', [
      [41.9, 45.5],
      [41.9, 45.501],
      [41.901, 45.501],
      [41.901, 45.5],
      [41.9, 45.5],
    ])
    const result = matchGpsPosition(
      loop,
      { position: [41.9, 45.5], accuracyMeters: 2, timestampMs: 11_000 },
      { ...makeState(0, 10_000), routeId: 'route-4' },
      { nowMs: 11_000 },
    )
    expect(result.status).toBe('matched')
    expect(result.projection?.chainageMeters).toBeLessThan(100)
  })

  it('requires a real forward route movement before a PIN becomes ready', () => {
    const previous = makeState(350, 1_000)
    const projection = projectPointToRoute(straightRoute, [41.9, 45.5045])
    if (!projection) throw new Error('expected forward projection')
    const match = {
      status: 'matched' as const,
      accepted: true,
      projection,
      direction: 'forward' as const,
      nextState: { ...makeState(projection.chainageMeters, 2_000), accuracyMeters: 3 },
    }
    const result = evaluatePinRouteCompletion(
      straightRoute,
      [41.9, 45.505],
      match,
      previous,
      { maxAccuracyMeters: 12, maxPinCrossTrackMeters: 20, approachWindowMeters: 50 },
    )
    expect(result.ready).toBe(true)
  })

  it('rejects a stationary drift fix instead of completing the PIN', () => {
    const previous = makeState(400, 1_000)
    const match = matchGpsPosition(
      straightRoute,
      { position: [41.90001, 45.5045], accuracyMeters: 3, timestampMs: 2_000 },
      previous,
      { nowMs: 2_000, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
    )
    const result = evaluatePinRouteCompletion(
      straightRoute,
      [41.9, 45.505],
      match,
      previous,
      { minimumForwardMeters: 2 },
    )
    expect(result.ready).toBe(false)
    expect(['stationary', 'reverse-direction', 'pin-not-in-approach-window']).toContain(result.status)
  })

  it('rejects a wrong-direction return as PIN completion', () => {
    const previous = makeState(600, 1_000)
    const projection = projectPointToRoute(straightRoute, [41.9, 45.5035])
    if (!projection) throw new Error('expected reverse projection')
    const match = {
      status: 'matched' as const,
      accepted: true,
      projection,
      direction: 'reverse' as const,
      nextState: { ...makeState(projection.chainageMeters, 2_000), accuracyMeters: 3 },
    }
    const result = evaluatePinRouteCompletion(
      straightRoute,
      [41.9, 45.505],
      match,
      previous,
    )
    expect(result.ready).toBe(false)
    expect(result.status).toBe('reverse-direction')
  })

  it('rejects an off-route pin projection and poor GPS accuracy', () => {
    const previous = makeState(400, 1_000)
    const poor = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.5045], accuracyMeters: 18, timestampMs: 2_000 },
      previous,
      { nowMs: 2_000, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
    )
    expect(evaluatePinRouteCompletion(straightRoute, [41.9, 45.505], poor, previous).status).toBe('no-route-match')

    const matched = matchGpsPosition(
      straightRoute,
      { position: [41.9, 45.5045], accuracyMeters: 3, timestampMs: 2_000 },
      previous,
      { nowMs: 2_000, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
    )
    const offRoutePin = evaluatePinRouteCompletion(
      straightRoute,
      [41.91, 45.505],
      matched,
      previous,
    )
    expect(offRoutePin.ready).toBe(false)
    expect(offRoutePin.status).toBe('pin-off-route')
  })

  it('validates geometry for exactly the four active routes', () => {
    expect(ACTIVE_ROUTE_IDS).toEqual(['route-1', 'route-2', 'route-3', 'route-4'])

    for (const routeId of ACTIVE_ROUTE_IDS) {
      const coordinates = ROUTE_POLYLINES[routeId]
      const route = prepareRouteGeometry(routeId as ActiveRouteId, coordinates)

      expect(coordinates.length).toBeGreaterThanOrEqual(2)
      expect(route.totalLengthMeters).toBeGreaterThan(0)
      expect(route.cumulativeMeters).toHaveLength(coordinates.length)
      expect(route.cumulativeMeters.every(Number.isFinite)).toBe(true)
      expect(route.cumulativeMeters.every((value, index, values) => index === 0 || value >= values[index - 1])).toBe(true)
    }
  })
})
