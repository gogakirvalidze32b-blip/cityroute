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
  if (!remoteRows?.length) {
    console.log('[DEBUG] mergeRoutes: No remote rows, returning TELAVI_ROUTES_FALLBACK')
    return TELAVI_ROUTES_FALLBACK
  }

  return TELAVI_ROUTES_FALLBACK.map((local) => {
    const remote = remoteRows.find((r) => r.slug === local.slug)
    if (!remote) {
      console.log(`[DEBUG] mergeRoutes: ${local.slug} - no remote match, using local (${local.pins.length} pins)`)
      return local
    }
    
    const remotePins = (pinRows ?? []).filter((p) => p.route_id === remote.id)
    console.log(`[DEBUG] mergeRoutes: ${local.slug}:`)
    console.log(`  - local pins: ${local.pins.length}`)
    console.log(`  - remote pins: ${remotePins.length}`)
    console.log(`  - will use: ${remotePins.length >= 2 ? 'remote' : local.pins.length > 0 ? 'local' : 'none'}`)
    
    return {
      ...local,
      id: remote.id,
      city_id: remote.city_id,
      polyline: local.polyline,
      // FIX: Always prefer remote pins if available (>=2), regardless of local pins
      pins: remotePins.length >= 2 ? remotePins : local.pins,
    }
  })
}

export function useRoutes() {
  const [routes, setRoutes] = useState<RouteWithPins[]>(TELAVI_ROUTES_FALLBACK)
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
