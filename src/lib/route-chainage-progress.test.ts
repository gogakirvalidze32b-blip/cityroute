import { describe, expect, it } from 'vitest'
import {
  decideChainageFromMatch,
  decideChainageFromPinAnchor,
  isPlausibleChainageStep,
  resolveGpsSeedChainageMeters,
} from './route-chainage-progress'

describe('isPlausibleChainageStep', () => {
  it('allows normal forward travel within speed budget', () => {
    expect(
      isPlausibleChainageStep({
        previousChainageMeters: 3_000,
        candidateChainageMeters: 3_040,
        elapsedMs: 2_000,
      }),
    ).toBe(true)
  })

  it('rejects a teleport to an unrelated forward section', () => {
    expect(
      isPlausibleChainageStep({
        previousChainageMeters: 3_300,
        candidateChainageMeters: 4_100,
        elapsedMs: 1_000, // ~55 m allowed + slack — 800 m is not
      }),
    ).toBe(false)
  })

  it('rejects a large reverse jump', () => {
    expect(
      isPlausibleChainageStep({
        previousChainageMeters: 3_300,
        candidateChainageMeters: 2_800,
        elapsedMs: 2_000,
      }),
    ).toBe(false)
  })

  it('allows catch-up after a long GPS gap when speed budget covers it', () => {
    expect(
      isPlausibleChainageStep({
        previousChainageMeters: 3_000,
        candidateChainageMeters: 3_500,
        elapsedMs: 20_000, // 55*20 + 40 = 1140 m budget
      }),
    ).toBe(true)
  })
})

describe('decideChainageFromMatch', () => {
  it('adopts the first accepted match when no previous lock exists', () => {
    expect(
      decideChainageFromMatch({
        previousChainageMeters: null,
        candidateChainageMeters: 120,
        matchAccepted: true,
        elapsedMs: 0,
      }),
    ).toEqual({ action: 'adopt', chainageMeters: 120 })
  })

  it('freezes last valid chainage when match is rejected', () => {
    expect(
      decideChainageFromMatch({
        previousChainageMeters: 3_300,
        candidateChainageMeters: 4_100,
        matchAccepted: false,
        elapsedMs: 1_000,
      }),
    ).toEqual({ action: 'freeze', chainageMeters: 3_300, reason: 'no-match' })
  })

  it('keeps 0.0 კმ locked when finish-plaza snap jumps from a PIN-1 start', () => {
    expect(
      decideChainageFromMatch({
        previousChainageMeters: 0,
        candidateChainageMeters: 8_400,
        matchAccepted: true,
        elapsedMs: 500,
      }),
    ).toEqual({ action: 'freeze', chainageMeters: 0, reason: 'implausible-jump' })
  })

  it('freezes on implausible accepted jump', () => {
    expect(
      decideChainageFromMatch({
        previousChainageMeters: 3_300,
        candidateChainageMeters: 4_100,
        matchAccepted: true,
        elapsedMs: 1_000,
      }),
    ).toEqual({ action: 'freeze', chainageMeters: 3_300, reason: 'implausible-jump' })
  })

  it('adopts a plausible accepted step', () => {
    expect(
      decideChainageFromMatch({
        previousChainageMeters: 3_300,
        candidateChainageMeters: 3_325,
        matchAccepted: true,
        elapsedMs: 2_000,
      }),
    ).toEqual({ action: 'adopt', chainageMeters: 3_325 })
  })
})

describe('decideChainageFromPinAnchor', () => {
  it('anchors at the exact pin chainage without rounding', () => {
    expect(decideChainageFromPinAnchor(3_301.7)).toEqual({
      action: 'pin-anchor',
      chainageMeters: 3_301.7,
    })
  })
})

describe('resolveGpsSeedChainageMeters', () => {
  it('rejects a distant PIN-window pull onto a parallel section (R1 ~2.25 vs PIN12)', () => {
    // Reproduction: GPS nearest ≈ 2250 m; pin window returns ≈ 2572 m at XT ~308 m.
    const decision = resolveGpsSeedChainageMeters({
      nearest: { chainageMeters: 2_250, crossTrackMeters: 0.01 },
      pinAnchored: { chainageMeters: 2_572, crossTrackMeters: 308 },
      exactPinChainageMeters: 2_692,
      distanceToPinMeters: 440,
      hintChainageMeters: 2_250,
    })
    expect(decision.action).toBe('adopt')
    expect(decision.chainageMeters).toBeCloseTo(2_250, 5)
  })

  it('uses nearest alone when no hint and pin-window is off-road', () => {
    const decision = resolveGpsSeedChainageMeters({
      nearest: { chainageMeters: 2_250, crossTrackMeters: 0.01 },
      pinAnchored: { chainageMeters: 2_572, crossTrackMeters: 308 },
      exactPinChainageMeters: 2_692,
      distanceToPinMeters: 440,
    })
    expect(decision).toEqual({ action: 'adopt', chainageMeters: 2_250 })
  })

  it('uses exact PIN chainage only when GPS is on the pin', () => {
    expect(
      resolveGpsSeedChainageMeters({
        nearest: { chainageMeters: 2_690, crossTrackMeters: 2 },
        pinAnchored: { chainageMeters: 2_692, crossTrackMeters: 2 },
        exactPinChainageMeters: 2_692.04,
        distanceToPinMeters: 12,
      }),
    ).toEqual({ action: 'pin-exact', chainageMeters: 2_692.04 })
  })

  it('does not pin-exact when GPS is only near the next PIN along-route', () => {
    const decision = resolveGpsSeedChainageMeters({
      nearest: { chainageMeters: 2_572, crossTrackMeters: 0.01 },
      pinAnchored: { chainageMeters: 2_572, crossTrackMeters: 0.01 },
      exactPinChainageMeters: 2_692,
      distanceToPinMeters: 120,
      hintChainageMeters: 2_572,
    })
    expect(decision.action).toBe('adopt')
    expect(decision.chainageMeters).toBeCloseTo(2_572, 5)
  })

  it('preserves seek hint when projections are geographically ambiguous', () => {
    const decision = resolveGpsSeedChainageMeters({
      nearest: { chainageMeters: 4_427, crossTrackMeters: 0.5 },
      pinAnchored: { chainageMeters: 3_100, crossTrackMeters: 40 },
      hintAnchored: null,
      exactPinChainageMeters: 3_200,
      distanceToPinMeters: 200,
      hintChainageMeters: 2_750,
    })
    expect(decision).toEqual({ action: 'preserve-hint', chainageMeters: 2_750 })
  })

  it('prefers an on-route hint snap over opposing-pass nearest', () => {
    const decision = resolveGpsSeedChainageMeters({
      nearest: { chainageMeters: 4_427, crossTrackMeters: 0.2 },
      hintAnchored: { chainageMeters: 2_750.4, crossTrackMeters: 1.5 },
      hintChainageMeters: 2_750,
    })
    expect(decision.action).toBe('adopt')
    expect(decision.chainageMeters).toBeCloseTo(2_750.4, 5)
  })
})
