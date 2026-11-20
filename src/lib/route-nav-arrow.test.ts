import { describe, expect, it } from 'vitest'
import { stabilizeRoadArrowHeading, shortestHeadingTurnDegrees } from './route-nav'

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
    const next = stabilizeRoadArrowHeading(26, 206, 18, 4, false)
    expect(Math.abs(shortestHeadingTurnDegrees(26, next))).toBeLessThanOrEqual(18)
    expect(Math.abs(shortestHeadingTurnDegrees(next, 206))).toBeGreaterThan(1)
  })
})
