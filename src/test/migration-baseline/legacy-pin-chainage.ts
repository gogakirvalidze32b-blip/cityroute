/**
 * Re-computes each PIN's route chainage exactly the way the LEGACY runtime
 * does (ExamDriveSession.tsx GPS handler + resolveExactPinChainageMeters), on
 * the frozen route geometry. Used to build and audit src/data/pin-chainage.json.
 */
import {
  positionAtChainageMeters,
  prepareRouteGeometry,
  projectOrderedPointsToRoute,
  projectPointToRoute,
  type ActiveRouteId,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'
import { resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'
import { pinAudioTriggerDistanceMeters } from '@/lib/pin-audio'
import { metersBetween } from '@/lib/pin-chainage-trigger'
import { frozenMatchLine } from '@/data/route-geometry'
import type { PinRow } from '@/types/database'

export type LegacyPinChainage = {
  sortOrder: number
  /** Chainage the legacy trigger compares the fix against (expectedPinChainageMeters). */
  triggerChainage: number | null
  triggerMethod: 'nearest' | 'ordered' | 'ordered→nearest(≤25 m ahead)'
  /** Chainage the legacy code re-anchors progress to once the PIN fires. */
  anchorChainage: number | null
  anchorMethod: string
  /** Sequential demo/auto-start chainage. */
  demoChainage: number | null
  nearestChainage: number | null
  nearestCrossTrack: number | null
  /** Distance from the PIN coordinate to the route point at triggerChainage. */
  offsetAtTriggerMeters: number | null
  leadMeters: number
}

/** Pins the legacy GPS handler treats as loop-context targets (nearest occurrence). */
export function legacyUsesNearestProjection(slug: string, order: number): boolean {
  return (
    (slug === 'route-1' && (order === 32 || order === 2)) ||
    (slug === 'route-2' && (order === 3 || order === 26)) ||
    (slug === 'route-3' && (order === 28 || order === 2)) ||
    (slug === 'route-4' && (order === 29 || order === 2))
  )
}

export function frozenGeometry(slug: string): PreparedRouteGeometry {
  return prepareRouteGeometry(slug as ActiveRouteId, frozenMatchLine(slug)!)
}

export function legacyPinChainages(slug: string, pinsInput: readonly PinRow[]): LegacyPinChainage[] {
  const pins = [...pinsInput].sort((a, b) => a.sort_order - b.sort_order)
  const geometry = frozenGeometry(slug)
  const demo = new Map<number, number>()
  let cursor = 0
  for (const pin of pins) {
    const chainage = resolveDemoPinChainage(geometry, pins, pin.sort_order, cursor)
    if (chainage == null) continue
    demo.set(pin.sort_order, chainage)
    cursor = chainage
  }
  return pins.map((pin) => {
    const order = pin.sort_order
    const ordered = projectOrderedPointsToRoute(
      geometry,
      pins.filter((item) => item.sort_order <= order).map((item) => [item.lat, item.lng] as const),
      20,
      slug === 'route-3' && order === 13,
    )
    const nearest = projectPointToRoute(geometry, [pin.lat, pin.lng])
    const nearbyForward =
      ordered && nearest && nearest.chainageMeters > ordered.chainageMeters &&
      nearest.chainageMeters - ordered.chainageMeters <= 25
        ? nearest
        : ordered
    const useNearest = legacyUsesNearestProjection(slug, order)
    const trigger = useNearest ? nearest : nearbyForward
    const triggerMethod: LegacyPinChainage['triggerMethod'] = useNearest
      ? 'nearest'
      : nearbyForward === nearest && nearest !== ordered
        ? 'ordered→nearest(≤25 m ahead)'
        : 'ordered'

    let anchorChainage: number | null
    let anchorMethod: string
    if (slug === 'route-1' && order === 1) {
      anchorChainage = 0
      anchorMethod = 'route-1 #1 forced 0'
    } else if (slug === 'route-1' && order === 2) {
      anchorChainage = nearest?.chainageMeters ?? null
      anchorMethod = 'nearest'
    } else if (slug === 'route-2' && (order === 3 || order === 26)) {
      anchorChainage = null
      anchorMethod = 'runtime: projection near the CURRENT matched chainage'
    } else {
      const prior = pins.filter((item) => item.sort_order < order).at(-1)?.sort_order
      const after =
        prior === undefined
          ? 0
          : slug === 'route-1' && prior === 2
            ? nearest && prior === 2 ? projectPointToRoute(geometry, [pins.find((p) => p.sort_order === 2)!.lat, pins.find((p) => p.sort_order === 2)!.lng])?.chainageMeters ?? 0 : 0
            : resolveDemoPinChainage(geometry, pins, prior, 0) ?? 0
      anchorChainage = resolveDemoPinChainage(geometry, pins, order, after)
      anchorMethod = 'resolveDemoPinChainage(after prior)'
    }
    const triggerChainage = trigger?.chainageMeters ?? null
    const onLine = triggerChainage == null ? null : positionAtChainageMeters(geometry, triggerChainage)
    return {
      sortOrder: order,
      triggerChainage,
      triggerMethod,
      anchorChainage,
      anchorMethod,
      demoChainage: demo.get(order) ?? null,
      nearestChainage: nearest?.chainageMeters ?? null,
      nearestCrossTrack: nearest?.crossTrackMeters ?? null,
      offsetAtTriggerMeters: onLine ? metersBetween(onLine, [pin.lat, pin.lng]) : null,
      leadMeters: pinAudioTriggerDistanceMeters(slug, order),
    }
  })
}
