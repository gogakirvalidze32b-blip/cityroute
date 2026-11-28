import { describe, expect, it } from 'vitest'
import { createRng } from '@/test/replay/route-replay'
import { stepDisplayProgress, type DisplayProgress } from './display-progress'

function run(samples: Array<{ c: number; xt?: number; v?: number | null; t: number }>) {
  let state: DisplayProgress | null = null
  return samples.map((s) => {
    state = stepDisplayProgress(state, { candidateChainageMeters: s.c, crossTrackMeters: s.xt ?? 3, speedMps: s.v ?? 11, timestampMs: s.t })
    return state.chainageMeters
  })
}

describe('display progress (map arrow only)', () => {
  it('tracks a steady 11 m/s car without growing lag', () => {
    const shown = run(Array.from({ length: 60 }, (_, i) => ({ c: i * 11, t: i * 1000 })))
    shown.forEach((value, i) => expect(Math.abs(value - i * 11)).toBeLessThan(1.5))
  })

  it('never shows the arrow far ahead of a car with 6 m GPS noise (no forward jumps)', () => {
    const rng = createRng(7)
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng())
    const truth = Array.from({ length: 300 }, (_, i) => i * 11)
    const shown = run(truth.map((c, i) => ({ c: c + gauss() * 6, t: i * 1000 })))
    // From the 4th fix on (the very first fix is taken as-is to initialise).
    const leads = shown.map((value, i) => value - truth[i]!).slice(3)
    expect(Math.max(...leads)).toBeLessThan(10)
    // ...and it does not fall far behind either (worst instant of 300 noisy fixes;
    // the lead cap trades a little lag for never running ahead of the car).
    expect(Math.min(...leads.slice(5))).toBeGreaterThan(-15)
  })

  it('ignores a matcher snap 44 m ahead that is not supported by the GPS fix', () => {
    const shown = run([
      { c: 0, t: 0 }, { c: 11, t: 1000 }, { c: 66, xt: 43, t: 2000 }, { c: 33, t: 3000 },
    ])
    expect(shown[2]).toBeLessThan(25)
    expect(shown[3]).toBeLessThan(36)
  })

  it('keeps moving at GPS speed through untrusted matches (does not fall behind)', () => {
    const shown = run([
      { c: 0, t: 0 }, { c: 11, t: 1000 },
      { c: 80, xt: 40, t: 2000 }, { c: 90, xt: 35, t: 3000 }, { c: 100, xt: 45, t: 4000 },
      { c: 55, t: 5000 },
    ])
    expect(shown[2]).toBeCloseTo(22, 5)
    expect(shown[4]).toBeCloseTo(44, 5)
    expect(Math.abs(shown[5]! - 55)).toBeLessThan(3)
  })

  it('limits a supported forward leap to plausible travel', () => {
    const shown = run([{ c: 0, t: 0 }, { c: 11, t: 1000 }, { c: 70, xt: 5, t: 2000 }])
    expect(shown[2]! - shown[1]!).toBeLessThanOrEqual(11 * 1.3 + 2 + 4 + 1e-9)
  })

  it('does not move backwards on reverse wobble', () => {
    const shown = run([{ c: 100, t: 0 }, { c: 96, v: 0, t: 1000 }, { c: 98, v: 0, t: 2000 }])
    expect(shown[1]).toBe(100)
    expect(shown[2]).toBe(100)
  })

  it('stationary car: stays put despite small chainage noise', () => {
    const shown = run([0, 1.5, -1, 2, 0.5].map((c, i) => ({ c: 500 + c, v: 0, t: i * 1000 })))
    expect(Math.max(...shown)).toBe(500)
  })

  it('accepts a relocation (resume / long GPS loss) directly', () => {
    const shown = run([{ c: 100, t: 0 }, { c: 900, t: 30_000 }])
    expect(shown[1]).toBe(900)
  })

  it('does not overshoot after a gap where the car stopped (e.g. waiting at a PIN)', () => {
    // Steady 5.5 m/s, then no fixes for 3.6 s while stopped, then 2.4 m further.
    const shown = run([
      { c: 95.9, v: 5.5, t: 0 }, { c: 98, v: 5.5, t: 400 }, { c: 100.1, v: 5.5, t: 800 },
      { c: 102.5, v: 5.5, t: 4400 },
    ])
    expect(Math.abs(shown[3]! - 102.5)).toBeLessThan(0.5)
  })

  it('does not sit ahead of the car when the reported GPS speed is too high', () => {
    // Real progress 12.5 m/s, reported 16.7 m/s (stale / biased), fixes every 200 ms.
    const truth = (i: number) => i * 2.5
    const shown = run(Array.from({ length: 200 }, (_, i) => ({ c: truth(i), v: 16.7, t: i * 200 })))
    shown.slice(60).forEach((value, i) => expect(value - truth(i + 60)).toBeLessThan(1.5))
  })

  it('works without a GPS speed (estimates it from progress)', () => {
    const shown = run(Array.from({ length: 30 }, (_, i) => ({ c: i * 10, v: null, t: i * 1000 })))
    expect(Math.abs(shown.at(-1)! - 290)).toBeLessThan(12)
  })
})
