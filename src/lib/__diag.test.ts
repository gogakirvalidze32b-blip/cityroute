import { describe, it } from 'vitest'
import { SPEED_ZONES } from '@/data/speed-limits'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import { examRoadTrace } from '@/lib/pin-route-line'
import { roadPointAt } from '@/lib/speed-limit'
import type { LatLng } from '@/lib/gps'

const SLUGS = ['route-1', 'route-2', 'route-3', 'route-4'] as const

const ROUTES = applyRelocatedPin(TELAVI_ROUTES_FALLBACK)
const DATA = Object.fromEntries(
  SLUGS.map((slug) => {
    const route = ROUTES.find((item) => item.slug === slug)!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    return [slug, { pins, road: examRoadTrace(slug, pins)! }]
  }),
) as Record<string, { pins: any[]; road: LatLng[] }>

const M_LAT = 110_540
const mLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)
const metres = (a: LatLng, b: LatLng) =>
  Math.hypot((b[1] - a[1]) * mLng(a[0]), (b[0] - a[0]) * M_LAT)

/** Nearest point on the whole road line to `p`, returns {d, u}. */
function nearestOnRoad(road: LatLng[], p: LatLng) {
  let best = { d: Infinity, u: 0 }
  for (let i = 0; i < road.length - 1; i += 1) {
    const a = road[i]
    const b = road[i + 1]
    const lat = (a[0] * Math.PI) / 180
    const bx = (b[1] - a[1]) * Math.cos(lat) * 111_320
    const by = (b[0] - a[0]) * 110_540
    const px = (p[1] - a[1]) * Math.cos(lat) * 111_320
    const py = (p[0] - a[0]) * 110_540
    const len2 = bx * bx + by * by
    const raw = len2 === 0 ? 0 : (px * bx + py * by) / len2
    const t = Math.max(0, Math.min(1, raw))
    const d = Math.hypot(px - bx * t, py - by * t)
    if (d < best.d) best = { d, u: i + t }
  }
  return best
}

describe('DIAGNOSTIC', () => {
  it('zone u-range vs anchors vs pins', () => {
    for (const slug of SLUGS) {
      const { pins, road } = DATA[slug]
      console.log(`\n########## ${slug} (road ${road.length} verts, ${pins.length} pins) ##########`)
      const zones = SPEED_ZONES[slug] ?? []
      for (const zone of zones) {
        const fromPoint = roadPointAt(road, zone.from)
        const toPoint = roadPointAt(road, zone.to)
        const nFrom = nearestOnRoad(road, zone.anchors[0])
        const nTo = nearestOnRoad(road, zone.anchors[1])
        const zoneLen = metres(fromPoint, toPoint)
        // pin u values
        const pinInfo = zone.pins
          .map((sortOrder) => {
            const pin = pins.find((p) => p.sort_order === sortOrder)
            if (!pin) return `#${sortOrder}=MISSING`
            const n = nearestOnRoad(road, [pin.lat, pin.lng])
            return `#${sortOrder} u=${n.u.toFixed(1)} d=${n.d.toFixed(1)}m`
          })
          .join(' | ')
        console.log(
          `${zone.id} [${zone.limitKmh}] u ${zone.from.toFixed(1)}..${zone.to.toFixed(1)} (len ${zoneLen.toFixed(0)}m)`,
        )
        console.log(
          `   anchor1 u=${nFrom.u.toFixed(1)} d=${nFrom.d.toFixed(1)}m | anchor2 u=${nTo.u.toFixed(1)} d=${nTo.d.toFixed(1)}m`,
        )
        console.log(
          `   in-range? a1=${nFrom.u >= zone.from - 0.35 && nFrom.u <= zone.to + 0.35} a2=${nTo.u >= zone.from - 0.35 && nTo.u <= zone.to + 0.35}`,
        )
        console.log(`   pins: ${pinInfo}`)
      }
    }
  })
})
