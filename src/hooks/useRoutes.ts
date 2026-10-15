import { useEffect, useState } from 'react'
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyLocalTbilisiTestPin } from '@/data/local-tbilisi-test-pin'
import type { PinRow, RouteRow, RouteWithPins } from '@/types/database'
import auditedPins from '@/data/audio-audit-pins.fixture.json'

const AUDITED_INSTRUCTION = new Map<string, string>(
  (auditedPins as Array<{ route: number; pin: number; instruction: string }>).map((pin) => [
    `${pin.route}:${pin.pin}`,
    pin.instruction,
  ]),
)

/**
 * Pin 2 on routes 1, 3 and 4 is stored at 41.931052, 45.476154.
 * Do not rewrite that point back to 41.930785, 45.475972.
 */
export function applyRelocatedPin<T extends { slug: string; pins: PinRow[] }>(routes: T[]): T[] {
  return routes
}

/**
 * The exam speaks the audited phrase for each route PIN.
 * Only instruction text changes. Coordinates, order, and trigger distance stay as stored.
 */
export function applyAuditedPinInstructions<T extends { slug: string; pins: PinRow[] }>(routes: T[]): T[] {
  return routes.map((route) => {
    const routeNumber = /^route-(\d+)$/.exec(route.slug)?.[1]
    if (!routeNumber) return route
    return {
      ...route,
      pins: route.pins.map((pin) => {
        const instruction = AUDITED_INSTRUCTION.get(`${routeNumber}:${pin.sort_order}`)
        if (!instruction || instruction === pin.instruction_ka) return pin
        return { ...pin, instruction_ka: instruction }
      }),
    }
  })
}

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
  const [routes, setRoutes] = useState<RouteWithPins[]>(() =>
    applyRelocatedPin(applyAuditedPinInstructions(applyLocalTbilisiTestPin(TELAVI_ROUTES_FALLBACK))),
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
          setRoutes(applyRelocatedPin(applyAuditedPinInstructions(applyLocalTbilisiTestPin(merged))))
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
