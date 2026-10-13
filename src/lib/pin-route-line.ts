import type { LatLng } from '@/lib/gps'
import route1Road from '@/data/route-1-road.json'
import route2Road from '@/data/route-2-road.json'
import route3Road from '@/data/route-3-road.json'
import route4Road from '@/data/route-4-road.json'

export type PinRoutePoint = {
  lat: number
  lng: number
  sort_order: number
}

/** Live-map street line for the four Telavi exam routes. */
export const EXAM_STREET_LINE_SLUGS = new Set(['route-1', 'route-2', 'route-3', 'route-4'])

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

function distanceToSegmentM(point: LatLng, start: LatLng, end: LatLng): number {
  const lat = (start[0] * Math.PI) / 180
  const bx = (end[1] - start[1]) * Math.cos(lat) * 111_320
  const by = (end[0] - start[0]) * 110_540
  const px = (point[1] - start[1]) * Math.cos(lat) * 111_320
  const py = (point[0] - start[0]) * 110_540
  const length2 = bx * bx + by * by
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / length2))
  return Math.hypot(px - bx * t, py - by * t)
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

/** The street trace for this route when every loaded pin lies on it, otherwise null. */
export function examRoadTrace(slug: string, pins: readonly PinRoutePoint[]): LatLng[] | null {
  const straight = pinRouteLine(pins)
  const road = ROAD_BY_SLUG[slug]
  if (!road || straight.length < 2) return null
  if (maxPinOffsetFromLineM(straight, road) > ROAD_MATCH_M) return null
  return road
}

/**
 * Visual route line only. Pin order, coordinates, and triggers stay unchanged.
 * Only routes 2 and 3 have a bundled street trace on this production patch.
 */
export function examRouteLine(slug: string, pins: readonly PinRoutePoint[]): LatLng[] {
  return examRoadTrace(slug, pins) ?? pinRouteLine(pins)
}
