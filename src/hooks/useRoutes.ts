import { useEffect, useState } from 'react'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyLocalTbilisiTestPin } from '@/data/local-tbilisi-test-pin'
import type { PinRow, RouteRow, RouteWithPins } from '@/types/database'

const MOVED_PINS: Array<[[number, number], [number, number]]> = [
  [[41.926909, 45.461327], [41.92676, 45.461276]],
  [[41.926626, 45.461236], [41.924423, 45.46041]],
  [[41.926429, 45.461338], [41.923787, 45.460435]],
  [[41.922093, 45.469893], [41.921785, 45.469907]],
  [[41.917228, 45.475799], [41.91729, 45.475646]],
  [[41.917267, 45.475761], [41.91745, 45.475199]],
  [[41.920189, 45.470198], [41.920288, 45.470219]],
  [[41.929098, 45.475144], [41.92918, 45.475192]],
  [[41.933977, 45.478151], [41.933177, 45.477598]],
]

function sameCoordinate(left: number, right: number) {
  return Math.abs(left - right) < 1e-7
}

/** Rewrite only the nine corrected pin positions. Order, text, and audio stay unchanged. */
export function applyRelocatedPin<T extends { pins: Array<{ lat: number; lng: number }> }>(routes: T[]): T[] {
  return routes.map((route) => ({
    ...route,
    pins: route.pins.map((pin) => {
      const moved = MOVED_PINS.find(
        ([from]) => sameCoordinate(pin.lat, from[0]) && sameCoordinate(pin.lng, from[1]),
      )
      if (!moved) return pin
      return { ...pin, lat: moved[1][0], lng: moved[1][1] }
    }),
  }))
}

/**
 * Bundled local pins win when present. Supabase pins often lag (old count/coords) and
 * would hide new Route 1 PINs such as 41.917305,45.474576. Remote is fallback only.
 */
export function selectRoutePins<T>(localPins: readonly T[], remotePins: readonly T[]): T[] {
  return localPins.length >= 2 ? [...localPins] : [...remotePins]
}

/**
 * Merge Supabase metadata (id, city_id) but NEVER remote polyline or stale remote pins.
 * route-polylines.ts / TELAVI_ROUTES_FALLBACK is the source of truth for map geometry and PIN coords.
 */
function mergeRoutes(remoteRows: RouteRow[] | null, pinRows: PinRow[] | null): RouteWithPins[] {
  if (!remoteRows?.length) {
    console.log('[DEBUG] mergeRoutes: No remote rows, returning TELAVI_ROUTES_FALLBACK')
    return applyLocalTbilisiTestPin(applyRelocatedPin(TELAVI_ROUTES_FALLBACK))
  }

  return applyLocalTbilisiTestPin(applyRelocatedPin(TELAVI_ROUTES_FALLBACK)).map((local) => {
    const remote = remoteRows.find((r) => r.slug === local.slug)
    if (!remote) {
      console.log(`[DEBUG] mergeRoutes: ${local.slug} - no remote match, using local (${local.pins.length} pins)`)
      return local
    }

    const remotePins = (pinRows ?? []).filter((p) => p.route_id === remote.id)
    const pins = selectRoutePins(local.pins, remotePins)
    console.log(`[DEBUG] mergeRoutes: ${local.slug}:`)
    console.log(`  - local pins: ${local.pins.length}`)
    console.log(`  - remote pins: ${remotePins.length}`)
    console.log(`  - will use: ${local.pins.length >= 2 ? 'local' : remotePins.length >= 2 ? 'remote' : 'none'}`)

    return {
      ...local,
      id: remote.id,
      city_id: remote.city_id,
      polyline: local.polyline,
      pins,
    }
  })
}

export function useRoutes() {
  const [routes, setRoutes] = useState<RouteWithPins[]>(() =>
    applyLocalTbilisiTestPin(applyRelocatedPin(TELAVI_ROUTES_FALLBACK)),
  )
  const [source, setSource] = useState<'local' | 'merged'>('local')

  useEffect(() => {
    console.log('[DEBUG] useRoutes initial fallback:')
    TELAVI_ROUTES_FALLBACK.forEach(r => {
      console.log(`  ${r.slug}: ${r.pins.length} pins`)
    })
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured) return

    let cancelled = false
    async function load() {
      try {
        const supabase = getSupabase()
        const { data: routeRows, error: routeErr } = await supabase
          .from('routes')
          .select('*')
          .eq('active', true)
          .order('sort_order')

        if (routeErr) return

        const { data: pinRows } = await supabase.from('pins').select('*').eq('active', true).order('sort_order')

        console.log('[DEBUG] Supabase data loaded:')
        console.log('  routeRows:', routeRows?.length || 0)
        console.log('  pinRows:', pinRows?.length || 0)
        if (pinRows && pinRows.length > 0) {
          const route1Pins = pinRows.filter(p => p.route_id && routeRows?.find(r => r.slug === 'route-1' && r.id === p.route_id))
          console.log('  route-1 pins from Supabase:', route1Pins.length)
        }

        const merged = mergeRoutes(routeRows as RouteRow[] | null, pinRows as PinRow[] | null)

        console.log('[DEBUG] Merged routes:')
        merged.forEach(r => {
          console.log(`  ${r.slug}: ${r.pins.length} pins`)
        })

        if (!cancelled) {
          setRoutes(merged)
          setSource(routeRows?.length ? 'merged' : 'local')
        }
      } catch (e) {
        console.warn('Using local routes', e)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return { routes, source }
}
