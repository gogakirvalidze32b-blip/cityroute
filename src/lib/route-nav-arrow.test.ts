import { describe, expect, it } from 'vitest'
import {
  resolveArrowHeading,
  stabilizeRoadArrowHeading,
  shortestHeadingTurnDegrees,
} from './route-nav'
import { ARROW_MAX_STEP_DEG } from './arrow-heading'

describe('resolveArrowHeading', () => {
  it('prefers the trusted synthetic route bearing over a stale matched bearing', () => {
    expect(resolveArrowHeading(140, 92)).toBe(92)
  })

  it('falls back to the matched route bearing when the synthetic source is invalid', () => {
    expect(resolveArrowHeading(359, null)).toBe(359)
    expect(resolveArrowHeading(359, 361)).toBe(359)
    expect(resolveArrowHeading(null, null)).toBeNull()
  })

  it('normalizes the 360° boundary to north', () => {
    expect(resolveArrowHeading(361, 360)).toBe(0)
  })

  it('catches up from a stale Demo heading without a 90° snap', () => {
    let heading = 204
    heading = stabilizeRoadArrowHeading(heading, 112, 45, 2, false)
    expect(Math.abs(shortestHeadingTurnDegrees(204, heading))).toBeLessThanOrEqual(45)
    heading = stabilizeRoadArrowHeading(heading, 112, 45, 2, false)
    expect(Math.abs(shortestHeadingTurnDegrees(heading, 112))).toBeLessThanOrEqual(2)
  })
})

describe('stabilizeRoadArrowHeading', () => {
  it('ignores tiny jitter inside the deadband', () => {
    expect(stabilizeRoadArrowHeading(206, 210)).toBe(206)
  })

  it('snaps on sharp road turns instead of crawling backwards', () => {
    const next = stabilizeRoadArrowHeading(25, 206)
    expect(next).toBeCloseTo(206, 5)
    // Must not stop halfway (e.g. 25±45) facing the wrong carriageway.
    expect(Math.abs(shortestHeadingTurnDegrees(next, 206))).toBeLessThan(1)
  })

  it('slews small trusted corrections', () => {
    const next = stabilizeRoadArrowHeading(200, 230)
    expect(next).toBeGreaterThan(200)
    expect(next).toBeLessThanOrEqual(230)
  })

  it('Maps-style mode never instant-snaps opposite bearings (no carriageway flip)', () => {
    const next = stabilizeRoadArrowHeading(26, 206, 10, 4, false)
    // Adaptive cap (~18°) for large lag — still not an instant 180° snap.
    expect(Math.abs(shortestHeadingTurnDegrees(26, next))).toBeLessThanOrEqual(18.01)
    expect(Math.abs(shortestHeadingTurnDegrees(next, 206))).toBeGreaterThan(90)
  })

  it('follows the full route bearing for PIN 3-style turns', () => {
    const next = stabilizeRoadArrowHeading(26, 206, ARROW_MAX_STEP_DEG, 4, false)
    expect(next).toBe(206)
  })

  it('Maps-style adaptive slew catches up through a ~90° corner without 80° lag', () => {
    let heading = 202
    const target = 26
    // ~12 ticks at adaptive 18° ≈ 216° budget — enough for a right-angle corner.
    for (let i = 0; i < 12; i++) {
      heading = stabilizeRoadArrowHeading(heading, target, 10, 5, false)
    }
    expect(Math.abs(shortestHeadingTurnDegrees(heading, target))).toBeLessThan(15)
  })
})
