import { describe, expect, it } from 'vitest'
import route1Road from '@/data/route-1-road.json'
import route2Road from '@/data/route-2-road.json'
import route3Road from '@/data/route-3-road.json'
import route4Road from '@/data/route-4-road.json'
import { ROUTE_POLYLINES } from '@/data/route-polylines'
import { SPEED_ZONES } from '@/data/speed-limits'
import {
  ACTIVE_ROUTE_IDS,
  prepareRouteGeometry,
  type ActiveRouteId,
  type LatLng,
} from './pure-route-geometry'

const ROAD_GEOMETRIES: Record<ActiveRouteId, readonly LatLng[]> = {
  'route-1': route1Road.map(([lat, lng]) => [lat, lng] as const),
  'route-2': route2Road.map(([lat, lng]) => [lat, lng] as const),
  'route-3': route3Road.map(([lat, lng]) => [lat, lng] as const),
  'route-4': route4Road.map(([lat, lng]) => [lat, lng] as const),
}

const EARTH_RADIUS_METERS = 6_371_008.8
const DEGREES_TO_RADIANS = Math.PI / 180

interface Projection {
  distanceMeters: number
  chainageMeters: number
}

function distanceMeters(from: LatLng, to: LatLng): number {
  const lat1 = from[0] * DEGREES_TO_RADIANS
  const lat2 = to[0] * DEGREES_TO_RADIANS
  const deltaLat = (to[0] - from[0]) * DEGREES_TO_RADIANS
  const deltaLng = (to[1] - from[1]) * DEGREES_TO_RADIANS
  const sinLat = Math.sin(deltaLat / 2)
  const sinLng = Math.sin(deltaLng / 2)
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function cumulativeDistances(coordinates: readonly LatLng[]): number[] {
  const cumulative = [0]
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distanceMeters(coordinates[index - 1], coordinates[index]))
  }
  return cumulative
}

function pointAt(
  coordinates: readonly LatLng[],
  cumulative: readonly number[],
  chainageMeters: number,
): LatLng {
  const bounded = Math.max(0, Math.min(cumulative[cumulative.length - 1], chainageMeters))
  let index = 0
  while (index < cumulative.length - 2 && cumulative[index + 1] < bounded) index += 1
  const length = cumulative[index + 1] - cumulative[index]
  const fraction = length === 0 ? 0 : (bounded - cumulative[index]) / length
  const start = coordinates[index]
  const end = coordinates[index + 1]
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ]
}

function projectOnSegment(point: LatLng, start: LatLng, end: LatLng): { distanceMeters: number; fraction: number } {
  const meanLatitude = ((point[0] + start[0] + end[0]) / 3) * DEGREES_TO_RADIANS
  const metersPerDegreeLongitude = EARTH_RADIUS_METERS * DEGREES_TO_RADIANS * Math.cos(meanLatitude)
  const metersPerDegreeLatitude = EARTH_RADIUS_METERS * DEGREES_TO_RADIANS
  const endX = (end[1] - start[1]) * metersPerDegreeLongitude
  const endY = (end[0] - start[0]) * metersPerDegreeLatitude
  const pointX = (point[1] - start[1]) * metersPerDegreeLongitude
  const pointY = (point[0] - start[0]) * metersPerDegreeLatitude
  const lengthSquared = endX * endX + endY * endY
  const fraction = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (pointX * endX + pointY * endY) / lengthSquared))
  return {
    distanceMeters: Math.hypot(pointX - endX * fraction, pointY - endY * fraction),
    fraction,
  }
}

function projectCandidates(coordinates: readonly LatLng[], point: LatLng): Projection[] {
  const cumulative = cumulativeDistances(coordinates)
  return coordinates.slice(0, -1).map((start, index) => {
    const projection = projectOnSegment(point, start, coordinates[index + 1])
    return {
      distanceMeters: projection.distanceMeters,
      chainageMeters:
        cumulative[index] +
        (cumulative[index + 1] - cumulative[index]) * projection.fraction,
    }
  }).sort((first, second) => first.distanceMeters - second.distanceMeters)
}

function nearestProjection(coordinates: readonly LatLng[], point: LatLng): Projection {
  return projectCandidates(coordinates, point)[0]
}

function sampleGeometry(coordinates: readonly LatLng[], stepMeters = 50): LatLng[] {
  const cumulative = cumulativeDistances(coordinates)
  const total = cumulative[cumulative.length - 1]
  const samples: LatLng[] = []
  for (let distance = 0; distance < total; distance += stepMeters) {
    samples.push(pointAt(coordinates, cumulative, distance))
  }
  samples.push(coordinates[coordinates.length - 1])
  return samples
}

function compareGeometries(first: readonly LatLng[], second: readonly LatLng[]) {
  const firstSamples = sampleGeometry(first)
  const secondSamples = sampleGeometry(second)
  const firstToSecond = firstSamples.map((point) => nearestProjection(second, point))
  const secondToFirst = secondSamples.map((point) => nearestProjection(first, point))
  const distances = [
    ...firstToSecond.map((projection) => projection.distanceMeters),
    ...secondToFirst.map((projection) => projection.distanceMeters),
  ]
  let forwardSteps = 0
  let reverseSteps = 0
  for (let index = 1; index < firstToSecond.length; index += 1) {
    const delta = firstToSecond[index].chainageMeters - firstToSecond[index - 1].chainageMeters
    if (delta > 1) forwardSteps += 1
    if (delta < -1) reverseSteps += 1
  }
  const matchedSamples = distances.filter((distance) => distance <= 20).length
  return {
    meanDeviationMeters: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
    maxDeviationMeters: Math.max(...distances),
    overlapPercent: (matchedSamples / distances.length) * 100,
    firstToSecondOverlapPercent:
      (firstToSecond.filter((projection) => projection.distanceMeters <= 20).length / firstToSecond.length) * 100,
    secondToFirstOverlapPercent:
      (secondToFirst.filter((projection) => projection.distanceMeters <= 20).length / secondToFirst.length) * 100,
    forwardDirectionPercent:
      (forwardSteps / Math.max(1, forwardSteps + reverseSteps)) * 100,
    reverseDirectionPercent:
      (reverseSteps / Math.max(1, forwardSteps + reverseSteps)) * 100,
  }
}

function chainageAtRoadU(coordinates: readonly LatLng[], u: number): number {
  const cumulative = cumulativeDistances(coordinates)
  const segmentIndex = Math.min(Math.max(Math.floor(u), 0), coordinates.length - 2)
  return cumulative[segmentIndex] +
    (cumulative[segmentIndex + 1] - cumulative[segmentIndex]) * (u - segmentIndex)
}

function coordinateAtRoadU(coordinates: readonly LatLng[], u: number): LatLng {
  const segmentIndex = Math.min(Math.max(Math.floor(u), 0), coordinates.length - 2)
  const fraction = u - segmentIndex
  const start = coordinates[segmentIndex]
  const end = coordinates[segmentIndex + 1]
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ]
}

function hasAmbiguousProjection(coordinates: readonly LatLng[], point: LatLng): boolean {
  const candidates = projectCandidates(coordinates, point)
  return candidates.some(
    (candidate) =>
      Math.abs(candidate.chainageMeters - candidates[0].chainageMeters) >= 100 &&
      candidate.distanceMeters <= candidates[0].distanceMeters + 5,
  )
}

function repeatedDirectedSegmentCount(coordinates: readonly LatLng[]): number {
  const seen = new Set<string>()
  let repeated = 0
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const key = `${coordinates[index].join(',')}>${coordinates[index + 1].join(',')}`
    if (seen.has(key)) repeated += 1
    else seen.add(key)
  }
  return repeated
}

describe('isolated route geometry comparison audit', () => {
  it('limits the audit and Engine geometry to the four active routes', () => {
    expect(ACTIVE_ROUTE_IDS).toEqual(['route-1', 'route-2', 'route-3', 'route-4'])
    expect(Object.keys(ROAD_GEOMETRIES).sort()).toEqual([...ACTIVE_ROUTE_IDS].sort())
    expect(ROUTE_POLYLINES['route-5']).toBeDefined()
    expect(ACTIVE_ROUTE_IDS).not.toContain('route-5')
  })

  it('validates finite, non-zero navigation, road, and Engine geometry for routes 1–4', () => {
    for (const routeId of ACTIVE_ROUTE_IDS) {
      const navigation = ROUTE_POLYLINES[routeId]
      const road = ROAD_GEOMETRIES[routeId]
      const engine = prepareRouteGeometry(routeId, navigation)
      for (const coordinates of [navigation, road]) {
        expect(coordinates.length).toBeGreaterThanOrEqual(2)
        expect(coordinates.every(([lat, lng]) =>
          Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180,
        )).toBe(true)
        expect(cumulativeDistances(coordinates).at(-1)).toBeGreaterThan(0)
      }
      expect(engine.coordinates).toEqual(navigation)
      expect(engine.totalLengthMeters).toBeCloseTo(cumulativeDistances(navigation).at(-1)!, 5)
    }
  })

  it('measures geometry deviation and bounded overlap in both directions', () => {
    for (const routeId of ACTIVE_ROUTE_IDS) {
      const metrics = compareGeometries(ROUTE_POLYLINES[routeId], ROAD_GEOMETRIES[routeId])
      expect(metrics.meanDeviationMeters).toBeGreaterThanOrEqual(0)
      expect(metrics.maxDeviationMeters).toBeGreaterThanOrEqual(metrics.meanDeviationMeters)
      expect(metrics.overlapPercent).toBeGreaterThanOrEqual(0)
      expect(metrics.overlapPercent).toBeLessThanOrEqual(100)
      expect(metrics.firstToSecondOverlapPercent).toBeGreaterThanOrEqual(0)
      expect(metrics.secondToFirstOverlapPercent).toBeGreaterThanOrEqual(0)
    }

    const route3 = compareGeometries(ROUTE_POLYLINES['route-3'], ROAD_GEOMETRIES['route-3'])
    expect(route3.meanDeviationMeters).toBeGreaterThan(200)
    expect(route3.overlapPercent).toBeLessThan(60)
  })

  it('detects opposite-order traversal within the compared lines', () => {
    const route1 = compareGeometries(ROUTE_POLYLINES['route-1'], ROAD_GEOMETRIES['route-1'])
    expect(route1.forwardDirectionPercent).toBeGreaterThan(0)
    expect(route1.reverseDirectionPercent).toBeGreaterThan(0)
    expect(route1.forwardDirectionPercent + route1.reverseDirectionPercent).toBeCloseTo(100, 5)
  })

  it('measures start/end correspondence instead of inferring it from route length', () => {
    for (const routeId of ACTIVE_ROUTE_IDS) {
      const navigation = ROUTE_POLYLINES[routeId]
      const road = ROAD_GEOMETRIES[routeId]
      expect(Number.isFinite(distanceMeters(navigation[0], road[0]))).toBe(true)
      expect(Number.isFinite(
        distanceMeters(navigation[navigation.length - 1], road[road.length - 1]),
      )).toBe(true)
    }

    const route3Navigation = ROUTE_POLYLINES['route-3']
    const route3Road = ROAD_GEOMETRIES['route-3']
    const startDistance = distanceMeters(route3Navigation[0], route3Road[0])
    const endDistance = distanceMeters(
      route3Navigation[route3Navigation.length - 1],
      route3Road[route3Road.length - 1],
    )
    expect(startDistance).toBeGreaterThan(2_500)
    expect(endDistance).toBeGreaterThan(2_500)
    expect(distanceMeters(route3Navigation[0], route3Navigation.at(-1)!)).toBeLessThan(1)
  })

  it('detects closed-loop endpoints and repeated directed geometry', () => {
    expect(distanceMeters(ROUTE_POLYLINES['route-1'][0], ROUTE_POLYLINES['route-1'].at(-1)!))
      .toBeLessThan(10)
    expect(distanceMeters(ROUTE_POLYLINES['route-3'][0], ROUTE_POLYLINES['route-3'].at(-1)!))
      .toBeLessThan(1)
    expect(repeatedDirectedSegmentCount(ROUTE_POLYLINES['route-3'])).toBeGreaterThan(0)
    expect(repeatedDirectedSegmentCount(ROAD_GEOMETRIES['route-2'])).toBeGreaterThan(0)
  })

  it('converts all 16 source speed-zone u boundaries to monotonic road chainage', () => {
    let zoneCount = 0
    for (const routeId of ACTIVE_ROUTE_IDS) {
      const road = ROAD_GEOMETRIES[routeId]
      const zones = SPEED_ZONES[routeId]
      expect(zones).toBeDefined()
      for (const zone of zones) {
        zoneCount += 1
        expect(zone.from).toBeGreaterThanOrEqual(0)
        expect(zone.to).toBeGreaterThan(zone.from)
        expect(zone.to).toBeLessThanOrEqual(road.length - 1)
        const fromMeters = chainageAtRoadU(road, zone.from)
        const toMeters = chainageAtRoadU(road, zone.to)
        expect(fromMeters).toBeGreaterThanOrEqual(0)
        expect(toMeters).toBeGreaterThan(fromMeters)
        expect(toMeters).toBeLessThanOrEqual(cumulativeDistances(road).at(-1)! + 0.01)
      }
    }
    expect(zoneCount).toBe(16)
  })

  it('identifies repeated-place ambiguity rather than choosing an arbitrary pass', () => {
    const route4Road = ROAD_GEOMETRIES['route-4']
    const route4Zone = SPEED_ZONES['route-4'].find((zone) => zone.id === 'r4-4b')!
    const boundary = coordinateAtRoadU(route4Road, route4Zone.from)
    expect(hasAmbiguousProjection(route4Road, boundary)).toBe(true)

    const route2Road = ROAD_GEOMETRIES['route-2']
    expect(repeatedDirectedSegmentCount(route2Road)).toBeGreaterThan(0)
  })

  it('reports gaps or overlaps between adjacent zone chainage intervals without altering source zones', () => {
    let gapCount = 0
    let overlapCount = 0
    for (const routeId of ACTIVE_ROUTE_IDS) {
      const road = ROAD_GEOMETRIES[routeId]
      const intervals = SPEED_ZONES[routeId]
        .map((zone) => ({
          from: chainageAtRoadU(road, zone.from),
          to: chainageAtRoadU(road, zone.to),
        }))
        .sort((first, second) => first.from - second.from)
      for (let index = 1; index < intervals.length; index += 1) {
        const gapOrOverlapMeters = intervals[index].from - intervals[index - 1].to
        expect(Number.isFinite(gapOrOverlapMeters)).toBe(true)
        if (gapOrOverlapMeters > 0) gapCount += 1
        if (gapOrOverlapMeters < 0) overlapCount += 1
      }
    }
    expect(gapCount).toBeGreaterThan(0)
    expect(overlapCount).toBe(0)
  })
})
