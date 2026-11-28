import { describe, expect, it } from 'vitest'
import type { PreparedRouteGeometry } from '@/lib/pure-route-geometry'
import {
  MOTION_SNAP_M,
  retargetMotionTrack,
  sampleMotionTrack,
  type MotionTrack,
  type VehicleMotion,
} from './vehicle-motion'

const geometry = { totalLengthMeters: 5000 } as unknown as PreparedRouteGeometry
const FRAME = 1000 / 60

/** Simulate fixes every `intervalMs` from a car whose true chainage is truth(t); sample every frame. */
function simulate(truth: (tMs: number) => number, intervalMs: number, durationMs: number, speedOf?: (t: number) => number) {
  let track: MotionTrack | null = null
  let seq = 0
  let nextFix = 0
  const frames: Array<{ t: number; shown: number; truth: number }> = []
  for (let t = 0; t <= durationMs; t += FRAME) {
    if (t >= nextFix) {
      const c = truth(t)
      const motion: VehicleMotion = { geometry, chainageMeters: c, speedMps: speedOf ? speedOf(t) : 0, seq: ++seq }
      track = retargetMotionTrack(track, motion, t)
      nextFix += intervalMs
    }
    const sample = sampleMotionTrack(track!, t, FRAME)
    track = sample.track
    frames.push({ t, shown: sample.chainageMeters, truth: truth(t) })
  }
  return frames
}

describe('vehicle motion (map arrow only, zero lag)', () => {
  it('a steady car: the arrow sits on the real position, not one fix behind', () => {
    const v = 5.5
    const frames = simulate((t) => 100 + (v * t) / 1000, 400, 20_000, () => v).filter((f) => f.t > 3000)
    const errors = frames.map((f) => Math.abs(f.shown - f.truth))
    expect(Math.max(...errors)).toBeLessThan(0.6)
  })

  it('never moves backwards and has no per-frame jumps', () => {
    const frames = simulate((t) => 100 + (8 * t) / 1000 + Math.sin(t / 700) * 2, 315, 20_000, () => 8)
    for (let i = 1; i < frames.length; i++) {
      const step = frames[i]!.shown - frames[i - 1]!.shown
      expect(step).toBeGreaterThanOrEqual(0)
      expect(step).toBeLessThan(1)
    }
  })

  it('a car that stops: the arrow stops close behind it instead of running far ahead', () => {
    const truth = (t: number) => (t < 5000 ? (8 * t) / 1000 : 40)
    const frames = simulate(truth, 400, 9000, (t) => (t < 5000 ? 8 : 0))
    const after = frames.filter((f) => f.t > 6000)
    // Zero-lag prediction may overshoot a sudden stop by about one fix interval
    // of travel (8 m/s × 0.4 s), then it holds still — never reverses.
    after.forEach((f) => expect(f.shown - 40).toBeLessThan(3.5))
    expect(after.at(-1)!.shown).toBe(after[0]!.shown)
  })

  it('snaps on relocation (route reset / resume)', () => {
    let track = retargetMotionTrack(null, { geometry, chainageMeters: 500, speedMps: 0, seq: 1 }, 0)
    track = retargetMotionTrack(track, { geometry, chainageMeters: 50, speedMps: 0, seq: 2 }, 400)
    expect(sampleMotionTrack(track, 400, FRAME).chainageMeters).toBe(50)
    track = retargetMotionTrack(track, { geometry, chainageMeters: 50 + MOTION_SNAP_M + 10, speedMps: 0, seq: 3 }, 800)
    expect(sampleMotionTrack(track, 800, FRAME).chainageMeters).toBe(50 + MOTION_SNAP_M + 10)
  })
})
