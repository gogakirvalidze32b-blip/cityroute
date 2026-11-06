import type { StartPinInput } from '@/lib/start-pin'
import { resolvePinProgress } from '@/lib/route-resume'
import {
  prepareRouteGeometry,
  projectPointToRoute,
  type ActiveRouteId,
  type LatLng,
} from '@/lib/pure-route-geometry'

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
        return { pin: candidates[0].item, aheadSuggestion: null }
      }
    } catch {
      return { pin, aheadSuggestion: null }
    }
  }

  return { pin, aheadSuggestion: null }
}
