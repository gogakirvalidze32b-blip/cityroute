import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRoadTrace, examRouteLine, maxPinOffsetFromLineM, pinRouteLine } from '@/lib/pin-route-line'

describe('production street line for Telavi routes 1–4', () => {
  it('keeps route 1 official pins and route 4 audited pins', () => {
    expect(TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-1')!.pins.length).toBeGreaterThan(1)
    expect(TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-4')!.pins).toHaveLength(32)
  })

  it.each([
    ['route-1', 35],
    ['route-2', 29],
    ['route-3', 31],
    ['route-4', 32],
  ] as const)('%s local pins follow the street trace in pin order', (slug, count) => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const line = examRouteLine(slug, pins)
    expect(pins).toHaveLength(count)
    expect(pins.map((pin) => pin.sort_order)).toEqual(Array.from({ length: count }, (_, index) => index + 1))
    expect(line).toEqual(examRoadTrace(slug, pins))
    expect(line.length).toBeGreaterThan(pinRouteLine(pins).length)
    expect(maxPinOffsetFromLineM(pins.map((pin) => [pin.lat, pin.lng]), line)).toBeLessThanOrEqual(40)
  })

  it('keeps route 1 on Rustaveli between #20 and #21 (no Leonidze north zig-zag)', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const line = examRouteLine('route-1', pins)
    const p20 = pins.find((p) => p.sort_order === 20)!
    const p21 = pins.find((p) => p.sort_order === 21)!
    const near = (pin: { lat: number; lng: number }) => {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < line.length; i++) {
        const d = Math.hypot((line[i][0] - pin.lat) * 110540, (line[i][1] - pin.lng) * 82000)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best
    }
    const lo = Math.min(near(p20), near(p21))
    const hi = Math.max(near(p20), near(p21))
    const segment = line.slice(lo, hi + 1)
    expect(segment.length).toBeGreaterThan(2)
    expect(Math.max(...segment.map((p) => p[0]))).toBeLessThan(41.9185)
  })

  it('does not backtrack south onto Amirejibi between route 1 #24 and #25', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const line = examRouteLine('route-1', pins)
    const near = (pin: { lat: number; lng: number }) => {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < line.length; i++) {
        const d = Math.hypot((line[i][0] - pin.lat) * 110540, (line[i][1] - pin.lng) * 82000)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best
    }
    const p24 = pins.find((p) => p.sort_order === 24)!
    const p25 = pins.find((p) => p.sort_order === 25)!
    const lo = Math.min(near(p24), near(p25))
    const hi = Math.max(near(p24), near(p25))
    const segment = line.slice(lo, hi + 1)
    expect(segment.length).toBeGreaterThan(2)
    // Chabua Amirejibi south spur was ~41.9166; keep the westbound corridor north of that.
    expect(Math.min(...segment.map((p) => p[0]))).toBeGreaterThanOrEqual(41.9170)
    // First-fix Alazani corridor must still skip the #17 U-turn spur.
    const p16 = pins.find((p) => p.sort_order === 16)!
    const p18 = pins.find((p) => p.sort_order === 18)!
    const aLo = Math.min(near(p16), near(p18))
    const aHi = Math.max(near(p16), near(p18))
    const alazani = line.slice(aLo, aHi + 1)
    let maxWestRetreat = 0
    for (let i = 1; i < alazani.length; i++) {
      maxWestRetreat = Math.max(maxWestRetreat, alazani[0][1] - alazani[i][1])
    }
    expect(maxWestRetreat).toBeLessThan(0.0004)
  })

  it('does not U-turn past route 1 #17 on the Alazani approach (#16→#18 corridor)', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const line = examRouteLine('route-1', pins)
    const p16 = pins.find((p) => p.sort_order === 16)!
    const p18 = pins.find((p) => p.sort_order === 18)!
    const near = (pin: { lat: number; lng: number }) => {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < line.length; i++) {
        const d = Math.hypot((line[i][0] - pin.lat) * 110540, (line[i][1] - pin.lng) * 82000)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best
    }
    const lo = Math.min(near(p16), near(p18))
    const hi = Math.max(near(p16), near(p18))
    const segment = line.slice(lo, hi + 1)
    // Outbound corridor should progress east without a long west retreat back to #16.
    let maxWestRetreat = 0
    for (let i = 1; i < segment.length; i++) {
      const retreat = segment[0][1] - segment[i][1]
      if (retreat > maxWestRetreat) maxWestRetreat = retreat
    }
    expect(maxWestRetreat).toBeLessThan(0.0004) // ~33m of longitude
    expect(maxPinOffsetFromLineM([[pins.find((p) => p.sort_order === 17)!.lat, pins.find((p) => p.sort_order === 17)!.lng]], segment)).toBeLessThanOrEqual(40)
  })
})
