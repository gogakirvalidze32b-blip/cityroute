import type { LatLng } from '@/lib/gps'
import route1Road from '@/data/route-1-road.json'
import route2Road from '@/data/route-2-road.json'
import route3Road from '@/data/route-3-road.json'
import route4Road from '@/data/route-4-road.json'
import { roundSharpRouteCorners } from '@/lib/round-route-corners'
import { frozenMapLines, frozenMatchLine } from '@/data/route-geometry'

export type PinRoutePoint = {
  lat: number
  lng: number
  sort_order: number
}

/** Live-map street lines for the four Telavi exam routes. */
export const EXAM_STREET_LINE_SLUGS = new Set([
  'route-1',
  'route-2',
  'route-3',
  'route-4',
])

/**
 * Full exam line: every existing pin, first to last, in sort_order.
 * Points are the pin coordinates themselves. This does not add, move, or reorder pins.
 */
export function pinRouteLine(pins: readonly PinRoutePoint[]): LatLng[] {
  return [...pins]
    .filter(
      (pin) =>
        Number.isFinite(pin.lat) && Number.isFinite(pin.lng) && Number.isFinite(pin.sort_order),
    )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((pin) => [pin.lat, pin.lng])
}

/**
 * Road traces for the exam map. Each line follows the streets through that route's pins.
 * Side-street spurs that leave the road and come back are already removed.
 */
const ROAD_BY_SLUG: Record<string, LatLng[]> = {
  'route-1': route1Road as LatLng[],
  'route-2': route2Road as LatLng[],
  'route-3': route3Road as LatLng[],
  'route-4': route4Road as LatLng[],
}

/** A loaded pin must sit on this road. Otherwise the straight pin line is used. */
const ROAD_MATCH_M = 40
const ROUTE_2_PIN_3_SEGMENT_GEOJSON = [
  [45.476079, 41.930940],
  [45.475908, 41.930672],
  [45.476089, 41.930613],
  [45.476258, 41.930878],
] as const

function projectOntoSegmentM(
  point: LatLng,
  start: LatLng,
  end: LatLng,
): { point: LatLng; distance: number } {
  const lat = (start[0] * Math.PI) / 180
  const bx = (end[1] - start[1]) * Math.cos(lat) * 111_320
  const by = (end[0] - start[0]) * 110_540
  const px = (point[1] - start[1]) * Math.cos(lat) * 111_320
  const py = (point[0] - start[0]) * 110_540
  const length2 = bx * bx + by * by
  const fraction = length2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / length2))
  return {
    point: [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ],
    distance: Math.hypot(px - bx * fraction, py - by * fraction),
  }
}

function distanceToSegmentM(point: LatLng, start: LatLng, end: LatLng): number {
  return projectOntoSegmentM(point, start, end).distance
}

function distanceBetweenPointsM(a: LatLng, b: LatLng): number {
  const meanLat = ((a[0] + b[0]) / 2) * (Math.PI / 180)
  const east = (b[1] - a[1]) * Math.cos(meanLat) * 111_320
  const north = (b[0] - a[0]) * 110_540
  return Math.hypot(east, north)
}

function pullPolylineThroughPoint(
  line: readonly LatLng[],
  target: LatLng,
  adjustmentRadiusM: number,
): LatLng[] {
  if (line.length < 2) return line.map((point) => [point[0], point[1]])

  const chainages = [0]
  for (let index = 1; index < line.length; index += 1) {
    chainages.push(chainages[index - 1]! + distanceBetweenPointsM(line[index - 1]!, line[index]!))
  }

  let segmentIndex = -1
  let centerChainage = 0
  let nearestDistance = Infinity
  let nearestProjection: LatLng | null = null
  for (let index = 0; index < line.length - 1; index += 1) {
    const start = line[index]!
    const end = line[index + 1]!
    const projection = projectOntoSegmentM(target, start, end)
    if (projection.distance < nearestDistance) {
      nearestDistance = projection.distance
      segmentIndex = index
      nearestProjection = projection.point
      centerChainage = chainages[index]! + distanceBetweenPointsM(start, projection.point)
    }
  }
  if (segmentIndex < 0 || !nearestProjection || nearestDistance > adjustmentRadiusM) {
    return line.map((point) => [point[0], point[1]])
  }

  const shift: LatLng = [
    target[0] - nearestProjection[0],
    target[1] - nearestProjection[1],
  ]

  const adjusted = line.map((point, index) => {
    const offset = chainages[index]! - centerChainage
    if (Math.abs(offset) >= adjustmentRadiusM || index === 0 || index === line.length - 1) {
      return [point[0], point[1]] as LatLng
    }
    const weight = (1 + Math.cos((Math.PI * offset) / adjustmentRadiusM)) / 2
    return [point[0] + shift[0] * weight, point[1] + shift[1] * weight] as LatLng
  })

  adjusted.splice(segmentIndex + 1, 0, [target[0], target[1]])
  return adjusted
}

function route4Pin13Line(raw: readonly LatLng[], pins: readonly PinRoutePoint[]): LatLng[] | null {
  const pin13 = pins.find((pin) => pin.sort_order === 13)
  if (!pin13) return null

  let nearestIndex = -1
  let nearestDistance = Infinity
  for (let index = 1; index < raw.length - 1; index += 1) {
    const distance = distanceBetweenPointsM([pin13.lat, pin13.lng], raw[index]!)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }
  if (nearestIndex < 0 || nearestDistance > ROAD_MATCH_M) return null

  const rounded = roundSharpRouteCorners(raw, {
    forceTurnIndices: [nearestIndex],
    maxForcedTurnInsetMeters: 20,
  })
  return pullPolylineThroughPoint(rounded, [pin13.lat, pin13.lng], 24)
}

function route2Pin3MapLine(raw: readonly LatLng[]): LatLng[] {
  const line = roundSharpRouteCorners(raw)
  const segment = ROUTE_2_PIN_3_SEGMENT_GEOJSON.map(
    ([lng, lat]): LatLng => [lat, lng],
  )

  const nearestVertex = (target: LatLng, from: number, to: number) => {
    let index = -1
    let distance = Infinity
    for (let i = from; i < Math.min(to, line.length); i += 1) {
      const candidateDistance = distanceBetweenPointsM(line[i]!, target)
      if (candidateDistance < distance) {
        index = i
        distance = candidateDistance
      }
    }
    return { index, distance }
  }

  const start = nearestVertex(segment[0]!, 0, 30)
  const end = nearestVertex(segment[segment.length - 1]!, start.index + 1, start.index + 20)
  if (start.index < 0 || end.index <= start.index || start.distance > 20 || end.distance > 20) {
    throw new Error('Route 2 PIN 3 display segment does not match the bundled road trace')
  }

  return [...line.slice(0, start.index), ...segment, ...line.slice(end.index + 1)]
}

function route3FinishCorridorLine(
  raw: readonly LatLng[],
  pins: readonly PinRoutePoint[],
): LatLng[] {
  const pin25 = pins.find((pin) => pin.sort_order === 25)
  const pin26 = pins.find((pin) => pin.sort_order === 26)
  if (!pin25 || !pin26) return roundSharpRouteCorners(raw)

  let line = roundSharpRouteCorners(raw)
  const junction: LatLng = [41.93018266666667, 45.475796]
  const pin26Point: LatLng = [pin26.lat, pin26.lng]

  let junctionIndex = -1
  let junctionDistance = Infinity
  let pin26Index = -1
  let pin26Distance = Infinity
  line.forEach((point, index) => {
    const junctionCandidate = distanceBetweenPointsM(point, junction)
    if (junctionCandidate < junctionDistance) {
      junctionDistance = junctionCandidate
      junctionIndex = index
    }
    const pin26Candidate = distanceBetweenPointsM(point, pin26Point)
    if (pin26Candidate < pin26Distance) {
      pin26Distance = pin26Candidate
      pin26Index = index
    }
  })

  if (junctionIndex >= 0 && pin26Index > junctionIndex && junctionDistance < 5 && pin26Distance < 5) {
    line = [
      ...line.slice(0, junctionIndex),
      junction,
      pin26Point,
      ...line.slice(pin26Index + 1),
    ]
  }

  line = pullPolylineThroughPoint(line, [pin25.lat, pin25.lng], 32)
  const pin25Point: LatLng = [pin25.lat, pin25.lng]
  const pin25Index = line.findIndex(
    (point) => point[0] === pin25Point[0] && point[1] === pin25Point[1],
  )
  const pin26LineIndex = line.findIndex(
    (point) => point[0] === pin26Point[0] && point[1] === pin26Point[1],
  )
  if (pin25Index < 0 || pin26LineIndex <= pin25Index) {
    throw new Error('Route 3 PIN 25–26 line segment could not be located')
  }
  return [
    ...line.slice(0, pin25Index),
    pin25Point,
    pin26Point,
    ...line.slice(pin26LineIndex + 1),
  ]
}

export function maxPinOffsetFromLineM(pins: readonly LatLng[], line: readonly LatLng[]): number {
  if (line.length < 2) return Infinity
  let worst = 0
  for (const pin of pins) {
    let nearest = Infinity
    for (let index = 1; index < line.length; index += 1) {
      nearest = Math.min(nearest, distanceToSegmentM(pin, line[index - 1], line[index]))
    }
    worst = Math.max(worst, nearest)
  }
  return worst
}

/** Bundled street road for a Telavi exam slug, when present. */
export function examStreetRoad(slug: string): LatLng[] | null {
  const road = ROAD_BY_SLUG[slug]
  return road && road.length >= 2 ? road : null
}

/** The street trace for this route when every loaded pin lies on it, otherwise null. */
export function examRoadTrace(slug: string, pins: readonly PinRoutePoint[]): LatLng[] | null {
  const straight = pinRouteLine(pins)
  const road = examStreetRoad(slug)
  if (!road || straight.length < 2) return null
  if (maxPinOffsetFromLineM(straight, road) > ROAD_MATCH_M) return null
  return road
}

/**
 * Exam blue route line (map + matching + chainage).
 *
 * For the four Telavi exam routes this is the FROZEN, versioned geometry
 * (src/data/route-geometry.ts) — an exact export of the line below built from
 * the pre-migration PINs. It intentionally ignores `pins`, so moving or editing
 * a PIN can never reshape the route or shift route kilometres. Other slugs still
 * build the line from their pins.
 */
export function examRouteLine(slug: string, pins: readonly PinRoutePoint[]): LatLng[] {
  return frozenMatchLine(slug) ?? buildExamRouteLineFromPins(slug, pins)
}

/**
 * Map-drawn street lines (frozen for the four exam routes, see examRouteLine).
 */
export function examMapRouteLines(slug: string, pins: readonly PinRoutePoint[]): LatLng[][] {
  return frozenMapLines(slug) ?? buildExamMapRouteLinesFromPins(slug, pins)
}

/**
 * Builder used to produce the frozen geometry: Pin coordinates / order / triggers
 * stay unchanged. Only true hairpin / U-tip vertices are filleted (finish
 * corridors); ordinary street corners and the agency start T-junction stay as
 * straight lines.
 */
export function buildExamRouteLineFromPins(slug: string, pins: readonly PinRoutePoint[]): LatLng[] {
  const raw = examRoadTrace(slug, pins) ?? pinRouteLine(pins)
  if (slug === 'route-3') {
    return route3FinishCorridorLine(raw, pins)
  }
  if (slug === 'route-4') {
    const pin13Line = route4Pin13Line(raw, pins)
    if (pin13Line) return pin13Line
  }
  return roundSharpRouteCorners(raw)
}

/**
 * Builder for map-drawn street lines. Route 3's Alazani carriageways stay
 * separate, while Route 4 shares its PIN 13 arc with the route line.
 */
export function buildExamMapRouteLinesFromPins(slug: string, pins: readonly PinRoutePoint[]): LatLng[][] {
  const road = examRoadTrace(slug, pins)
  const raw = road ?? pinRouteLine(pins)
  if (slug === 'route-4') {
    return [route4Pin13Line(raw, pins) ?? roundSharpRouteCorners(raw)]
  }
  if (slug === 'route-2') {
    return [road ? route2Pin3MapLine(road) : roundSharpRouteCorners(raw)]
  }
  if (slug !== 'route-3') return [roundSharpRouteCorners(raw)]

  const route3Line = route3FinishCorridorLine(raw, pins)

  const connectorIndex = route3Line.findIndex(
    (point, index) =>
      point[0] === 41.924773 &&
      point[1] === 45.472255 &&
      route3Line[index + 1]?.[0] === 41.924748 &&
      route3Line[index + 1]?.[1] === 45.472457,
  )
  if (connectorIndex < 0) return [route3Line]

  const finishLine = route3Line.slice(connectorIndex + 1)
  const pin25 = pins.find((pin) => pin.sort_order === 25)
  const pin26 = pins.find((pin) => pin.sort_order === 26)
  if (!pin25 || !pin26) {
    return [
      roundSharpRouteCorners(route3Line.slice(0, connectorIndex + 1)),
      roundSharpRouteCorners(finishLine, { protectStartMeters: 0 }),
    ]
  }
  const pin25Index = finishLine.findIndex(
    (point) => point[0] === pin25.lat && point[1] === pin25.lng,
  )
  const pin26Index = finishLine.findIndex(
    (point) => point[0] === pin26.lat && point[1] === pin26.lng,
  )
  if (pin25Index < 0 || pin26Index !== pin25Index + 1) {
    throw new Error('Route 3 map line does not preserve the straight PIN 25–26 segment')
  }

  return [
    roundSharpRouteCorners(route3Line.slice(0, connectorIndex + 1)),
    [
      ...roundSharpRouteCorners(finishLine.slice(0, pin25Index + 1), {
        protectStartMeters: 0,
      }),
      ...roundSharpRouteCorners(finishLine.slice(pin26Index), { protectStartMeters: 0 }),
    ],
  ]
}
