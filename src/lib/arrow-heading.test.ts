import { describe, expect, it } from 'vitest'
import { advanceArrowChainage, limitHeadingStep, type ArrowChainageState } from '@/lib/arrow-heading'

const s0: ArrowChainageState = { chainageMeters: 1000, timestampMs: 0, speedMps: 8 }

describe('advanceArrowChainage', () => {
  it('starts from the first candidate', () => {
    expect(advanceArrowChainage(null, 500, 1000).chainageMeters).toBe(500)
  })
  it('advances normally at driving speed', () => {
    expect(advanceArrowChainage(s0, 1008, 1000).chainageMeters).toBeCloseTo(1008, 5)
  })
  it('never moves backward on small GPS regressions', () => {
    expect(advanceArrowChainage(s0, 995, 1000).chainageMeters).toBe(1000)
  })
  it('limits an implausible forward hop (opposing-pass mismatch)', () => {
    const next = advanceArrowChainage(s0, 1037, 1000)
    expect(next.chainageMeters).toBeGreaterThan(1000)
    expect(next.chainageMeters).toBeLessThan(1025)
  })
  it('re-bases after a long GPS gap', () => {
    expect(advanceArrowChainage(s0, 1300, 12_000).chainageMeters).toBe(1300)
  })
  it('re-bases on a large genuine backward re-lock', () => {
    expect(advanceArrowChainage(s0, 900, 1000).chainageMeters).toBe(900)
  })
  it('ignores non-increasing timestamps and non-finite input', () => {
    expect(advanceArrowChainage(s0, 1010, 0)).toBe(s0)
    expect(advanceArrowChainage(s0, Number.NaN, 1000)).toBe(s0)
  })
})

describe('limitHeadingStep', () => {
  it('caps the rotation by elapsed time', () => {
    expect(limitHeadingStep(0, 90, 20, 240)).toBeCloseTo(4.8, 5)
  })
  it('takes the shortest arc across 0/360', () => {
    expect(limitHeadingStep(350, 10, 50, 240)).toBeCloseTo(2, 5)
    expect(limitHeadingStep(10, 350, 20, 240)).toBeCloseTo(5.2, 5)
  })
  it('reaches the target without overshoot', () => {
    expect(limitHeadingStep(100, 101, 1000, 240)).toBeCloseTo(101, 5)
  })
  it('handles zero elapsed and non-finite values', () => {
    expect(limitHeadingStep(40, 200, 0, 240)).toBe(40)
    expect(limitHeadingStep(Number.NaN, 200, 16)).toBe(200)
  })
})

import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'
import { positionAtChainageMeters, prepareRouteGeometry, forwardBearingAlongRoute } from '@/lib/pure-route-geometry'
import { routePassCandidates, stepArrowTracker, type ArrowTrackerState } from '@/lib/arrow-heading'

function routeGeometry(slug: 'route-1' | 'route-2' | 'route-3' | 'route-4') {
  const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === slug)!
  const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
  return prepareRouteGeometry(slug, examRouteLine(slug, pins))
}
const turn = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180)

describe('wrong-pass self-correction (Route 3 doubled street at PIN 6/15)', () => {
  const g = routeGeometry('route-3')

  it('sees both passes of the doubled street', () => {
    const p = positionAtChainageMeters(g, 4106)!
    const chs = routePassCandidates(g, [p[0], p[1]], 15).map((c) => Math.round(c.chainageMeters / 100))
    expect(chs.some((c) => Math.abs(c - 41) <= 1)).toBe(true)
    expect(chs.length).toBeGreaterThanOrEqual(2)
  })

  it('moves the arrow to the pass that matches the real direction of travel', () => {
    // Car really drives the 884 m pass (heading ~125°) but the session is locked to 4090 (heading 280°).
    let state: ArrowTrackerState | null = null
    let ts = 0
    let switchedAt = -1
    for (let i = 0; i < 14; i += 1) {
      ts = 1_000_000 + i * 1000
      const p = positionAtChainageMeters(g, 884 + i * 8.3)!
      state = stepArrowTracker(state, {
        geometry: g,
        position: [p[0], p[1]],
        matchedChainageMeters: 4090 + i * 8.3, // wrong-pass lock keeps "advancing"
        timestampMs: ts,
        aggressiveSelfCorrection: true,
      })
      if (state?.override && switchedAt < 0) switchedAt = i
    }
    expect(state?.override).toBe(true)
    expect(switchedAt).toBeGreaterThan(0)
    expect(switchedAt).toBeLessThanOrEqual(8)
    const ch = state!.chain.chainageMeters
    expect(Math.abs(ch - (884 + 13 * 8.3))).toBeLessThan(40)
    const heading = forwardBearingAlongRoute(g, ch, 14)!
    const truth = forwardBearingAlongRoute(g, 884 + 13 * 8.3, 14)!
    expect(turn(heading, truth)).toBeLessThan(20)
  })

  it('never switches when the session pass already matches the travel direction', () => {
    let state: ArrowTrackerState | null = null
    for (let i = 0; i < 40; i += 1) {
      const ch = 4000 + i * 8.3
      const p = positionAtChainageMeters(g, ch)!
      state = stepArrowTracker(state, {
        geometry: g,
        position: [p[0], p[1]],
        matchedChainageMeters: ch,
        timestampMs: 2_000_000 + i * 1000,
      })
      expect(state?.override).toBe(false)
    }
  })

  it('does not switch on a single noisy fix', () => {
    let state: ArrowTrackerState | null = null
    for (let i = 0; i < 12; i += 1) {
      const ch = 4000 + i * 8.3
      const p = positionAtChainageMeters(g, i === 6 ? ch - 60 : ch)!
      state = stepArrowTracker(state, {
        geometry: g,
        position: [p[0], p[1]],
        matchedChainageMeters: ch,
        timestampMs: 3_000_000 + i * 1000,
      })
    }
    expect(state?.override).toBe(false)
  })
})
