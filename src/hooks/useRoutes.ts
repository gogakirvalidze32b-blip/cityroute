import { useEffect, useState } from 'react'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import type { PinRow, RouteRow, RouteWithPins } from '@/types/database'

/**
 * Merge Supabase metadata (id, pins) but NEVER remote polyline coordinates.
 * route-polylines.ts / TELAVI_ROUTES_FALLBACK is the source of truth for map geometry —
 * Supabase routes.polyline is legacy and must not override bundled OSRM paths.
 */
function mergeRoutes(remoteRows: RouteRow[] | null, pinRows: PinRow[] | null): RouteWithPins[] {
  if (!remoteRows?.length) return TELAVI_ROUTES_FALLBACK

  return TELAVI_ROUTES_FALLBACK.map((local) => {
    const remote = remoteRows.find((r) => r.slug === local.slug)
    if (!remote) return local
    const remotePins = (pinRows ?? []).filter((p) => p.route_id === remote.id)
    return {
      ...local,
      id: remote.id,
      city_id: remote.city_id,
      polyline: local.polyline,
      pins: local.pins.length === 0 ? [] : remotePins.length >= 2 ? remotePins : local.pins,
    }
  })
}

export function useRoutes() {
  const [routes, setRoutes] = useState<RouteWithPins[]>(TELAVI_ROUTES_FALLBACK)
  const [source, setSource] = useState<'local' | 'merged'>('local')

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

        const merged = mergeRoutes(routeRows as RouteRow[] | null, pinRows as PinRow[] | null)
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
