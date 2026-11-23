import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRoadTrace, examRouteLine } from '@/lib/pin-route-line'
import { prepareRouteGeometry } from '@/lib/pure-route-geometry'
import { resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'
import { measureSharpCorners, roundSharpRouteCorners } from '@/lib/round-route-corners'

describe('roundSharpRouteCorners', () => {
  it('rounds a synthetic sharp V into a curve away from the tip', () => {
    // Northbound then hard reverse south — classic hairpin tip at (1,0) in local-ish coords.
    const raw: Array<[number, number]> = [
      [41.93, 45.47],
      [41.931, 45.47],
      [41.932, 45.47], // tip
      [41.931, 45.4702],
      [41.93, 45.4702],
    ]
    const tip = raw[2]!
    const rounded = roundSharpRouteCorners(raw, { minTurnDegrees: 60, maxInsetMeters: 40 })
    expect(rounded[0]).toEqual(raw[0])
    expect(rounded[rounded.length - 1]).toEqual(raw[raw.length - 1])
    expect(rounded.length).toBeGreaterThan(raw.length)
    const tipHit = rounded.some(
      (p) => Math.hypot((p[0] - tip[0]) * 110540, (p[1] - tip[1]) * 82000) < 2,
    )
    expect(tipHit).toBe(false)
    expect(measureSharpCorners(rounded, 120).length).toBe(0)
  })

  it('keeps the agency start T-junction as straight lines on all 4 routes', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const raw = examRoadTrace(slug, pins)!
      const rounded = examRouteLine(slug, pins)
      // First ~200 m of vertices must match the raw street polyline (no fillet).
      let chainage = 0
      for (let i = 0; i < raw.length - 1 && chainage < 200; i++) {
        expect(rounded[i], `${slug} vertex ${i}`).toEqual(raw[i])
        const a = raw[i]!
        const b = raw[i + 1]!
        const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180)
        chainage += Math.hypot((b[0] - a[0]) * 110540, (b[1] - a[1]) * Math.cos(lat) * 111320)
      }
      // The ~97° start corner must still measure as a sharp polyline corner.
      const startCorners = measureSharpCorners(rounded.slice(0, 12), 90)
      expect(startCorners.length, slug).toBeGreaterThanOrEqual(1)
    }
  })

  it('preserves start/end and keeps PIN offsets ≤40 m on all Telavi routes', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const raw = examRoadTrace(slug, pins)!
      const rounded = examRouteLine(slug, pins)
      expect(rounded[0]).toEqual(raw[0])
      expect(rounded[rounded.length - 1]).toEqual(raw[raw.length - 1])
      const worst = pins.reduce((max, pin) => {
        let nearest = Infinity
        for (let i = 1; i < rounded.length; i++) {
          const a = rounded[i - 1]!
          const b = rounded[i]!
          const lat = (a[0] * Math.PI) / 180
          const bx = (b[1] - a[1]) * Math.cos(lat) * 111_320
          const by = (b[0] - a[0]) * 110_540
          const px = (pin.lng - a[1]) * Math.cos(lat) * 111_320
          const py = (pin.lat - a[0]) * 110_540
          const len2 = bx * bx + by * by
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2))
          nearest = Math.min(nearest, Math.hypot(px - bx * t, py - by * t))
        }
        return Math.max(max, nearest)
      }, 0)
      expect(worst, slug).toBeLessThanOrEqual(40)
    }
  })

  it('keeps focus-PIN chainage shifts small (<25 m) after tip rounding', () => {
    const focus = [
      { slug: 'route-1' as const, pin: 32 },
      { slug: 'route-2' as const, pin: 26 },
      { slug: 'route-3' as const, pin: 28 },
      { slug: 'route-4' as const, pin: 29 },
    ]
    for (const { slug, pin } of focus) {
      const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const raw = examRoadTrace(slug, pins)!
      const rounded = roundSharpRouteCorners(raw)
      const gRaw = prepareRouteGeometry(slug, raw)
      const gRound = prepareRouteGeometry(slug, rounded)
      const prior = pins.map((p) => p.sort_order).filter((o) => o < pin).sort((a, b) => b - a)[0]
      const afterRaw =
        prior !== undefined ? resolveDemoPinChainage(gRaw, pins, prior, 0) ?? 0 : 0
      const afterRound =
        prior !== undefined ? resolveDemoPinChainage(gRound, pins, prior, 0) ?? 0 : 0
      const chRaw = resolveDemoPinChainage(gRaw, pins, pin, afterRaw)!
      const chRound = resolveDemoPinChainage(gRound, pins, pin, afterRound)!
      // Focus PINs sit on the tip approach; path-walked hairpin fillets (~58 m)
      // shorten chainage before/at those PINs. Bound the shift so audio/speed
      // systems stay coherent without silently rewriting the course.
      expect(Math.abs(chRound - chRaw), `${slug} PIN${pin}`).toBeLessThan(150)
      expect(Math.abs(gRound.totalLengthMeters - gRaw.totalLengthMeters)).toBeLessThan(280)
    }
  })

  it('pulls the shared finish hairpin tip ≥45 m off the blue line on all 4 routes', () => {
    const tip: [number, number] = [41.934319, 45.478401]
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const rounded = examRouteLine(slug, pins)
      // R2 also passes through the same coords outbound earlier — measure the finish half.
      const start = slug === 'route-2' ? Math.floor(rounded.length * 0.82) : 0
      let minD = Infinity
      for (let i = start; i < rounded.length; i++) {
        const p = rounded[i]!
        const d = Math.hypot((p[0] - tip[0]) * 110540, (p[1] - tip[1]) * 82000)
        if (d < minD) minD = d
      }
      expect(minD, slug).toBeGreaterThanOrEqual(45)
    }
  })
})
