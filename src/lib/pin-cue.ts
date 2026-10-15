import { distanceToPinMeters, headingMatches, type LatLng } from '@/lib/gps'

/** Used when trigger_distance_m is missing or outside a usable range. */
export const TRIGGER_FALLBACK_M = 45

const MIN_VALID_TRIGGER_M = 8
const MAX_VALID_TRIGGER_M = 200
const AWAY_METERS = 12

export type CuePin = {
  id: string
  lat: number
  lng: number
  trigger_distance_m?: number | null
}

export type PinApproach = {
  pinId: string
  closestM: number
  awayTicks: number
}

export type CueDecision = {
  action: 'play' | 'skip' | 'wait'
  pinId: string | null
  triggerM: number | null
  distanceM: number | null
  approach: PinApproach | null
}

export function resolveTriggerDistanceM(
  triggerDistanceM: number | null | undefined,
  _speedMps?: number | null,
  _accuracyM?: number | null,
): number {
  const configured = triggerDistanceM
  if (
    typeof configured === 'number' &&
    Number.isFinite(configured) &&
    configured >= MIN_VALID_TRIGGER_M &&
    configured <= MAX_VALID_TRIGGER_M
  ) {
    return configured
  }
  return TRIGGER_FALLBACK_M
}

/** A fix coarser than the trigger zone cannot prove the car is at the pin. */
export function gpsFixCanConfirmPin(accuracyM: number | null | undefined, triggerM: number): boolean {
  if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM <= 0) return true
  return accuracyM <= triggerM
}

/**
 * Saved exams may store local ids (`p1-3`) while the live list uses Supabase UUIDs.
 * Map those ids by sort_order for the same route. Unknown ids are dropped.
 */
export function remapTriggeredPinIds(
  triggered: Iterable<string>,
  pins: readonly { id: string; sort_order: number }[],
  routeSlug: string,
): Set<string> {
  const live = new Set(pins.map((pin) => pin.id))
  const byOrder = new Map(pins.map((pin) => [pin.sort_order, pin.id]))
  const slugNum = /^route-(\d+)$/.exec(routeSlug)?.[1]
  const next = new Set<string>()
  for (const id of triggered) {
    if (live.has(id)) {
      next.add(id)
      continue
    }
    const local = /^p(\d+)-(\d+)$/.exec(id)
    if (!local || !slugNum || local[1] !== slugNum) continue
    const mapped = byOrder.get(Number(local[2]))
    if (mapped) next.add(mapped)
  }
  return next
}

function trackApproach(prev: PinApproach | null, pinId: string, distanceM: number): PinApproach {
  if (!prev || prev.pinId !== pinId) {
    return { pinId, closestM: distanceM, awayTicks: 0 }
  }
  if (distanceM < prev.closestM - 3) {
    return { pinId, closestM: distanceM, awayTicks: 0 }
  }
  if (distanceM > prev.closestM + AWAY_METERS) {
    return { pinId, closestM: prev.closestM, awayTicks: prev.awayTicks + 1 }
  }
  return prev
}

/**
 * Saved ids that belong to another pin list (local `p1-3` versus Supabase UUIDs,
 * or an empty list while routes 2–4 are still loading) stay untouched.
 * Remap only when this list can actually recognize them.
 */
export function restoreTriggeredPinIds(
  triggered: Iterable<string>,
  pins: readonly { id: string; sort_order: number }[],
  routeSlug: string,
): Set<string> {
  const current = new Set(triggered)
  if (pins.length === 0 || current.size === 0) return current
  const slugNum = /^route-(\d+)$/.exec(routeSlug)?.[1]
  const recognizable = [...current].some((id) => {
    if (pins.some((pin) => pin.id === id)) return true
    const local = /^p(\d+)-(\d+)$/.exec(id)
    return Boolean(local && slugNum && local[1] === slugNum)
  })
  if (!recognizable) return current
  return remapTriggeredPinIds(current, pins, routeSlug)
}

/**
 * Only the first pin that is not yet handled can play.
 * A coarse fix or a pass on a parallel road waits. It does not mark the pin as spoken.
 */
export function evaluateNextPin(args: {
  pins: readonly CuePin[]
  handledIds: ReadonlySet<string>
  inFlightId: string | null
  user: LatLng
  heading: number | null
  speedMps: number | null
  accuracyM: number | null
  approach: PinApproach | null
}): CueDecision {
  const pin = args.pins.find((item) => !args.handledIds.has(item.id)) ?? null
  if (!pin) {
    return { action: 'wait', pinId: null, triggerM: null, distanceM: null, approach: null }
  }

  const pinAt: LatLng = [pin.lat, pin.lng]
  const distanceM = distanceToPinMeters(args.user, pinAt)
  const triggerM = resolveTriggerDistanceM(pin.trigger_distance_m, args.speedMps, args.accuracyM)
  const approach = trackApproach(args.approach, pin.id, distanceM)
  const inFlight = args.inFlightId === pin.id

  if (inFlight) {
    return { action: 'wait', pinId: pin.id, triggerM, distanceM, approach }
  }

  const facing = headingMatches(args.user, pinAt, args.heading)
  const confirmed = gpsFixCanConfirmPin(args.accuracyM, triggerM)
  if (distanceM <= triggerM && facing && confirmed) {
    return { action: 'play', pinId: pin.id, triggerM, distanceM, approach }
  }

  return { action: 'wait', pinId: pin.id, triggerM, distanceM, approach }
}
