import { describe, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import { examRoadTrace } from '@/lib/pin-route-line'
import { resolveSpeedLimit } from '@/lib/speed-limit'
import type { LatLng } from '@/lib/gps'

const ROUTES = applyRelocatedPin(TELAVI_ROUTES_FALLBACK)

const M_PER_DEG_LAT = 110_540
const mPerDegLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

function rawU(point: LatLng, road: readonly LatLng[]): { u: number; d: number } {
  let best = { u: 0, d: Infinity }
  for (let i = 0; i < road.length - 1; i += 1) {
    const a = road[i]
    const b = road[i + 1]
    const kx = mPerDegLng(a[0])
    const bx = (b[1] - a[1]) * kx
    const by = (b[0] - a[0]) * M_PER_DEG_LAT
    const px = (point[1] - a[1]) * kx
    const py = (point[0] - a[0]) * M_PER_DEG_LAT
    const len2 = bx * bx + by * by
    const raw = len2 === 0 ? 0 : (px * bx + py * by) / len2
    const t = Math.max(0, Math.min(1, raw))
    const d = Math.hypot(px - bx * t, py - by * t)
    if (d < best.d) best = { u: i + t, d }
  }
  return best
}

describe('DIAG5', () => {
  it('raw projections per pin', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      const route = ROUTES.find((r) => r.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const road = examRoadTrace(slug, pins)!
      const first = road[0]
      const last = road[road.length - 1]
      const gapM = Math.hypot(
        (last[0] - first[0]) * M_PER_DEG_LAT,
        (last[1] - first[1]) * mPerDegLng(first[0]),
      )
      console.log(`##### ${slug} road=${road.length} gapFirstLast=${gapM.toFixed(1)}m #####`)
      for (const pin of pins) {
        const p: LatLng = [pin.lat, pin.lng]
        const { u, d } = rawU(p, road)
        const limitNoU = resolveSpeedLimit(slug, p, road, null)
        console.log(
          `  pin#${String(pin.sort_order).padStart(2)} u=${u.toFixed(1)} d=${d.toFixed(1)}m limitNoU=${limitNoU}`,
        )
      }
    }
  })
})
