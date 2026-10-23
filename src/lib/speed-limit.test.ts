import { describe, expect, it } from 'vitest'
import { SPEED_LIMIT_UNRESOLVED, SPEED_ZONES, type SpeedZone } from '@/data/speed-limits'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import type { LatLng } from '@/lib/gps'
import { examRoadTrace } from '@/lib/pin-route-line'
import { formatSpeed } from '@/lib/route-nav'
import {
  advanceRoadProgressU,
  distanceToSpanM,
  resolveSpeedLimit,
  resolveSpeedZone,
  roadPointAt,
} from '@/lib/speed-limit'
import route2Road from '@/data/route-2-road.json'

const SLUGS = ['route-1', 'route-2', 'route-3', 'route-4'] as const
type Slug = (typeof SLUGS)[number]

const ROUTES = applyRelocatedPin(TELAVI_ROUTES_FALLBACK)
const DATA = Object.fromEntries(
  SLUGS.map((slug) => {
    const route = ROUTES.find((item) => item.slug === slug)!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    return [slug, { pins, road: examRoadTrace(slug, pins)! }]
  }),
) as Record<Slug, { pins: (typeof ROUTES)[number]['pins']; road: LatLng[] }>

const M_LAT = 110_540
const mLng = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)
const metres = (a: LatLng, b: LatLng) => Math.hypot((b[1] - a[1]) * mLng(a[0]), (b[0] - a[0]) * M_LAT)

/** Road positions at roughly `stepM` spacing inside a zone, kept `insetM` away from both ends. */
function samples(slug: Slug, zone: SpeedZone, stepM = 25, insetM = 20): { point: LatLng; u: number }[] {
  const { road } = DATA[slug]
  const out: { point: LatLng; u: number }[] = []
  const n = 400
  let acc = 0
  let prev = roadPointAt(road, zone.from)
  const total = (() => {
    let s = 0
    let p = prev
    for (let k = 1; k <= n; k += 1) {
      const q = roadPointAt(road, zone.from + ((zone.to - zone.from) * k) / n)
      s += metres(p, q)
      p = q
    }
    return s
  })()
  let run = 0
  for (let k = 1; k <= n; k += 1) {
    const u = zone.from + ((zone.to - zone.from) * k) / n
    const q = roadPointAt(road, u)
    const step = metres(prev, q)
    run += step
    acc += step
    if (run >= insetM && run <= total - insetM && acc >= stepM) {
      out.push({ point: q, u })
      acc = 0
    }
    prev = q
  }
  return out
}

/** The point `m` metres to the side of the road at road position `u`. */
function sideOfRoad(slug: Slug, u: number, m: number): LatLng {
  const { road } = DATA[slug]
  const a = roadPointAt(road, u - 0.05)
  const b = roadPointAt(road, u + 0.05)
  const centre = roadPointAt(road, u)
  const dx = (b[1] - a[1]) * mLng(centre[0])
  const dy = (b[0] - a[0]) * M_LAT
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  return [centre[0] + (ny * m) / M_LAT, centre[1] + (nx * m) / mLng(centre[0])]
}

const ALL_ZONES = SLUGS.flatMap((slug) => (SPEED_ZONES[slug] ?? []).map((zone) => ({ slug, zone })))

/** The two separate 30 km/h sections — internal boundary coords, not map markers. */
const SECTION_A = {
  start: [41.925127, 45.456699] as LatLng,
  end: [41.923391, 45.461265] as LatLng,
}
const SECTION_B = {
  start: [41.919246, 45.497309] as LatLng,
  end: [41.918732, 45.492608] as LatLng,
}

describe('speed limit zones are bound to the real road lines', () => {
  it('every route has a street trace and at least one zone', () => {
    for (const slug of SLUGS) {
      expect(DATA[slug].road.length).toBeGreaterThan(2)
      expect(SPEED_ZONES[slug]!.length).toBeGreaterThan(0)
    }
  })

  it('route-2 road has 253 points matching the zone from/to index space', () => {
    expect((route2Road as LatLng[]).length).toBe(253)
    expect(DATA['route-2'].road.length).toBe(253)
  })

  it.each(ALL_ZONES.map(({ slug, zone }) => [zone.id, slug, zone] as const))(
    '%s sits on the coordinates it was built from and on its PINs',
    (_id, slug, zone) => {
      const { road, pins } = DATA[slug]
      expect(zone.from).toBeLessThan(zone.to)
      expect(zone.to).toBeLessThanOrEqual(road.length - 1)
      // Ordinary zones keep the prior 20 m anchor contract. Both-direction 30 km/h zones
      // (maxOffsetM = 30) match the generator's opposite-carriageway projection tolerance.
      const anchorTolM = zone.maxOffsetM >= 30 ? zone.maxOffsetM : 20
      for (const anchor of zone.anchors) {
        expect(distanceToSpanM(anchor as LatLng, road, zone.from - 1, zone.to + 1).d).toBeLessThanOrEqual(
          anchorTolM,
        )
      }
      expect(zone.pins.length).toBeGreaterThan(0)
      for (const number of zone.pins) {
        const pin = pins.find((p) => p.sort_order === number)!
        expect(distanceToSpanM([pin.lat, pin.lng], road, zone.from, zone.to).d).toBeLessThanOrEqual(12)
      }
    },
  )

  it('zones of one route never overlap', () => {
    for (const slug of SLUGS) {
      const zones = [...SPEED_ZONES[slug]!].sort((a, b) => a.from - b.from)
      for (let i = 1; i < zones.length; i += 1) expect(zones[i].from).toBeGreaterThan(zones[i - 1].to)
    }
  })
})

describe('the two 30 km/h sections keep their original boundary coordinates', () => {
  it('Section A boundaries are exactly preserved on r3-2', () => {
    const zone = SPEED_ZONES['route-3']!.find((z) => z.id === 'r3-2')!
    expect(zone.limitKmh).toBe(30)
    expect(zone.anchors[0]).toEqual(SECTION_A.start)
    expect(zone.anchors[1]).toEqual(SECTION_A.end)
    expect(zone.maxOffsetM).toBe(30)
  })

  it('Section B boundaries are exactly preserved on r2-5, r4-4a and r4-4b', () => {
    for (const [slug, id] of [
      ['route-2', 'r2-5'],
      ['route-4', 'r4-4a'],
      ['route-4', 'r4-4b'],
    ] as const) {
      const zone = SPEED_ZONES[slug]!.find((z) => z.id === id)!
      expect(zone.limitKmh).toBe(30)
      expect(zone.anchors[0]).toEqual(SECTION_B.start)
      expect(zone.anchors[1]).toEqual(SECTION_B.end)
      expect(zone.maxOffsetM).toBe(30)
    }
  })

  it('Section A and Section B are separate (not merged or swapped)', () => {
    expect(SECTION_A.start).not.toEqual(SECTION_B.start)
    expect(SECTION_A.end).not.toEqual(SECTION_B.end)
    const a = SPEED_ZONES['route-3']!.find((z) => z.id === 'r3-2')!
    const b = SPEED_ZONES['route-2']!.find((z) => z.id === 'r2-5')!
    expect(a.anchors).not.toEqual(b.anchors)
  })
})

describe('each requested section gets its own limit along its whole length', () => {
  it.each(ALL_ZONES.map(({ slug, zone }) => [zone.id, slug, zone] as const))('%s', (_id, slug, zone) => {
    const { road } = DATA[slug]
    const points = samples(slug, zone)
    expect(points.length).toBeGreaterThan(0)
    for (const { point, u } of points) expect(resolveSpeedLimit(slug, point, road, u)).toBe(zone.limitKmh)
    for (const number of zone.pins) {
      const pin = DATA[slug].pins.find((p) => p.sort_order === number)!
      const midU = (zone.from + zone.to) / 2
      expect(resolveSpeedLimit(slug, [pin.lat, pin.lng], road, midU)).toBe(zone.limitKmh)
    }
  })

  it('the limit changes at the right place between consecutive sections', () => {
    const expected: Record<Slug, number[]> = {
      'route-1': [50],
      'route-2': [40, 60, 50, 30, 50, 40],
      'route-3': [50, 30, 50, 40],
      'route-4': [40, 30, 50, 30, 50],
    }
    for (const slug of SLUGS) {
      const { road } = DATA[slug]
      const zones = [...SPEED_ZONES[slug]!].sort((a, b) => a.from - b.from)
      expect(zones.map((z) => z.limitKmh)).toEqual(expected[slug])
      zones.forEach((zone, index) => {
        const midU = (zone.from + zone.to) / 2
        expect(resolveSpeedLimit(slug, roadPointAt(road, midU), road, midU)).toBe(zone.limitKmh)
        const next = zones[index + 1]
        if (!next) return
        // In the gap between two sections nothing is posted: the sign shows "—", not a neighbour's value.
        const gapU = (zone.to + next.from) / 2
        const gap = roadPointAt(road, gapU)
        const gapM = metres(roadPointAt(road, zone.to), roadPointAt(road, next.from))
        if (gapM > 12) expect(resolveSpeedLimit(slug, gap, road, gapU)).toBeNull()
      })
    }
  })
})

describe('route progress disambiguates revisited streets', () => {
  it('without roadU, a Route 4 outbound/return shared point does not invent a return-pass limit', () => {
    const road = DATA['route-4'].road
    // Midpoint of the u-gap between r4-2 and r4-4b — same coordinates as mid of r4-5 on the return.
    const gapU = (70.1345 + 85.3011) / 2
    const gap = roadPointAt(road, gapU)
    expect(resolveSpeedLimit('route-4', gap, road)).toBeNull()
  })

  it('with outbound roadU the shared point stays unposted; with return roadU it is 50', () => {
    const road = DATA['route-4'].road
    const returnMid = (132.8391 + 146.0358) / 2
    const point = roadPointAt(road, returnMid)
    expect(resolveSpeedLimit('route-4', point, road, 77.72)).toBeNull()
    expect(resolveSpeedLimit('route-4', point, road, returnMid)).toBe(50)
  })

  it('advanceRoadProgressU stays on the current pass across a revisit', () => {
    const road = DATA['route-4'].road
    const outbound = roadPointAt(road, 77.72)
    const u0 = advanceRoadProgressU(outbound, road, null)
    expect(u0).toBeLessThan(100)
    const u1 = advanceRoadProgressU(outbound, road, u0)
    expect(Math.abs(u1 - u0)).toBeLessThan(2)
    const returnPt = roadPointAt(road, 139.4)
    let u = 130
    u = advanceRoadProgressU(returnPt, road, u)
    expect(u).toBeGreaterThan(132)
    expect(resolveSpeedLimit('route-4', returnPt, road, u)).toBe(50)
  })
})

describe('shared streets carry the same limit on every route', () => {
  it('wherever two routes both resolve a limit at the same place, the limits are equal', () => {
    let compared = 0
    for (const { slug, zone } of ALL_ZONES) {
      for (const { point, u } of samples(slug, zone, 15, 20)) {
        for (const other of SLUGS) {
          if (other === slug) continue
          const limit = resolveSpeedLimit(other, point, DATA[other].road)
          if (limit === null) continue
          compared += 1
          expect({ from: slug, zone: zone.id, other, limit }).toEqual({
            from: slug,
            zone: zone.id,
            other,
            limit: zone.limitKmh,
          })
        }
        void u
      }
    }
    expect(compared).toBeGreaterThan(20)
  })

  it('R2 #4/#5/#6 and R4 #3/#4/#5 are the same road with the same limits', () => {
    const pairs: [string, string][] = [
      ['r2-4', 'r4-3'],
      ['r2-5', 'r4-4a'],
      ['r2-6', 'r4-5'],
    ]
    for (const [a, b] of pairs) {
      const za = SPEED_ZONES['route-2']!.find((z) => z.id === a)!
      const zb = SPEED_ZONES['route-4']!.find((z) => z.id === b)!
      expect(za.limitKmh).toBe(zb.limitKmh)
      const ra = DATA['route-2'].road
      const rb = DATA['route-4'].road
      expect(metres(roadPointAt(ra, za.from), roadPointAt(rb, zb.from))).toBeLessThan(2)
      expect(metres(roadPointAt(ra, za.to), roadPointAt(rb, zb.to))).toBeLessThan(2)
    }
  })

  it('R1 #3/#4 and R3 #1/#2 anchors are identical, so they share 50 and 30', () => {
    const r3a = SPEED_ZONES['route-3']!.find((z) => z.id === 'r3-1')!
    const r3b = SPEED_ZONES['route-3']!.find((z) => z.id === 'r3-2')!
    expect([r3a.limitKmh, r3b.limitKmh]).toEqual([50, 30])
  })
})

describe('30 km/h applies in both directions', () => {
  const thirty = ALL_ZONES.filter(({ zone }) => zone.limitKmh === 30)

  it('there are 30 km/h sections on R2, R3 and R4 (both R4 passes)', () => {
    expect(thirty.map(({ zone }) => zone.id).sort()).toEqual(['r2-5', 'r3-2', 'r4-4a', 'r4-4b'])
  })

  it.each(thirty.map(({ slug, zone }) => [zone.id, slug, zone] as const))(
    '%s: on the line, driven forwards, driven backwards and on the opposite carriageway',
    (_id, slug, zone) => {
      const { road } = DATA[slug]
      const line = samples(slug, zone, 15, 20)
      for (const { point, u } of line) expect(resolveSpeedLimit(slug, point, road, u)).toBe(30)
      for (const { point, u } of [...line].reverse()) expect(resolveSpeedLimit(slug, point, road, u)).toBe(30)
      const mid = (zone.from + zone.to) / 2
      expect(resolveSpeedLimit(slug, sideOfRoad(slug, mid, 25), road, mid)).toBe(30)
      expect(resolveSpeedLimit(slug, sideOfRoad(slug, mid, -25), road, mid)).toBe(30)
    },
  )

  it('ordinary (50/40/60) sections do not reach 25 m to the side', () => {
    for (const { slug, zone } of ALL_ZONES.filter(({ zone }) => zone.limitKmh !== 30)) {
      const mid = (zone.from + zone.to) / 2
      const side = sideOfRoad(slug, mid, 25)
      expect(resolveSpeedZone(slug, side, DATA[slug].road, mid)?.zone.id).not.toBe(zone.id)
    }
  })
})

describe('no limit is invented where it cannot be determined', () => {
  it('requested sections that could not be placed on the road line stay empty', () => {
    expect(SPEED_LIMIT_UNRESOLVED.length).toBeGreaterThan(0)
    // R3 on Aghmashenebeli street, R4 circle points 2 and 3, R1 start of #2, R3 #5, the 3 m "#1" section
    expect(resolveSpeedLimit('route-3', roadPointAt(DATA['route-3'].road, 60), DATA['route-3'].road, 60)).toBeNull()
    expect(resolveSpeedLimit('route-4', [41.917026, 45.47657], DATA['route-4'].road)).toBeNull()
    expect(resolveSpeedLimit('route-4', [41.919848, 45.470403], DATA['route-4'].road)).toBeNull()
    expect(resolveSpeedLimit('route-1', [41.924913, 45.471554], DATA['route-1'].road)).toBeNull()
    expect(resolveSpeedLimit('route-3', [41.918945, 45.485449], DATA['route-3'].road)).toBeNull()
    expect(resolveSpeedLimit('route-1', [41.925042, 45.472083], DATA['route-1'].road)).toBeNull()
    expect(resolveSpeedLimit('route-2', [41.925042, 45.472083], DATA['route-2'].road)).toBeNull()
  })

  it('returns null for positions off the road, missing data and unknown routes', () => {
    const zone = SPEED_ZONES['route-2']!.find((z) => z.id === 'r2-2')!
    const { road } = DATA['route-2']
    const midU = (zone.from + zone.to) / 2
    const mid = roadPointAt(road, midU)
    expect(resolveSpeedLimit('route-2', mid, road, midU)).toBe(40)
    expect(resolveSpeedLimit('route-2', sideOfRoad('route-2', midU, 80), road, midU)).toBeNull()
    expect(resolveSpeedLimit('route-2', [41.0, 45.0], road)).toBeNull()
    expect(resolveSpeedLimit('route-2', null, road)).toBeNull()
    expect(resolveSpeedLimit('route-2', mid, null)).toBeNull()
    expect(resolveSpeedLimit('route-2', [Number.NaN, 45.4], road)).toBeNull()
    expect(resolveSpeedLimit('route-9', mid, road)).toBeNull()
  })

  it('a point just beyond the end of a section along the line is not given that limit', () => {
    const zone = SPEED_ZONES['route-2']!.find((z) => z.id === 'r2-2')!
    const { road } = DATA['route-2']
    const beforeU = zone.from - 0.5
    const before = roadPointAt(road, beforeU)
    expect(resolveSpeedLimit('route-2', before, road, beforeU)).not.toBe(40)
  })
})

describe('the current GPS speed display is unchanged', () => {
  it('formats the measured speed exactly as before', () => {
    expect(formatSpeed(0)).toBe('0 კმ/ს')
    expect(formatSpeed(49.6)).toBe('50 კმ/ს')
  })
})
/** Same GPS → roadU accumulation as MapPreviewPage (pins in route order). */
function previewRoadU(
  road: LatLng[],
  pins: (typeof ROUTES)[number]['pins'],
  throughSortOrder: number,
): number | null {
  let u: number | null = null
  for (const pin of pins) {
    u = advanceRoadProgressU([pin.lat, pin.lng], road, u)
    if (pin.sort_order === throughSortOrder) break
  }
  return u
}

describe('loop-closure GPS start resolves to road start', () => {
  it.each(['route-1', 'route-2'] as const)(
    '%s first GPS at pin #1 is the start of the road, not the loop end',
    (slug) => {
      const { road, pins } = DATA[slug]
      const startPin = pins.find((p) => p.sort_order === 1)!
      const u = advanceRoadProgressU([startPin.lat, startPin.lng], road, null)
      expect(u).toBeLessThan(2)
    },
  )

  it('R1 pin #2 after pin #1 advances to ~3 instead of staying at u≈268', () => {
    const { road, pins } = DATA['route-1']
    const p1 = pins.find((p) => p.sort_order === 1)!
    const p2 = pins.find((p) => p.sort_order === 2)!
    let u = advanceRoadProgressU([p1.lat, p1.lng], road, null)
    u = advanceRoadProgressU([p2.lat, p2.lng], road, u)
    expect(u).toBeGreaterThan(1)
    expect(u).toBeLessThan(10)
  })
})

describe('driver-verified pin limits after GPS → roadU', () => {
  it('R2 pin #12 = 60 km/h', () => {
    const { road, pins } = DATA['route-2']
    const pin = pins.find((p) => p.sort_order === 12)!
    const pos: LatLng = [pin.lat, pin.lng]
    const u = previewRoadU(road, pins, 12)
    expect(u).toBeGreaterThan(80)
    expect(u).toBeLessThan(105)
    expect(resolveSpeedLimit('route-2', pos, road, u)).toBe(60)
  })

  it('R2 pins #17-22 = 40 km/h', () => {
    const { road, pins } = DATA['route-2']
    for (const n of [17, 18, 19, 20, 21, 22]) {
      const pin = pins.find((p) => p.sort_order === n)!
      const pos: LatLng = [pin.lat, pin.lng]
      const u = previewRoadU(road, pins, n)
      expect(u).toBeGreaterThan(130)
      expect(u).toBeLessThan(220)
      expect(resolveSpeedLimit('route-2', pos, road, u)).toBe(40)
    }
  })

  it('R3 pin #21 = 50 km/h', () => {
    const { road, pins } = DATA['route-3']
    const pin = pins.find((p) => p.sort_order === 21)!
    const pos: LatLng = [pin.lat, pin.lng]
    const u = previewRoadU(road, pins, 21)
    expect(resolveSpeedLimit('route-3', pos, road, u)).toBe(50)
  })
})
