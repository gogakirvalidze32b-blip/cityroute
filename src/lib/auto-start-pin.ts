import type { StartPinInput } from '@/lib/start-pin'
import { resolvePinProgress } from '@/lib/route-resume'
import {
  prepareRouteGeometry,
  projectPointToRoute,
  type ActiveRouteId,
  type LatLng,
} from '@/lib/pure-route-geometry'

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
  /** Retained as a stable result shape; GPS never changes the resolved PIN. */
  aheadSuggestion: null
}

/**
 * Auto start resolves only from persisted completed PIN orders. GPS is deliberately not an input.
 */
export function resolveAutoStart<T extends StartPinInput & { id: string }>(
  sortedPins: readonly T[],
  completed: ReadonlySet<number>,
  currentPosition?: LatLng | null,
  routePolyline?: readonly LatLng[] | null,
  routeId?: ActiveRouteId,
): AutoStartResult<T> {
  const resolution = resolvePinProgress(sortedPins, completed)
  const pin = resolution.status === 'resume' && resolution.nextSortOrder !== null
    ? sortedPins.find((item) => item.sort_order === resolution.nextSortOrder) ?? null
    : null
  if (completed.size === 0 && currentPosition && routePolyline && routeId && routePolyline.length >= 2) {
    try {
      const geometry = prepareRouteGeometry(routeId, routePolyline)
      const gpsProjection = projectPointToRoute(geometry, currentPosition)
      if (!gpsProjection || gpsProjection.crossTrackMeters > 250) {
        return { pin, aheadSuggestion: null }
      }

      const candidates = sortedPins
        .map((item) => {
          const pinProjection = projectPointToRoute(geometry, [item.lat, item.lng])
          return pinProjection ? { item, chainage: pinProjection.chainageMeters } : null
        })
        .filter((candidate): candidate is { item: T; chainage: number } => candidate !== null)
        .map((candidate) => ({
          ...candidate,
          distance: Math.abs(candidate.chainage - gpsProjection.chainageMeters),
        }))
        .sort((a, b) => a.distance - b.distance)
      if (candidates[0]) {
        const start = routePolyline[0]
        if (start && distanceMeters(currentPosition, start) <= 250) {
          const firstOrder = [...candidates].sort(
            (a, b) => a.item.sort_order - b.item.sort_order,
          )[0]
          if (firstOrder) return { pin: firstOrder.item, aheadSuggestion: null }
        }
        const routeStartCandidates = candidates.filter(
          (candidate) =>
            candidate.chainage <= 250 &&
            Math.abs(gpsProjection.chainageMeters - candidate.chainage) <= 250,
        )
        if (gpsProjection.chainageMeters <= 250 && routeStartCandidates.length > 0) {
          routeStartCandidates.sort(
            (a, b) =>
              Math.abs(a.chainage - gpsProjection.chainageMeters) -
              Math.abs(b.chainage - gpsProjection.chainageMeters),
          )
          return { pin: routeStartCandidates[0].item, aheadSuggestion: null }
        }
        return { pin: candidates[0].item, aheadSuggestion: null }
      }
    } catch {
      return { pin, aheadSuggestion: null }
    }
  }

  return { pin, aheadSuggestion: null }
}
