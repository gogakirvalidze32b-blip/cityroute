import { describe, expect, it } from 'vitest'
import {
  createVehicleGlide,
  GLIDE_MAX_MS,
  GLIDE_MIN_MS,
  metersBetweenPoints,
  retargetVehicleGlide,
  sampleVehicleGlide,
  type GlidePoint,
  type VehicleGlide,
} from './vehicle-glide'

const M = 1 / 111_195 // ≈ 1 m of latitude
const north = (meters: number): GlidePoint => [41.92 + meters * M, 45.47]

/** Simulate 60 FPS frames and GPS fixes; returns per-frame drawn positions (metres north). */
function simulate(fixes: Array<{ atMs: number; northM: number }>, untilMs: number) {
  let glide: VehicleGlide = createVehicleGlide(north(fixes[0]!.northM))
  let drawn: GlidePoint = north(fixes[0]!.northM)
  const trail: number[] = []
  let next = 1
  for (let t = 0; t <= untilMs; t += 1000 / 60) {
    while (next < fixes.length && fixes[next]!.atMs <= t) {
      glide = retargetVehicleGlide(glide, north(fixes[next]!.northM), drawn, fixes[next]!.atMs)
      next += 1
    }
    const sample = sampleVehicleGlide(glide, t)
    glide = sample.glide
    drawn = sample.position
    trail.push((drawn[0] - 41.92) / M)
  }
  return trail
}

const maxStep = (trail: number[]) => Math.max(...trail.slice(1).map((v, i) => Math.abs(v - trail[i]!)))

describe('vehicle glide (visual arrow position)', () => {
  it('normal 1 Hz fixes at 40 km/h: continuous motion, no frame jumps, no long standstills', () => {
    const fixes = Array.from({ length: 10 }, (_, i) => ({ atMs: i * 1000, northM: i * 11 }))
    const trail = simulate(fixes, 9000)
    expect(maxStep(trail)).toBeLessThan(0.5) // ≤ ~0.2 m per 16 ms frame at 11 m/s, never a hop
    // Arrow keeps moving while fixes keep coming (no 0.8 s freeze between fixes).
    const moving = trail.slice(70, 480).map((v, i, arr) => (i === 0 ? 1 : v - arr[i - 1]!))
    expect(moving.filter((step) => step < 1e-6).length).toBeLessThan(10)
  })

  it('irregular intervals (0.4 s – 2.5 s): never jumps, stays within one update of the fix', () => {
    const times = [0, 400, 1900, 2300, 4800, 5400, 6200]
    const fixes = times.map((atMs, i) => ({ atMs, northM: i * 12 }))
    const trail = simulate(fixes, 8000)
    expect(maxStep(trail)).toBeLessThan(1.2)
    expect(trail.at(-1)).toBeCloseTo(fixes.at(-1)!.northM, 5) // arrives exactly at the last fix
  })

  it('stationary GPS shimmer below the deadband does not move the arrow', () => {
    const fixes = [0, 0.15, -0.2, 0.3, 0.1, -0.1].map((northM, i) => ({ atMs: i * 1000, northM }))
    const trail = simulate(fixes, 6000)
    expect(Math.max(...trail.map(Math.abs))).toBeLessThan(1e-9)
  })

  it('slow movement (1 m/s) creeps smoothly; fast movement (25 m/s) still has small frame steps', () => {
    const slow = simulate(Array.from({ length: 8 }, (_, i) => ({ atMs: i * 1000, northM: i })), 7000)
    expect(maxStep(slow)).toBeLessThan(0.05)
    const fast = simulate(Array.from({ length: 8 }, (_, i) => ({ atMs: i * 1000, northM: i * 25 })), 7000)
    expect(maxStep(fast)).toBeLessThan(0.8)
  })

  it('a new fix mid-glide continues from where the arrow IS (no snap back or forward)', () => {
    let glide = createVehicleGlide(north(0))
    glide = retargetVehicleGlide(glide, north(10), north(0), 1000)
    glide = sampleVehicleGlide(glide, 0).glide
    const mid = sampleVehicleGlide(glide, 500).position
    const re = retargetVehicleGlide(glide, north(22), mid, 1500)
    expect(sampleVehicleGlide(re, 500).position).toEqual(mid)
  })

  it('GPS loss then recovery: arrow waits at the last fix, then glides (not teleports) to a nearby recovery fix', () => {
    const fixes = [
      { atMs: 0, northM: 0 }, { atMs: 1000, northM: 11 }, { atMs: 2000, northM: 22 },
      { atMs: 12_000, northM: 140 }, // 10 s outage
    ]
    const trail = simulate(fixes, 14_000)
    expect(maxStep(trail)).toBeLessThan(3) // ~118 m over the 1.2 s cap
    expect(trail.at(-1)).toBeCloseTo(140, 5)
  })

  it('a relocation beyond the snap distance (resume / long loss) is placed directly', () => {
    let glide = createVehicleGlide(north(0))
    glide = retargetVehicleGlide(glide, north(900), north(0), 1000)
    expect(sampleVehicleGlide(glide, 0).position).toEqual(north(900))
  })

  it('glide duration follows the GPS interval within sane bounds', () => {
    let glide = createVehicleGlide(north(0))
    glide = retargetVehicleGlide(glide, north(10), north(0), 0)
    glide = retargetVehicleGlide(glide, north(20), north(10), 50) // very fast burst
    expect(glide.durationMs).toBeGreaterThanOrEqual(GLIDE_MIN_MS)
    glide = retargetVehicleGlide(glide, north(30), north(20), 9050) // long gap
    expect(glide.durationMs).toBeLessThanOrEqual(GLIDE_MAX_MS)
    expect(metersBetweenPoints(north(0), north(10))).toBeCloseTo(10, 1)
  })
})
