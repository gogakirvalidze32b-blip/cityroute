/**
 * PIN chainage table — each exam PIN anchored to an exact route kilometre on
 * the frozen route geometry (src/data/route-geometry.ts).
 *
 *  chainage_m       metres from route start where the PIN is (trigger anchor)
 *  lead_m           speak this many metres before chainage_m (existing audio radius)
 *  offset_lat_deg / exact offset (degrees) from the route point at chainage_m to
 *  offset_lng_deg   the real PIN coordinate, so existing PIN locations are
 *                   reproduced bit-for-bit while the PIN is defined by its kilometre.
 *
 * Moving a PIN = changing chainage_m (scripts/move-pin-chainage.mts). Its marker,
 * kilometre trigger and audio (bound to instruction text) all follow.
 */
import {
  prepareRouteGeometry,
  type ActiveRouteId,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'
export { coordinateFromChainage, offsetFromChainage } from '@/lib/pin-chainage-geometry'
import { chainagePinTableProblems, type ChainagePin } from '@/lib/pin-chainage-trigger'
import { frozenMatchLine, routeGeometryVersion } from '@/data/route-geometry'
import table from './pin-chainage.json'

export type PinChainageEntry = {
  readonly sort_order: number
  readonly chainage_m: number
  readonly lead_m: number
  readonly offset_lat_deg: number
  readonly offset_lng_deg: number
  /** 'baseline' = computed from the pre-migration PIN position; 'edited' = moved by kilometre. */
  readonly origin: 'baseline' | 'edited'
}

export type PinChainageRouteTable = {
  readonly geometryVersion: string
  readonly pins: readonly PinChainageEntry[]
}

const TABLE = table as unknown as Readonly<Record<string, PinChainageRouteTable>>

export function pinChainageTable(slug: string): PinChainageRouteTable | null {
  return TABLE[slug] ?? null
}

const geometryCache = new Map<string, PreparedRouteGeometry | null>()

export function frozenPreparedGeometry(slug: string): PreparedRouteGeometry | null {
  if (!geometryCache.has(slug)) {
    const line = frozenMatchLine(slug)
    let geometry: PreparedRouteGeometry | null = null
    try {
      geometry = line ? prepareRouteGeometry(slug as ActiveRouteId, line) : null
    } catch {
      geometry = null
    }
    geometryCache.set(slug, geometry)
  }
  return geometryCache.get(slug) ?? null
}

export type ChainagePinsResult =
  | { readonly ok: true; readonly pins: ChainagePin[]; readonly geometryVersion: string }
  | { readonly ok: false; readonly reason: string }

/**
 * Join the table with the live PIN list (by sort_order). Fails closed: any
 * version mismatch, missing/extra PIN or invalid ordering returns ok:false so
 * callers keep the legacy trigger.
 */
export function chainagePinsForRoute(
  slug: string,
  pins: readonly { sort_order: number; lat: number; lng: number }[],
): ChainagePinsResult {
  const routeTable = pinChainageTable(slug)
  if (!routeTable) return { ok: false, reason: 'no chainage table for route' }
  const version = routeGeometryVersion(slug)
  if (!version || version !== routeTable.geometryVersion) {
    return { ok: false, reason: `geometry version mismatch (${routeTable.geometryVersion} vs ${version})` }
  }
  const sorted = [...pins].sort((a, b) => a.sort_order - b.sort_order)
  const byOrder = new Map(routeTable.pins.map((entry) => [entry.sort_order, entry]))
  if (byOrder.size !== sorted.length || sorted.some((pin) => !byOrder.has(pin.sort_order))) {
    return { ok: false, reason: 'PIN list and chainage table differ' }
  }
  const result: ChainagePin[] = sorted.map((pin) => {
    const entry = byOrder.get(pin.sort_order)!
    return {
      sortOrder: pin.sort_order,
      chainageMeters: entry.chainage_m,
      leadMeters: entry.lead_m,
      lat: pin.lat,
      lng: pin.lng,
    }
  })
  const problems = chainagePinTableProblems(result)
  if (problems.length > 0) return { ok: false, reason: problems.join('; ') }
  return { ok: true, pins: result, geometryVersion: version }
}
