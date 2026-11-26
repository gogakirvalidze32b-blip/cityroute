import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import type { LatLng } from '@/lib/gps'
import {
  examMapRouteLines,
  examRoadTrace,
  examRouteLine,
  maxPinOffsetFromLineM,
  pinRouteLine,
} from '@/lib/pin-route-line'
import { measureSharpCorners, roundSharpRouteCorners } from '@/lib/round-route-corners'

describe('production street line for Telavi routes 1–4', () => {
  it('keeps route 1 official pins and route 4 audited pins', () => {
    expect(TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-1')!.pins.length).toBeGreaterThan(1)
    expect(TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-4')!.pins).toHaveLength(32)
  })

  it('sets the 15 m radius for Route 1, 3 and 4 PIN 2 only', () => {
    for (const slug of ['route-1', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const pin = route.pins.find((item) => item.sort_order === 2)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const line = examRouteLine(slug, pins)

      expect(pin.lat).toBe(41.931121)
      expect(pin.lng).toBe(45.476190)
      expect(pin.radius_m).toBe(15)
      expect(pin.trigger_distance_m).toBe(50)
      expect(maxPinOffsetFromLineM([[pin.lat, pin.lng]], line)).toBeLessThanOrEqual(1)
    }
    const route2 = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    expect(route2.pins.find((item) => item.sort_order === 2)?.radius_m).toBe(25)
  })

  it.each([
    ['route-1', 35],
    ['route-2', 29],
    ['route-3', 30],
    ['route-4', 32],
  ] as const)('%s local pins follow the street trace in pin order', (slug, count) => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const line = examRouteLine(slug, pins)
    expect(pins).toHaveLength(count)
    expect(pins.map((pin) => pin.sort_order)).toEqual(
      slug === 'route-3'
        ? [...Array.from({ length: 11 }, (_, index) => index + 1), ...Array.from({ length: 19 }, (_, index) => index + 13)]
        : Array.from({ length: count }, (_, index) => index + 1),
    )
    expect(line).toEqual(
      slug === 'route-3'
        ? examRouteLine('route-3', pins)
        : slug === 'route-4'
        ? examMapRouteLines(slug, pins)[0]
        : roundSharpRouteCorners(examRoadTrace(slug, pins)!),
    )
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

  it('turns through the eastern roundabout between route 1 #22 and #24 before coming back west', () => {
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
    const p22 = pins.find((p) => p.sort_order === 22)!
    const p24 = pins.find((p) => p.sort_order === 24)!
    const lo = Math.min(near(p22), near(p24))
    const hi = Math.max(near(p22), near(p24))
    const segment = line.slice(lo, hi + 1)
    expect(segment.length).toBeGreaterThan(8)
    // Must enter the roundabout ring (east of the approach pins), not reverse early.
    expect(Math.max(...segment.map((p) => p[1]))).toBeGreaterThan(45.4855)
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

  it('has no U-turn spur on route 2 between #2 and #3', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    // Spur removal lives in the raw road trace; rounding only fillets corners on top.
    const raw = examRoadTrace('route-2', pins)!
    const line = examRouteLine('route-2', pins)
    const expectedSegment = [
      [41.93107, 45.476158],
      [41.93099, 45.47611],
      [41.93091, 45.47606],
      [41.93079, 45.47598],
      [41.93067, 45.4759],
      [41.93064, 45.47599],
      [41.93061, 45.47608],
      [41.930825, 45.47622],
      [41.93104, 45.47636],
      [41.93142, 45.476595],
      [41.9318, 45.47683],
      [41.93187, 45.476875],
      [41.93194, 45.47692],
    ]
    const near = (path: readonly [number, number][], pin: { lat: number; lng: number }) => {
      let best = 0
      let bestD = Infinity
      for (let i = 0; i < path.length; i++) {
        const d = Math.hypot((path[i]![0] - pin.lat) * 110540, (path[i]![1] - pin.lng) * 82000)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      return best
    }
    const p2 = pins.find((p) => p.sort_order === 2)!
    const p3 = pins.find((p) => p.sort_order === 3)!
    const start = Math.max(0, near(raw as [number, number][], p2) - 1)
    const segment = raw.slice(start, start + expectedSegment.length)
    expect(segment).toEqual(expectedSegment)
    expect(
      maxPinOffsetFromLineM(
        [
          [p2.lat, p2.lng],
          [p3.lat, p3.lng],
        ],
        line,
      ),
    ).toBeLessThanOrEqual(10)
    expect(maxPinOffsetFromLineM(pins.map((pin) => [pin.lat, pin.lng]), line)).toBeLessThanOrEqual(40)
  })

  it('uses the exact Route 2 PIN 3 GeoJSON segment on the map only', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const raw = examRoadTrace('route-2', pins)!
    const pin3 = pins.find((pin) => pin.sort_order === 3)!
    const pin24 = pins.find((pin) => pin.sort_order === 24)!
    const pin26 = pins.find((pin) => pin.sort_order === 26)!
    const mapLine = examMapRouteLines('route-2', pins)[0]!
    const navigationLine = examRouteLine('route-2', pins)
    const defaultMapLine = roundSharpRouteCorners(raw)
    const exactSegment: LatLng[] = [
      [41.930940, 45.476079],
      [41.930672, 45.475908],
      [41.930613, 45.476089],
      [41.930878, 45.476258],
    ]

    expect(mapLine).not.toEqual(navigationLine)
    expect(navigationLine).toEqual(defaultMapLine)
    expect(mapLine[0]).toEqual(raw[0])
    expect(mapLine.at(-1)).toEqual(raw.at(-1))
    expect(mapLine).toEqual([
      ...defaultMapLine.slice(0, 5),
      ...exactSegment,
      ...defaultMapLine.slice(11),
    ])
    expect(
      maxPinOffsetFromLineM(
        [
          [pin3.lat, pin3.lng],
          [pin24.lat, pin24.lng],
        ],
        mapLine,
      ),
    ).toBeLessThanOrEqual(25)
    expect(maxPinOffsetFromLineM([[pin3.lat, pin3.lng]], exactSegment)).toBeLessThan(0.05)
    const nearPin26 = (point: LatLng) =>
      Math.hypot((point[0] - pin26.lat) * 110540, (point[1] - pin26.lng) * 82000) <= 120
    expect(mapLine.filter(nearPin26)).toEqual(defaultMapLine.filter(nearPin26))
  })

  it('keeps other map lines unchanged and separates the Route 3 Alazani carriageways', () => {
    const route1 = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    const route1Pins = [...route1.pins].sort((a, b) => a.sort_order - b.sort_order)
    expect(examMapRouteLines('route-1', route1Pins)).toEqual([
      examRouteLine('route-1', route1Pins),
    ])

    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const raw = examRoadTrace('route-3', pins)!
    const mapLines = examMapRouteLines('route-3', pins)
    const pin6 = pins.find((pin) => pin.sort_order === 6)!

    expect(mapLines).toHaveLength(2)
    expect(raw[38]).toEqual([41.924773, 45.472255])
    expect(raw[39]).toEqual([41.924748, 45.472457])
    expect(mapLines[0]!.slice(-2)).toEqual(raw.slice(37, 39))
    expect(mapLines[1]!.slice(0, 2)).toEqual(raw.slice(39, 41))
    expect(maxPinOffsetFromLineM(
      [[pins.find((pin) => pin.sort_order === 25)!.lat, pins.find((pin) => pin.sort_order === 25)!.lng]],
      examRouteLine('route-3', pins),
    )).toBe(0)
    expect(maxPinOffsetFromLineM(
      [[pins.find((pin) => pin.sort_order === 26)!.lat, pins.find((pin) => pin.sort_order === 26)!.lng]],
      examRouteLine('route-3', pins),
    )).toBe(0)
    const pin25 = pins.find((pin) => pin.sort_order === 25)!
    const pin26 = pins.find((pin) => pin.sort_order === 26)!
    expect(pin25.lat).toBe(41.929207)
    expect(pin25.lng).toBe(45.475204)
    const route3Line = examRouteLine('route-3', pins)
    const pin25Index = route3Line.findIndex(
      (point) => point[0] === pin25.lat && point[1] === pin25.lng,
    )
    const pin26Index = route3Line.findIndex(
      (point) => point[0] === pin26.lat && point[1] === pin26.lng,
    )
    expect(pin25Index).toBeGreaterThanOrEqual(0)
    expect(pin26Index).toBe(pin25Index + 1)
    const mapFinishLine = examMapRouteLines('route-3', pins)[1]!
    const mapPin25Index = mapFinishLine.findIndex(
      (point) => point[0] === pin25.lat && point[1] === pin25.lng,
    )
    expect(mapFinishLine[mapPin25Index + 1]).toEqual([pin26.lat, pin26.lng])
    expect(
      maxPinOffsetFromLineM(
        [[pin6.lat, pin6.lng]],
        examRouteLine('route-3', pins),
      ),
    ).toBeLessThanOrEqual(1)

    const bearing = (from: LatLng, to: LatLng) => {
      const meanLat = ((from[0] + to[0]) / 2) * (Math.PI / 180)
      const east = (to[1] - from[1]) * Math.cos(meanLat)
      const north = to[0] - from[0]
      return (Math.atan2(east, north) * 180) / Math.PI
    }
    const firstBearing = bearing(raw[37]!, raw[38]!)
    const secondBearing = bearing(raw[39]!, raw[40]!)
    const bearingDifference = Math.abs(((firstBearing - secondBearing + 540) % 360) - 180)
    expect(bearingDifference).toBeLessThan(20)
  })

  it('aligns the Route 4 PIN 13 curve across map and navigation', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-4')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    const raw = examRoadTrace('route-4', pins)!
    const pin13 = pins.find((pin) => pin.sort_order === 13)!
    const mapLine = examMapRouteLines('route-4', pins)[0]!
    const navigationLine = examRouteLine('route-4', pins)

    expect(mapLine).toEqual(navigationLine)
    expect(mapLine[0]).toEqual(raw[0])
    expect(mapLine.at(-1)).toEqual(raw.at(-1))
    expect(mapLine).toContainEqual([pin13.lat, pin13.lng])
    expect(maxPinOffsetFromLineM([[pin13.lat, pin13.lng]], mapLine)).toBe(0)
  })

  it('map lines keep the full exam geometry (no finish trim)', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const lines = examMapRouteLines(slug, pins)
      expect(lines).toHaveLength(slug === 'route-3' ? 2 : 1)
      expect(lines[0]![0]).toEqual(examRouteLine(slug, pins)[0])
      expect(lines.at(-1)?.at(-1)).toEqual(examRouteLine(slug, pins).at(-1))
    }
  })

  it('rounds the shared finish-corridor U-tip on all four routes', () => {
    const tip = { lat: 41.934319, lng: 45.478401 }
    const distTip = (p: readonly [number, number]) =>
      Math.hypot((p[0] - tip.lat) * 110540, (p[1] - tip.lng) * 82000)
    /** Finish-corridor pass only (outbound may still traverse the same plaza point). */
    const nearTipInTail = (line: readonly [number, number][]) => {
      const start = Math.floor(line.length * 0.82)
      let best = Infinity
      for (let i = start; i < line.length; i++) best = Math.min(best, distTip(line[i]!))
      return best
    }
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
      const raw = examRoadTrace(slug, pins)!
      const rounded = examRouteLine(slug, pins)
      expect(nearTipInTail(raw as [number, number][])).toBeLessThan(3)
      expect(nearTipInTail(rounded as [number, number][])).toBeGreaterThan(45)
      // Finish tip must not remain an ultra-sharp V (≥140°) after rounding.
      const tipSharps = measureSharpCorners(rounded, 140).filter(
        (c) => Math.hypot((c.lat - tip.lat) * 110540, (c.lng - tip.lng) * 82000) < 40,
      )
      expect(tipSharps.length).toBe(0)
    }
  })
})
