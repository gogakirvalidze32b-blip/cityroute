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
  const ordered = projectOrderedPointsToRoute(
    geometry,
    sortedPinPoints(pins, sortOrder),
    DEMO_PIN_CROSS_TRACK_M,
  )
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

export function prepareDemoRouteGeometry(
  routeId: ActiveRouteId,
  coordinates: readonly (readonly [number, number])[],
): PreparedRouteGeometry {
  return prepareRouteGeometry(routeId, coordinates)
}