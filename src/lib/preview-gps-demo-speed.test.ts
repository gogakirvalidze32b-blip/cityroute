import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DEMO_SPEED_KMH,
  DEFAULT_DEMO_TIME_SCALE,
  DEMO_MIN_TICK_MS,
  DEMO_NEAR_PIN_SPEED_KMH,
  DEMO_SPEED_KMH_OPTIONS,
  DEMO_TIME_SCALE_OPTIONS,
  MAX_DEMO_STEP_METERS,
  MIN_DEMO_STEP_METERS,
  demoAdaptiveSpeedKmh,
  demoAdvanceCappedToNextPin,
  demoAdvanceMeters,
  demoEffectiveSpeedKmh,
  demoMicroChainages,
  demoTickIntervalForSpeed,
  demoTickIntervalMs,
  isDemoSpeedKmh,
  isDemoTimeScale,
} from './preview-gps-demo-speed'

describe('preview GPS demo speed (demo-only pacing)', () => {
  it('exposes the requested speed and time-scale choices with 60 km/h cruise default', () => {
    expect(DEMO_SPEED_KMH_OPTIONS).toEqual([20, 40, 60, 100, 200])
    expect(DEMO_TIME_SCALE_OPTIONS).toEqual([1, 2, 5, 10])
    expect(DEFAULT_DEMO_SPEED_KMH).toBe(60)
    expect(DEMO_NEAR_PIN_SPEED_KMH).toBe(20)
    expect(DEFAULT_DEMO_TIME_SCALE).toBe(1)
    expect(isDemoSpeedKmh(60)).toBe(true)
    expect(isDemoSpeedKmh(15)).toBe(false)
    expect(isDemoTimeScale(5)).toBe(true)
    expect(isDemoTimeScale(3)).toBe(false)
  })

  it('uses 20 km/h near PINs and ramps to cruise on open stretches', () => {
    expect(demoAdaptiveSpeedKmh(10, 60)).toBe(20)
    expect(demoAdaptiveSpeedKmh(35, 60)).toBe(20)
    expect(demoAdaptiveSpeedKmh(70, 60)).toBe(60)
    expect(demoAdaptiveSpeedKmh(null, 60)).toBe(60)
    expect(demoAdaptiveSpeedKmh(52.5, 60)).toBeCloseTo(40, 5)
  })

  it('shortens wall-clock ticks as the time scale increases, but keeps a PIN-safe floor', () => {
    expect(demoTickIntervalMs(1)).toBeGreaterThan(demoTickIntervalMs(2))
    expect(demoTickIntervalMs(10)).toBe(DEMO_MIN_TICK_MS)
    expect(DEMO_MIN_TICK_MS).toBeGreaterThanOrEqual(100)
  })

  it('keeps every advance at least MIN_DEMO_STEP so PIN triggers are not skipped', () => {
    expect(demoAdvanceMeters(20, 1, 120)).toBeGreaterThanOrEqual(MIN_DEMO_STEP_METERS)
    expect(demoAdvanceMeters(60, 1, 120)).toBeGreaterThanOrEqual(MIN_DEMO_STEP_METERS)
    expect(demoAdvanceMeters(60, 1, 120)).toBeLessThanOrEqual(MAX_DEMO_STEP_METERS)
    expect(demoEffectiveSpeedKmh(100, 10)).toBe(1000)
    expect(demoTickIntervalForSpeed(20, 1)).toBeGreaterThanOrEqual(DEMO_MIN_TICK_MS)
    expect(demoTickIntervalForSpeed(20, 1)).toBeGreaterThan(demoTickIntervalForSpeed(60, 1))
  })

  it('soft-caps past the active PIN but always creeps forward (no reverse / freeze)', () => {
    // slack default 12 → holdAt = 132
    expect(demoAdvanceCappedToNextPin(100, 50, 120)).toBe(32)
    expect(demoAdvanceCappedToNextPin(120, 50, 120)).toBe(12)
    // Already past hold → still forward min step (never 0)
    expect(demoAdvanceCappedToNextPin(140, 50, 120)).toBe(MIN_DEMO_STEP_METERS)
    expect(demoAdvanceCappedToNextPin(0, 50, null)).toBe(50)
  })

  it('never emits micro-steps larger than the pin-safe max, and caps steps per tick', () => {
    const tickMs = demoTickIntervalMs(10)
    const advance = demoAdvanceMeters(200, 10, tickMs)
    expect(advance).toBe(MAX_DEMO_STEP_METERS)

    const chainages = demoMicroChainages(0, advance, 50_000)
    expect(chainages.length).toBe(1)
    expect(chainages[0]! - 0).toBeLessThanOrEqual(MAX_DEMO_STEP_METERS + 1e-9)

    const burst = demoMicroChainages(0, 10, 50_000, MAX_DEMO_STEP_METERS, 4)
    expect(burst.length).toBe(4)
  })

  it('clamps the final micro-step to the route end without overshooting', () => {
    expect(demoMicroChainages(98, 10, 100)).toEqual([100])
    expect(demoMicroChainages(100, 10, 100)).toEqual([])
    expect(demoMicroChainages(0, 0, 100)).toEqual([])
  })

  it('keeps a 5 m approach window hittable across successive per-tick steps', () => {
    const pinChainage = 1000
    const windowM = 5
    let cursor = pinChainage - 12
    const seen: number[] = []
    for (let tick = 0; tick < 20; tick += 1) {
      const capped = demoAdvanceCappedToNextPin(cursor, 30, pinChainage)
      const steps = demoMicroChainages(cursor, capped, 5000)
      if (steps.length === 0) break
      seen.push(...steps)
      cursor = steps[steps.length - 1]!
    }
    const hitsWindow = seen.some((chainage) => Math.abs(chainage - pinChainage) <= windowM)
    expect(hitsWindow).toBe(true)
    // Soft-cap still passes through the pin window; creep is forward-only and bounded.
    expect(cursor).toBeGreaterThan(pinChainage)
    expect(cursor).toBeLessThan(pinChainage + 80)
  })
})
