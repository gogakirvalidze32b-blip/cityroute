import { describe, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import { examRoadTrace } from '@/lib/pin-route-line'
import type { LatLng } from '@/lib/gps'

const SLUGS = ['route-1', 'route-2', 'route-3', 'route-4'] as const

const ROUTES = applyRelocatedPin(TELAVI_ROUTES_FALLBACK)

function nearestU(road: LatLng[], p: LatLng) {
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

describe('DIAG3', () => {
  it('nearest u per pin (no monotonic constraint)', () => {
    for (const slug of SLUGS) {
      const route = ROUTES.find((r) => r.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const road = examRoadTrace(slug, pins)!
      console.log(`##### ${slug} road=${road.length} #####`)
      const us: number[] = []
      for (const pin of pins) {
        const n = nearestU(road, [pin.lat, pin.lng])
        us.push(n.u)
        console.log(
          `  pin #${String(pin.sort_order).padStart(2)} nearestU=${n.u.toFixed(1)} d=${n.d.toFixed(1)}m`,
        )
      }
      // monotonic increasing?
      let inc = true
      let dec = true
      for (let i = 1; i < us.length; i += 1) {
        if (us[i] < us[i - 1]) inc = false
        if (us[i] > us[i - 1]) dec = false
      }
      console.log(`  monotonicInc=${inc} monotonicDec=${dec} first=${us[0].toFixed(1)} last=${us[us.length - 1].toFixed(1)}`)
      // Is road[0] close to the LAST pin, and road[last] close to the FIRST pin?
      const lastPin = pins[pins.length - 1]
      const firstPin = pins[0]
      const d0last = nearestU([road[0]], [lastPin.lat, lastPin.lng]).d
      const dLastFirst = nearestU([road[road.length - 1]], [firstPin.lat, firstPin.lng]).d
      console.log(`  road[0] vs lastPin ~${d0last.toFixed(0)}m ; road[end] vs firstPin ~${dLastFirst.toFixed(0)}m`)
      console.log(`  road[0]=${JSON.stringify(road[0])} road[end]=${JSON.stringify(road[road.length - 1])}`)
      console.log(`  firstPin=${JSON.stringify([firstPin.lat, firstPin.lng])} lastPin=${JSON.stringify([lastPin.lat, lastPin.lng])}`)
    }
  })
})
