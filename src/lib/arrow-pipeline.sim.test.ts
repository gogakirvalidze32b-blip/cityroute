import { describe, expect, it } from 'vitest'
import type { PreparedRouteGeometry } from '@/lib/pure-route-geometry'
import { stepDisplayProgress, type DisplayProgress } from './display-progress'
import { retargetMotionTrack, sampleMotionTrack, type MotionTrack } from './vehicle-motion'

const geometry = { totalLengthMeters: 100_000 } as unknown as PreparedRouteGeometry
const FRAME = 1000 / 60

type Fix = { t: number; c: number; v: number | null }

/** Full display pipeline (filter at each fix + per-frame motion); returns arrow − truth per frame. */
function runPipeline(fixes: Fix[], truth: (t: number) => number, endMs: number) {
  let display: DisplayProgress | null = null
  let track: MotionTrack | null = null
  let seq = 0
  let k = 0
  const errors: number[] = []
  for (let t = 0; t <= endMs; t += FRAME) {
    while (k < fixes.length && fixes[k]!.t <= t) {
      const fix = fixes[k++]!
      display = stepDisplayProgress(display, {
        candidateChainageMeters: fix.c,
        crossTrackMeters: 0,
        speedMps: fix.v,
        timestampMs: fix.t,
      })
      track = retargetMotionTrack(track, { geometry, chainageMeters: display.chainageMeters, speedMps: display.speedMps, seq: ++seq }, t)
    }
    if (!track) continue
    const s = sampleMotionTrack(track, t, FRAME)
    track = s.track
    errors.push(s.chainageMeters - truth(t))
  }
  return errors
}

/** Demo-like drive: cruise, slow to near-PIN speed, wait (no fixes), accelerate. Reported speed biased. */
function demoDrive(reportBias: number, intervalCruise = 200, intervalSlow = 400) {
  const segments = [
    { until: 8000, v: 12.5 },
    { until: 11000, v: 5.5 },
    { until: 14500, v: 0 }, // waiting for audio — no fixes published
    { until: 20000, v: 5.5 },
    { until: 30000, v: 12.5 },
  ]
  // Real cars ramp: accelerate 2 m/s², brake 2.5 m/s².
  const truthAt: number[] = []
  const speedAt: number[] = []
  let c = 0
  let v = segments[0]!.v
  for (let t = 0, i = 0; t <= 30000; t += 1) {
    while (segments[i]!.until < t) i++
    const target = segments[i]!.v
    v = target > v ? Math.min(target, v + 2 / 1000) : Math.max(target, v - 2.5 / 1000)
    c += v / 1000
    truthAt.push(c)
    speedAt.push(v)
  }
  const at = (t: number) => Math.min(truthAt.length - 1, Math.max(0, Math.round(t)))
  const truth = (t: number) => truthAt[at(t)]!
  const fixes: Fix[] = []
  for (let t = 0; t <= 30000; ) {
    const seg = segments.find((s) => t <= s.until)!
    const speed = speedAt[at(t)]!
    // The demo publishes nothing while it waits at a PIN (car stopped).
    if (!(seg.v === 0 && speed < 0.1)) fixes.push({ t, c: truth(t), v: speed * reportBias })
    t += speed > 7 ? intervalCruise : intervalSlow
  }
  return { fixes, truth }
}

function stats(errors: number[]) {
  const abs = errors.map(Math.abs).sort((a, b) => a - b)
  return {
    median: abs[Math.floor(abs.length / 2)]!,
    p95: abs[Math.floor(abs.length * 0.95)]!,
    maxAhead: Math.max(...errors),
    maxBehind: -Math.min(...errors),
  }
}

describe('arrow display pipeline follows the car (simulation)', () => {
  it('accurate reported speed: the arrow sits on the car', () => {
    const { fixes, truth } = demoDrive(1)
    const s = stats(runPipeline(fixes, truth, 30000))
    expect(s.median).toBeLessThan(0.3)
    expect(s.maxAhead).toBeLessThan(1)
    expect(s.maxBehind).toBeLessThan(1.2)
  })

  it('reported speed 33 % too high (demo cruise): never runs far ahead', () => {
    const { fixes, truth } = demoDrive(1.33)
    const s = stats(runPipeline(fixes, truth, 30000))
    expect(s.median).toBeLessThan(1.3)
    expect(s.maxAhead).toBeLessThan(2)
  })

  it('reported speed half the real one (demo at 2x): stays close behind, never ahead', () => {
    const { fixes, truth } = demoDrive(0.5)
    const s = stats(runPipeline(fixes, truth, 30000))
    expect(s.maxAhead).toBeLessThan(0.5)
    expect(s.maxBehind).toBeLessThan(4.5)
  })

  it('resuming after a stop with a too-high reported speed: no run-ahead', () => {
    // Stopped at c=118 (no fixes 1.6 s), then real 11.5 m/s but reported 16.7 m/s at once.
    const fixes: Fix[] = [
      { t: 0, c: 112, v: 5.5 }, { t: 400, c: 114.2, v: 5.5 }, { t: 800, c: 116, v: 5.5 },
      { t: 1200, c: 117.5, v: 2 }, { t: 1600, c: 118, v: 0.4 },
    ]
    for (let k = 1, t = 3200; t <= 12000; t += 217, k++) fixes.push({ t, c: 118 + 2.5 * k, v: 16.7 })
    const truth = (t: number) => (t < 3200 ? Math.min(118, 112 + (6 * t) / 1600) : 118 + (11.5 * (t - 3200)) / 1000 + 2.5)
    const s = stats(runPipeline(fixes, truth, 12000))
    expect(s.maxAhead).toBeLessThan(5)
  })

  it('real-phone-like 1 Hz fixes with accurate speed', () => {
    const { fixes, truth } = demoDrive(1, 1000, 1000)
    const s = stats(runPipeline(fixes, truth, 30000))
    expect(s.median).toBeLessThan(1.5)
    expect(s.maxAhead).toBeLessThan(3)
    expect(s.maxBehind).toBeLessThan(4)
  })
})
