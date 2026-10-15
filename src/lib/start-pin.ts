import { distanceToPinMeters, headingMatches, type LatLng } from '@/lib/gps'
import { resolveTriggerDistanceM } from '@/lib/pin-cue'
import { maxPinOffsetFromLineM } from '@/lib/pin-route-line'

/**
 * Starting pin for a NEW exam, chosen once from the current GPS fix.
 * Only existing pin coordinates and trigger distances are used. Nothing here runs while
 * driving or on resume, and no pin is moved, added, or reordered.
 */

export const START_MAX_ACCURACY_M = 20
/** A moving fix: at least ~7 km/h with a usable heading. */
export const START_MIN_SPEED_MPS = 2
/** The car must be on one of this route's streets. */
const ON_ROUTE_M = 40
/** "Between pin k and k+1": d(k) + d(k+1) ≤ leg × factor + slack, allowing for curved streets. */
const BETWEEN_FACTOR = 1.3
const BETWEEN_SLACK_M = 30
const HEADING_TOLERANCE_DEG = 60
/** Same facing rule the driving cue uses (`evaluateNextPin`). */
const CUE_HEADING_DEG = 55
/** A pin more than this far off the heading is behind the car. */
const BEHIND_DEG = 120
/** Which street (arriving at / leaving a pin) the car is on must be clear by this much. */
const SIDE_MARGIN_M = 5

export type StartPinInput = {
  sort_order: number
  lat: number
  lng: number
  trigger_distance_m?: number | null
}

export type StartFix = {
  position: LatLng
  accuracyM: number | null
  headingDeg: number | null
  speedMps: number | null
}

export type StartPinDecision =
  | { kind: 'start'; sortOrder: number; basis: 'agency' | 'at-pin' | 'between' | 'heading' }
  | { kind: 'ambiguous'; candidates: number[]; moving: boolean }
  | { kind: 'fallback'; reason: 'accuracy' | 'off-route' | 'no-pins' }

/** A pin is on the street trace when this close to it. */
const PIN_ON_TRACE_M = 40
/** With a usable trace, "between k and k+1" means this close to the street joining them. */
const ON_LEG_M = 30

/** `legs`: the street(s) through this spot whose direction a moving car must match. */
type Candidate = { order: number; at: boolean; legs: LatLng[][] }

function toXY(point: LatLng, origin: LatLng): [number, number] {
  const lat = (origin[0] * Math.PI) / 180
  return [(point[1] - origin[1]) * Math.cos(lat) * 111_320, (point[0] - origin[0]) * 110_540]
}

function segmentDistanceM(point: LatLng, start: LatLng, end: LatLng): number {
  const [bx, by] = toXY(end, start)
  const [px, py] = toXY(point, start)
  const length2 = bx * bx + by * by
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / length2))
  return Math.hypot(px - bx * t, py - by * t)
}

function nearestSegment(point: LatLng, path: readonly LatLng[]): { index: number; distanceM: number } {
  let best = { index: 0, distanceM: Infinity }
  for (let i = 0; i + 1 < path.length; i++) {
    const d = segmentDistanceM(point, path[i], path[i + 1])
    if (d < best.distanceM) best = { index: i, distanceM: d }
  }
  return best
}

/**
 * Street path of every leg (pin i → pin i+1), when the trace visits the pins in sort_order.
 * Pins are placed on the trace in order (never going back along it) with the smallest total
 * offset, so a street the route drives twice belongs to the leg that actually drives it there.
 * Null when the trace does not follow the pins in order.
 */
export function legPaths(ordered: readonly StartPinInput[], trace: readonly LatLng[] | null): LatLng[][] | null {
  if (!trace || trace.length < 2 || ordered.length < 2) return null
  const segments = trace.length - 1
  const cost = ordered.map((pin) => {
    const at = pinAt(pin)
    return Array.from({ length: segments }, (_, j) => segmentDistanceM(at, trace[j], trace[j + 1]))
  })
  const total: number[][] = []
  const from: number[][] = []
  for (let k = 0; k < ordered.length; k++) {
    total.push(new Array<number>(segments))
    from.push(new Array<number>(segments))
    let bestPrev = Infinity
    let bestPrevAt = -1
    for (let j = 0; j < segments; j++) {
      if (k > 0 && total[k - 1][j] < bestPrev) {
        bestPrev = total[k - 1][j]
        bestPrevAt = j
      }
      const own = cost[k][j] > PIN_ON_TRACE_M ? Infinity : cost[k][j]
      total[k][j] = k === 0 ? own : own + bestPrev
      from[k][j] = bestPrevAt
    }
  }
  const last = ordered.length - 1
  let end = -1
  for (let j = 0; j < segments; j++) if (end < 0 || total[last][j] < total[last][end]) end = j
  if (end < 0 || !Number.isFinite(total[last][end])) return null
  const index = new Array<number>(ordered.length)
  for (let k = last, j = end; k >= 0; k--) {
    index[k] = j
    j = from[k][j]
  }
  // Legs run between the pins' foot points on the street, so a pin a few metres beside the
  // street does not add a step backwards to reach it.
  const foot = ordered.map((pin, k) => pathFrom(pinAt(pin), trace, index[k])[0])
  const paths: LatLng[][] = []
  for (let i = 0; i + 1 < ordered.length; i++) {
    paths.push([foot[i], ...trace.slice(index[i] + 1, index[i + 1] + 1), foot[i + 1]])
  }
  return paths
}

/** The rest of `path` from the car's foot point on segment `index`. */
function pathFrom(car: LatLng, path: readonly LatLng[], index: number): LatLng[] {
  const start = path[index]
  const end = path[index + 1]
  const [bx, by] = toXY(end, start)
  const [px, py] = toXY(car, start)
  const length2 = bx * bx + by * by
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / length2))
  const foot: LatLng = [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t]
  return [foot, ...path.slice(index + 1)]
}

/** Drives `path` in 3 m steps: does the cue rule (in zone and facing the pin) hold anywhere? */
function cueFiresAlong(path: readonly LatLng[], pin: LatLng, triggerM: number, skipM = 0): boolean {
  let travelled = 0
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]
    const b = path[i + 1]
    const length = distanceToPinMeters(a, b)
    if (length === 0) continue
    const heading = bearingOf(a, b)
    for (let d = 0; d <= length; d += 3) {
      if (travelled + d + 1e-6 < skipM) continue
      const t = d / length
      const at: LatLng = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      if (distanceToPinMeters(at, pin) <= triggerM && headingMatches(at, pin, heading, CUE_HEADING_DEG)) return true
    }
    travelled += length
  }
  return false
}

/** Metres ahead of `car` along `path` until the cue would fire, or Infinity. */
function firstCueMeters(path: readonly LatLng[], car: LatLng, pin: LatLng, triggerM: number): number {
  if (path.length < 2) return Infinity
  const { index, distanceM } = nearestSegment(car, path)
  if (distanceM > ON_ROUTE_M) return Infinity
  const forward = pathFrom(car, path, index)
  let travelled = 0
  for (let i = 0; i + 1 < forward.length; i++) {
    const a = forward[i]
    const b = forward[i + 1]
    const length = distanceToPinMeters(a, b)
    if (length === 0) continue
    const heading = bearingOf(a, b)
    for (let d = 0; d <= length; d += 3) {
      const t = d / length
      const at: LatLng = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      if (distanceToPinMeters(at, pin) <= triggerM && headingMatches(at, pin, heading, CUE_HEADING_DEG)) {
        return travelled + d
      }
    }
    travelled += length
  }
  return Infinity
}

function bearingOf(from: LatLng, to: LatLng): number {
  const φ1 = (from[0] * Math.PI) / 180
  const φ2 = (to[0] * Math.PI) / 180
  const Δλ = ((to[1] - from[1]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

let legPathCache: { pins: readonly StartPinInput[]; trace: readonly LatLng[] | null; paths: LatLng[][] | null } | null = null

function cachedLegPaths(
  pins: readonly StartPinInput[],
  ordered: readonly StartPinInput[],
  trace: readonly LatLng[] | null,
): LatLng[][] | null {
  if (legPathCache?.pins !== pins || legPathCache.trace !== trace) {
    legPathCache = { pins, trace, paths: legPaths(ordered, trace) }
  }
  return legPathCache.paths
}

function headingAlongLeg(car: LatLng, leg: readonly LatLng[], heading: number): boolean {
  const { index } = nearestSegment(car, leg)
  return headingMatches(leg[index], leg[index + 1], heading, HEADING_TOLERANCE_DEG)
}

export function isMovingFix(fix: StartFix): boolean {
  return (
    typeof fix.speedMps === 'number' &&
    fix.speedMps >= START_MIN_SPEED_MPS &&
    typeof fix.headingDeg === 'number' &&
    Number.isFinite(fix.headingDeg)
  )
}

const pinAt = (pin: StartPinInput): LatLng => [pin.lat, pin.lng]

function isConsecutive(orders: number[], ordered: StartPinInput[]): boolean {
  const index = orders.map((order) => ordered.findIndex((pin) => pin.sort_order === order))
  return index.every((value, i) => i === 0 || value === index[i - 1] + 1)
}

/**
 * @param roadTrace this route's street trace (`examRoadTrace`): the car must be on it, and when it
 *   follows the pins in order it also defines the street of each leg.
 */
export function chooseStartPin(
  pins: readonly StartPinInput[],
  fix: StartFix,
  roadTrace: readonly LatLng[] | null,
): StartPinDecision {
  const ordered = [...pins].sort((a, b) => a.sort_order - b.sort_order)
  if (ordered.length === 0) return { kind: 'fallback', reason: 'no-pins' }
  if (typeof fix.accuracyM !== 'number' || !Number.isFinite(fix.accuracyM) || fix.accuracyM > START_MAX_ACCURACY_M) {
    return { kind: 'fallback', reason: 'accuracy' }
  }

  const car = fix.position
  const dist = ordered.map((pin) => distanceToPinMeters(car, pinAt(pin)))
  const paths = cachedLegPaths(pins, ordered, roadTrace)
  const leg = (i: number): LatLng[] => paths?.[i] ?? [pinAt(ordered[i]), pinAt(ordered[i + 1])]

  const moving = isMovingFix(fix)
  /**
   * Inside pin i's zone and moving: will the driving cue still fire for it? It fires when the car
   * is in the zone and faces the pin, so it must do that now or further along the street.
   * The current fix already missed. A facing patch shorter than one second of travel is gone
   * before the next fix, and starting here would block every pin after it.
   */
  const passedPin = (i: number): 'ahead' | 'passed' | 'unsure' => {
    const pin = ordered[i]
    if (headingMatches(car, pinAt(pin), fix.headingDeg as number, CUE_HEADING_DEG)) return 'ahead'
    if (i + 1 >= ordered.length) return 'passed'
    // Without the street, a pin to the side may still be ahead (a bend before it); behind is passed.
    if (!paths) {
      return headingMatches(car, pinAt(pin), fix.headingDeg as number, BEHIND_DEG) ? 'unsure' : 'passed'
    }
    const arriving = nearestSegment(car, paths[i - 1])
    const leaving = nearestSegment(car, paths[i])
    const ahead =
      arriving.distanceM < leaving.distanceM - SIDE_MARGIN_M
        ? [...pathFrom(car, paths[i - 1], arriving.index), ...paths[i].slice(1)]
        : pathFrom(car, paths[i], leaving.index)
    const skipM = Math.max(0, fix.speedMps ?? 0)
    return cueFiresAlong(ahead, pinAt(pin), resolveTriggerDistanceM(pin.trigger_distance_m), skipM) ? 'ahead' : 'passed'
  }

  // Within a pin's trigger distance: that pin. At the agency a new exam is the start of the route.
  // A pin already passed means "on the way to the next pin".
  const inZone = ordered.map((pin, i) => dist[i] <= resolveTriggerDistanceM(pin.trigger_distance_m))
  const atOrders = new Set(ordered.filter((_, i) => inZone[i]).map((pin) => pin.sort_order))
  const atPins: Candidate[] = []
  const unsure: number[] = []
  ordered.forEach((pin, i) => {
    if (!inZone[i] || i === 0) return
    const side = moving ? passedPin(i) : 'ahead'
    if (side !== 'ahead') {
      // The next pin decides for itself when the car is in its zone too.
      if (i + 1 < ordered.length && !inZone[i + 1]) {
        atPins.push({ order: ordered[i + 1].sort_order, at: false, legs: [leg(i)] })
      }
      if (side === 'passed') return
      unsure.push(pin.sort_order, ordered[i + 1].sort_order)
    }
    const legs: LatLng[][] = [leg(i - 1)]
    if (i + 1 < ordered.length) legs.push(leg(i))
    atPins.push({ order: pin.sort_order, at: true, legs })
  })
  if (atOrders.has(ordered[0].sort_order)) {
    return { kind: 'start', sortOrder: ordered[0].sort_order, basis: 'agency' }
  }

  const onRoute = roadTrace && roadTrace.length >= 2 ? maxPinOffsetFromLineM([car], roadTrace) <= ON_ROUTE_M : true
  if (!onRoute) return { kind: 'fallback', reason: 'off-route' }

  // Between pin i and i+1. Standing at pin k is also "between k-1,k" and "between k,k+1";
  // those describe the same spot and are dropped. Any other leg is a separate place on the route.
  const between: Candidate[] = []
  for (let i = 0; i + 1 < ordered.length; i++) {
    if (atOrders.has(ordered[i].sort_order) || atOrders.has(ordered[i + 1].sort_order)) continue
    if (paths) {
      if (nearestSegment(car, paths[i]).distanceM > ON_LEG_M) continue
    } else {
      const length = distanceToPinMeters(pinAt(ordered[i]), pinAt(ordered[i + 1]))
      if (dist[i] + dist[i + 1] > length * BETWEEN_FACTOR + BETWEEN_SLACK_M) continue
    }
    between.push({ order: ordered[i + 1].sort_order, at: false, legs: [leg(i)] })
  }
  const candidates: Candidate[] = [...atPins, ...between]
  if (candidates.length === 0) return { kind: 'fallback', reason: 'off-route' }

  const orders = [...new Set(candidates.map((c) => c.order))].sort((a, b) => a - b)
  if (unsure.length > 0) {
    return { kind: 'ambiguous', candidates: [...new Set([...orders, ...unsure])].sort((a, b) => a - b), moving: true }
  }
  if (orders.length === 1) {
    return { kind: 'start', sortOrder: orders[0], basis: candidates[0].at ? 'at-pin' : 'between' }
  }

  // Neighbouring pins inside each other's trigger zone (e.g. 23 m apart) are one spot.
  // When the car is moving, start at whichever of them the cue reaches first. An earlier pin
  // that the street only faces again later would block the pin the car is about to pass.
  if (between.length === 0 && isConsecutive(orders, ordered)) {
    if (moving && roadTrace && roadTrace.length >= 2) {
      const meters = (order: number) => {
        const pin = ordered.find((item) => item.sort_order === order)!
        return firstCueMeters(roadTrace, car, pinAt(pin), resolveTriggerDistanceM(pin.trigger_distance_m))
      }
      const soonest = orders.reduce((best, order) => (meters(order) < meters(best) - 3 ? order : best))
      if (Number.isFinite(meters(soonest))) {
        return { kind: 'start', sortOrder: soonest, basis: 'heading' }
      }
    }
    return { kind: 'start', sortOrder: orders[0], basis: moving ? 'heading' : 'at-pin' }
  }

  if (!moving) return { kind: 'ambiguous', candidates: orders, moving: false }

  const heading = fix.headingDeg as number
  const matching = candidates.filter((c) => c.legs.some((path) => headingAlongLeg(car, path, heading)))
  const matchingOrders = [...new Set(matching.map((c) => c.order))].sort((a, b) => a - b)
  if (matchingOrders.length === 1) return { kind: 'start', sortOrder: matchingOrders[0], basis: 'heading' }
  return { kind: 'ambiguous', candidates: matchingOrders.length > 1 ? matchingOrders : orders, moving: true }
}
