import type { PinRoutePoint } from '@/lib/pin-route-line'
import {
  prepareRouteGeometry,
  projectOrderedPointsToRoute,
  projectPointToRoute,
  projectPointToRouteNearChainage,
  type ActiveRouteId,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'

/** Match ExamDriveSession route geometry / PIN cross-track gates (not the old 40 m demo slack). */
export const DEMO_PIN_CROSS_TRACK_M = 20

const DEMO_PIN_FORWARD_SEARCH_M = 400

function sortedPinPoints(
  pins: readonly PinRoutePoint[],
  maxSortOrder: number,
): readonly (readonly [number, number])[] {
  return [...pins]
    .filter((pin) => pin.sort_order <= maxSortOrder)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((pin) => [pin.lat, pin.lng] as const)
}

function previousPinChainage(
  geometry: PreparedRouteGeometry,
  pins: readonly PinRoutePoint[],
  sortOrder: number,
): number {
  if (sortOrder <= 1) return 0
  const previousPins = [...pins]
    .filter((pin) => pin.sort_order < sortOrder)
    .sort((a, b) => a.sort_order - b.sort_order)
  const previousOrder = previousPins.at(-1)?.sort_order
  if (previousOrder === undefined) return 0
  return (
    resolveDemoPinChainage(geometry, pins, previousOrder, 0) ??
    0
  )
}

/**
 * Along-route chainage for demo GPS toward `sortOrder`, staying forward of `afterChainageMeters`.
 * Uses the same 20 m ordered projection as production, then forward occurrence search on loops.
 */
export function resolveDemoPinChainage(
  geometry: PreparedRouteGeometry,
  pins: readonly PinRoutePoint[],
  sortOrder: number,
  afterChainageMeters = 0,
): number | null {
  const target = pins.find((pin) => pin.sort_order === sortOrder)
  if (!target) return null

  const minChainage = Math.max(0, afterChainageMeters)
  // These PINs can be closer to an earlier route segment than their true occurrence.
  if (
    geometry.routeId === 'route-3' &&
    [6, 7, 14, 15, 16, 17].includes(sortOrder)
  ) {
    const pinProjection = projectPointToRoute(geometry, [target.lat, target.lng])
    if (
      pinProjection &&
      pinProjection.chainageMeters >= minChainage - 5 &&
      pinProjection.crossTrackMeters <= DEMO_PIN_CROSS_TRACK_M
    ) {
      return pinProjection.chainageMeters
    }
  }

  const ordered = projectOrderedPointsToRoute(
    geometry,
    sortedPinPoints(pins, sortOrder),
    DEMO_PIN_CROSS_TRACK_M,
    geometry.routeId === 'route-3' && [13, 14, 15].includes(sortOrder),
  )
  const isContextualFinishPin =
    (geometry.routeId === 'route-2' && sortOrder === 26) ||
    (geometry.routeId === 'route-4' && sortOrder === 29)
  if (
    ordered &&
    (geometry.routeId === 'route-2' || geometry.routeId === 'route-4') &&
    sortOrder !== 3 &&
    !isContextualFinishPin
  ) {
    const nearest = projectPointToRouteNearChainage(
      geometry,
      [target.lat, target.lng],
      ordered.chainageMeters,
      40,
    )
    if (
      nearest &&
      nearest.chainageMeters >= minChainage - 5 &&
      nearest.chainageMeters > ordered.chainageMeters + 15 &&
      nearest.chainageMeters - ordered.chainageMeters <= 40 &&
      nearest.crossTrackMeters <= DEMO_PIN_CROSS_TRACK_M &&
      ordered.crossTrackMeters - nearest.crossTrackMeters >= 10
    ) {
      return nearest.chainageMeters
    }
  }
  if (ordered && ordered.chainageMeters >= minChainage - 5) {
    return ordered.chainageMeters
  }

  const anchor = Math.max(minChainage, previousPinChainage(geometry, pins, sortOrder))
  const forwardSpan = Math.max(DEMO_PIN_FORWARD_SEARCH_M, geometry.totalLengthMeters - anchor)
  const forwardCenter = Math.min(geometry.totalLengthMeters, anchor + forwardSpan / 2)
  const forward = projectPointToRouteNearChainage(
    geometry,
    [target.lat, target.lng],
    forwardCenter,
    forwardSpan,
  )
  if (forward && forward.chainageMeters >= anchor - 5) {
    return forward.chainageMeters
  }

  const nearest = projectPointToRoute(geometry, [target.lat, target.lng])
  if (
    nearest &&
    nearest.chainageMeters >= anchor - 5 &&
    nearest.crossTrackMeters <= DEMO_PIN_CROSS_TRACK_M
  ) {
    return nearest.chainageMeters
  }

  return null
}

/**
 * Demo-panel start / preview placement only (not production auto-start).
 * Route 3 #16/#17 sit on the early west-loop of the exam line; sequential
 * "after PIN 15" search parks at #15 and drives downhill. Drop on the pin.
 */
const ROUTE_3_DEMO_GEO_START_ORDERS = new Set([16, 17])

export function resolveDemoStartPinChainage(
  geometry: PreparedRouteGeometry,
  pins: readonly PinRoutePoint[],
  sortOrder: number,
  afterChainageMeters = 0,
): number | null {
  if (
    geometry.routeId === 'route-3' &&
    ROUTE_3_DEMO_GEO_START_ORDERS.has(sortOrder)
  ) {
    const target = pins.find((pin) => pin.sort_order === sortOrder)
    if (!target) return null
    const nearest = projectPointToRoute(geometry, [target.lat, target.lng])
    if (nearest && nearest.crossTrackMeters <= DEMO_PIN_CROSS_TRACK_M) {
      return nearest.chainageMeters
    }
  }
  return resolveDemoPinChainage(geometry, pins, sortOrder, afterChainageMeters)
}

export function prepareDemoRouteGeometry(
  routeId: ActiveRouteId,
  coordinates: readonly (readonly [number, number])[],
): PreparedRouteGeometry {
  return prepareRouteGeometry(routeId, coordinates)
}

/**
 * First PIN (route order) whose along-route chainage is at/after `chainageMeters`.
 * Used by DEMO "jump to km" so PLAY continues from the next unfinished PIN.
 */
export function resolveDemoNextPinAfterChainage(
  geometry: PreparedRouteGeometry,
  pins: readonly PinRoutePoint[],
  chainageMeters: number,
): { sortOrder: number; chainageMeters: number } | null {
  const sorted = [...pins].sort((a, b) => a.sort_order - b.sort_order)
  const target = Math.max(0, chainageMeters)
  let cursor = 0
  for (const pin of sorted) {
    const chainage = resolveDemoStartPinChainage(geometry, pins, pin.sort_order, cursor)
    if (chainage === null) continue
    if (chainage + 1e-3 >= target) {
      return { sortOrder: pin.sort_order, chainageMeters: chainage }
    }
    cursor = chainage
  }
  return null
}