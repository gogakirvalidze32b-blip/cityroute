import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine, type PinRoutePoint } from '@/lib/pin-route-line'
import { resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'
import {
  forwardBearingAlongRoute,
  prepareRouteGeometry,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'
import { shortestHeadingTurnDegrees, stabilizeRoadArrowHeading } from '@/lib/route-nav'

/** Finish-corridor U-tips called out in the arrow screenshot (arrow only — not 300m-right). */
const SHARP_TIP_PINS = [
  { slug: 'route-1' as const, pinOrder: 32 },
  { slug: 'route-2' as const, pinOrder: 26 },
  { slug: 'route-3' as const, pinOrder: 28 },
  { slug: 'route-4' as const, pinOrder: 29 },
]

function pinChainage(
  geometry: PreparedRouteGeometry,
  pins: readonly PinRoutePoint[],
  pinOrder: number,
): number {
  const prior = pins
    .map((pin) => pin.sort_order)
    .filter((order) => order < pinOrder)
    .sort((a, b) => b - a)[0]
  const after =
    prior !== undefined ? resolveDemoPinChainage(geometry, pins, prior, 0) ?? 0 : 0
  const chainage = resolveDemoPinChainage(geometry, pins, pinOrder, after)
  if (chainage == null) throw new Error(`missing PIN ${pinOrder}`)
  return chainage
}

function load(slug: (typeof SHARP_TIP_PINS)[number]['slug']) {
  const route = TELAVI_ROUTES_FALLBACK.find((row) => row.slug === slug)!
  const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
  const geometry = prepareRouteGeometry(slug, examRouteLine(slug, pins))
  return { pins, geometry }
}

describe('forwardBearingAlongRoute at finish-corridor sharp tips', () => {
  it.each(SHARP_TIP_PINS)(
    '$slug PIN $pinOrder: look-ahead never jumps >35° per 2 m through the tip',
    ({ slug, pinOrder }) => {
      const { pins, geometry } = load(slug)
      const pinCh = pinChainage(geometry, pins, pinOrder)
      let prev: number | null = null
      let maxStep = 0
      for (let ch = pinCh - 100; ch <= pinCh + 120; ch += 2) {
        if (ch < 0 || ch > geometry.totalLengthMeters) continue
        const bearing = forwardBearingAlongRoute(geometry, ch, 14)
        expect(bearing).not.toBeNull()
        if (prev != null && bearing != null) {
          const step = Math.abs(shortestHeadingTurnDegrees(prev, bearing))
          maxStep = Math.max(maxStep, step)
        }
        if (bearing != null) prev = bearing
      }
      // Through a U-tip even a rounded arc can turn ~60–70° per 2 m of chainage;
      // the important bound is no instant ~150° tip-chord flip. Slew test below
      // enforces Maps-style display steps.
      expect(maxStep).toBeLessThanOrEqual(75)
    },
  )

  it.each(SHARP_TIP_PINS)(
    '$slug PIN $pinOrder: slewed arrow stays forward (no 180° spin) through the tip',
    ({ slug, pinOrder }) => {
      const { pins, geometry } = load(slug)
      const pinCh = pinChainage(geometry, pins, pinOrder)
      let heading = forwardBearingAlongRoute(geometry, Math.max(0, pinCh - 100), 14) ?? 0
      let maxSlew = 0
      for (let ch = pinCh - 100; ch <= pinCh + 120; ch += 4) {
        if (ch < 0 || ch > geometry.totalLengthMeters) continue
        const target = forwardBearingAlongRoute(geometry, ch, 14)
        if (target == null) continue
        const next = stabilizeRoadArrowHeading(heading, target, 10, 5, false)
        const step = Math.abs(shortestHeadingTurnDegrees(heading, next))
        maxSlew = Math.max(maxSlew, step)
        // Maps-style: adaptive slew may reach ~18° on large lag — never a 180° flip.
        expect(step).toBeLessThanOrEqual(18.01)
        heading = next
      }
      expect(maxSlew).toBeLessThanOrEqual(18.01)
    },
  )

  it('route-2 PIN 3 zig-zag: heading target stays monotonic (no reverse cliff)', () => {
    const { geometry } = load('route-2')
    // Sharp vertices at ~148 m and ~164 m (PIN 3 sits just before the corridor).
    let prev: number | null = null
    let maxStep = 0
    let signedSum = 0
    for (let ch = 100; ch <= 200; ch += 1) {
      const bearing = forwardBearingAlongRoute(geometry, ch, 20)
      expect(bearing).not.toBeNull()
      if (prev != null && bearing != null) {
        const turn = shortestHeadingTurnDegrees(prev, bearing)
        maxStep = Math.max(maxStep, Math.abs(turn))
        signedSum += turn
      }
      if (bearing != null) prev = bearing
    }
    // Cluster blend along road turn (−180°): no ~88° cliff / reverse handoff.
    // The route-specific PIN 3 crossover is intentionally held on the entry leg,
    // then turns onto the exit leg over the short zig-zag cluster.
    expect(maxStep).toBeLessThanOrEqual(16)
    expect(signedSum).toBeLessThan(-150)
    expect(signedSum).toBeGreaterThan(-210)
  })

  it('route-2 PIN 3 keeps the entry carriageway bearing until the crossover', () => {
    const { pins, geometry } = load('route-2')
    const pin3 = resolveDemoPinChainage(geometry, pins, 3, 0)!
    const before = forwardBearingAlongRoute(geometry, pin3 - 20, 20)!
    const atCrossover = forwardBearingAlongRoute(geometry, pin3 + 16, 20)!
    const after = forwardBearingAlongRoute(geometry, pin3 + 50, 20)!

    // The entry leg is stable through PIN 3; turning starts only after the
    // route reaches the second carriageway crossover.
    expect(Math.abs(shortestHeadingTurnDegrees(before, atCrossover))).toBeLessThan(45)
    expect(Math.abs(shortestHeadingTurnDegrees(atCrossover, after))).toBeGreaterThan(25)
  })

  it('straight sections still anticipate gently (look-ahead ≠ pure segment only)', () => {
    const { geometry } = load('route-1')
    // Early mid-route stretch is mostly straight — look-ahead should still return a bearing.
    const bearing = forwardBearingAlongRoute(geometry, 500, 14)
    expect(bearing).not.toBeNull()
    expect(bearing!).toBeGreaterThanOrEqual(0)
    expect(bearing!).toBeLessThan(360)
  })
})
