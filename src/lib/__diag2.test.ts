import { describe, it } from 'vitest'
import { SPEED_ZONES } from '@/data/speed-limits'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import { examRoadTrace } from '@/lib/pin-route-line'
import { advanceRoadProgressU, resolveSpeedLimit, resolveSpeedZone } from '@/lib/speed-limit'
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

/** All places on the road line where `p` is within 12 m. */
function occurrencesOnRoad(road: LatLng[], p: LatLng) {
  const found: { u: number; d: number }[] = []
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
    if (d <= 12) found.push({ u: i + t, d })
  }
  const merged: { u: number; d: number }[] = []
  for (const f of found) {
    const last = merged[merged.length - 1]
    if (last && f.u - last.u < 1.5) {
      if (f.d < last.d) merged[merged.length - 1] = f
    } else merged.push(f)
  }
  return merged
}

function roadPointAtLocal(road: LatLng[], u: number): LatLng {
  const i = Math.min(Math.max(Math.floor(u), 0), road.length - 2)
  const t = u - i
  return [
    road[i][0] + (road[i + 1][0] - road[i][0]) * t,
    road[i][1] + (road[i + 1][1] - road[i][1]) * t,
  ]
}

describe('DIAGNOSTIC', () => {
  it('anchor occurrences', () => {
    for (const slug of SLUGS) {
      const { road } = DATA[slug]
      console.log(`##### ${slug} road=${road.length} #####`)
      for (const zone of SPEED_ZONES[slug] ?? []) {
        const a1 = occurrencesOnRoad(road, zone.anchors[0])
        const a2 = occurrencesOnRoad(road, zone.anchors[1])
        const fmt = (l: { u: number; d: number }[]) =>
          l.map((x) => `u=${x.u.toFixed(1)}(${x.d.toFixed(1)}m)`).join(', ')
        console.log(
          `${zone.id} [${zone.limitKmh}] range ${zone.from.toFixed(1)}..${zone.to.toFixed(1)} | a1 ${fmt(a1)} | a2 ${fmt(a2)}`,
        )
      }
    }
  })

  it('simulated drive', () => {
    for (const slug of SLUGS) {
      const { pins, road } = DATA[slug]
      const zones = SPEED_ZONES[slug] ?? []
      console.log(`##### ${slug} drive #####`)
      let u: number | null = null
      for (const pin of pins) {
        const pos: LatLng = [pin.lat, pin.lng]
        u = advanceRoadProgressU(pos, road, u)
        const limit = resolveSpeedLimit(slug, pos, road, u)
        const match = resolveSpeedZone(slug, pos, road, u)
        const expected = zones.filter((z) => u! >= z.from - 0.35 && u! <= z.to + 0.35)
        console.log(
          `pin #${String(pin.sort_order).padStart(2)} u=${u.toFixed(1)} limit=${limit ?? '-'} zone=${match?.zone.id ?? '-'} off=${match ? match.offsetM.toFixed(1) : '-'}m | byU=[${expected.map((z) => `${z.id}:${z.limitKmh}`).join(',')}]`,
        )
      }
    }
  })

  it('zone coverage', () => {
    for (const slug of SLUGS) {
      const { road } = DATA[slug]
      console.log(`##### ${slug} coverage #####`)
      for (const zone of SPEED_ZONES[slug] ?? []) {
        let ok = 0
        let bad = 0
        let firstBad = ''
        const steps = 200
        for (let k = 0; k <= steps; k += 1) {
          const u = zone.from + ((zone.to - zone.from) * k) / steps
          const point = roadPointAtLocal(road, u)
          const limit = resolveSpeedLimit(slug, point, road, u)
          if (limit === zone.limitKmh) ok += 1
          else {
            bad += 1
            if (!firstBad) firstBad = `u=${u.toFixed(1)} got=${limit ?? '-'} want=${zone.limitKmh}`
          }
        }
        console.log(`${zone.id} [${zone.limitKmh}] ok=${ok} bad=${bad} ${bad ? '| first: ' + firstBad : ''}`)
      }
    }
  })
})
