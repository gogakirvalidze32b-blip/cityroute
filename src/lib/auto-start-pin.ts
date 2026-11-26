import type { StartPinInput } from '@/lib/start-pin'
import { resolvePinProgress } from '@/lib/route-resume'
import {
  prepareDemoRouteGeometry,
  resolveDemoPinChainage,
} from '@/lib/preview-gps-demo-pin'
import {
  projectPointToRoute,
  projectPointToRouteNearChainage,
  type ActiveRouteId,
  type LatLng,
} from '@/lib/pure-route-geometry'

/** Along-route slack: a PIN this far behind the live GPS fix is already passed. */
export const PASSED_PIN_SKIP_M = 20
const AT_PIN_M = 20
const AT_PIN_CHAINAGE_WINDOW_M = 40
const START_PROJECTION_WINDOW_M = 500

function distanceMeters(a: LatLng, b: LatLng): number {
  const earthRadiusMeters = 6371000
  const latitudeDelta = ((b[0] - a[0]) * Math.PI) / 180
  const longitudeDelta = ((b[1] - a[1]) * Math.PI) / 180
  const latitude1 = (a[0] * Math.PI) / 180
  const latitude2 = (b[0] * Math.PI) / 180
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(value))
}

export type AutoStartResult<T extends StartPinInput> = {
  /** PIN the Auto start will actually use. */
  pin: T | null
  /** Retained as a stable result shape. */
  aheadSuggestion: null
}

function savedNextPin<T extends StartPinInput & { id: string }>(
  sortedPins: readonly T[],
  completed: ReadonlySet<number>,
): T | null {
  const resolution = resolvePinProgress(sortedPins, completed)
  if (resolution.status !== 'resume' || resolution.nextSortOrder === null) return null
  return sortedPins.find((item) => item.sort_order === resolution.nextSortOrder) ?? null
}

function pinChainages<T extends StartPinInput & { id: string }>(
  routeId: ActiveRouteId,
  routePolyline: readonly LatLng[],
  sortedPins: readonly T[],
): Map<number, number> | null {
  try {
    const geometry = prepareDemoRouteGeometry(routeId, routePolyline)
    const chainages = new Map<number, number>()
    let cursor = 0
    for (const pin of sortedPins) {
      const chainage = resolveDemoPinChainage(geometry, sortedPins, pin.sort_order, cursor)
      if (chainage == null) continue
      chainages.set(pin.sort_order, chainage)
      cursor = chainage
    }
    return chainages
  } catch {
    return null
  }
}

/**
 * Auto start never rewinds.
 * Live GPS on the exam line is authoritative: pins already behind by
 * {@link PASSED_PIN_SKIP_M} are skipped. Saved progress only raises the floor
 * (never forces a pin the car has already passed).
 */
export function resolveAutoStart<T extends StartPinInput & { id: string }>(
  sortedPins: readonly T[],
  completed: ReadonlySet<number>,
  currentPosition?: LatLng | null,
  routePolyline?: readonly LatLng[] | null,
  routeId?: ActiveRouteId,
): AutoStartResult<T> {
  const ordered = [...sortedPins].sort((a, b) => a.sort_order - b.sort_order)
  const savedPin = savedNextPin(ordered, completed)

  if (!currentPosition || !routePolyline || !routeId || routePolyline.length < 2) {
    return { pin: savedPin, aheadSuggestion: null }
  }

  const chainages = pinChainages(routeId, routePolyline, ordered)
  if (!chainages || chainages.size === 0) {
    return { pin: savedPin, aheadSuggestion: null }
  }

  let floorChainage = 0
  for (const order of completed) {
    const chainage = chainages.get(order)
    if (chainage != null && chainage > floorChainage) floorChainage = chainage
  }

  const start = routePolyline[0]
  const routeEnd = routePolyline[routePolyline.length - 1]
  const nearStart = Boolean(start && distanceMeters(currentPosition, start) <= 250)
  let gpsChainage: number
  try {
    const geometry = prepareDemoRouteGeometry(routeId, routePolyline)
    const forwardSpan = Math.max(400, geometry.totalLengthMeters - floorChainage)
    const forwardCenter = Math.min(
      geometry.totalLengthMeters,
      floorChainage + forwardSpan / 2,
    )
    const forward = projectPointToRouteNearChainage(
      geometry,
      currentPosition,
      forwardCenter,
      forwardSpan,
    )
    const gpsProjection =
      forward && forward.chainageMeters >= floorChainage - 25
        ? forward
        : projectPointToRoute(geometry, currentPosition)
    if (!gpsProjection || gpsProjection.crossTrackMeters > 250) {
      return { pin: savedPin, aheadSuggestion: null }
    }
    gpsChainage = Math.max(floorChainage, gpsProjection.chainageMeters)
    if (nearStart && completed.size === 0) {
      const startProjection = projectPointToRouteNearChainage(
        geometry,
        currentPosition,
        0,
        Math.min(START_PROJECTION_WINDOW_M, geometry.totalLengthMeters),
      )
      if (
        startProjection &&
        startProjection.crossTrackMeters <= gpsProjection.crossTrackMeters + 5
      ) {
        gpsChainage = startProjection.chainageMeters
      }
    }
  } catch {
    return { pin: savedPin, aheadSuggestion: null }
  }

  const atPin = ordered
    .filter((pin) => !completed.has(pin.sort_order))
    .map((pin) => ({
      pin,
      distance: distanceMeters(currentPosition, [pin.lat, pin.lng]),
      chainage: chainages.get(pin.sort_order),
    }))
    .filter(
      (candidate) =>
        candidate.distance <= AT_PIN_M &&
        (candidate.chainage == null ||
          Math.abs(candidate.chainage - gpsChainage) <= AT_PIN_CHAINAGE_WINDOW_M),
    )
    .sort(
      (first, second) =>
        Math.abs((first.chainage ?? gpsChainage) - gpsChainage) -
          Math.abs((second.chainage ?? gpsChainage) - gpsChainage) ||
        first.distance - second.distance ||
        first.pin.sort_order - second.pin.sort_order,
    )[0]
  if (atPin) return { pin: atPin.pin, aheadSuggestion: null }

  // Closed loops share agency coords with the finish: never treat an agency fix as the
  // end-of-route occurrence while mid-route progress is still open.
  try {
    const geometry = prepareDemoRouteGeometry(routeId, routePolyline)
    if (
      nearStart &&
      gpsChainage < geometry.totalLengthMeters * 0.15 &&
      completed.size > 0
    ) {
      return { pin: savedPin, aheadSuggestion: null }
    }
  } catch {
    /* fall through */
  }
  if (
    routeEnd &&
    distanceMeters(currentPosition, routeEnd) <= 250 &&
    floorChainage < (chainages.get(ordered.at(-1)?.sort_order ?? -1) ?? 0) * 0.85 &&
    completed.size > 0
  ) {
    return { pin: savedPin, aheadSuggestion: null }
  }

  const unfinishedNotBehind = ordered.filter((pin) => {
    if (completed.has(pin.sort_order)) return false
    const chainage = chainages.get(pin.sort_order)
    if (chainage == null) return true
    return chainage > gpsChainage - PASSED_PIN_SKIP_M
  })

  if (unfinishedNotBehind.length === 0) {
    return { pin: null, aheadSuggestion: null }
  }

  // Prefer PINs at/just ahead of the fix along the exam line (not Euclidean — loops revisit).
  const atOrAhead = unfinishedNotBehind.filter((pin) => {
    const chainage = chainages.get(pin.sort_order)
    if (chainage == null) return true
    return chainage >= gpsChainage - 5
  })
  const pool = atOrAhead.length > 0 ? atOrAhead : unfinishedNotBehind

  let gpsPin = pool[0]!
  let bestDistance = Number.POSITIVE_INFINITY
  for (const pin of pool) {
    const chainage = chainages.get(pin.sort_order)
    if (chainage == null) continue
    const distance = Math.abs(chainage - gpsChainage)
    if (distance < bestDistance) {
      bestDistance = distance
      gpsPin = pin
    }
  }

  return { pin: gpsPin, aheadSuggestion: null }
}
