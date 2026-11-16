import { describe, expect, it } from 'vitest'
import { createRouteOdometer, distanceKmTenths, formatDistanceKm } from './route-odometer'
import type { LatLng } from './gps'

/** ~111 m north of origin at equator-ish: 0.001° lat ≈ 111 m */
function northOf(base: LatLng, meters: number): LatLng {
  return [base[0] + meters / 111_320, base[1]]
}

describe('createRouteOdometer', () => {
  it('anchors the first fix without adding distance', () => {
    const odo = createRouteOdometer()
    const first = odo.observe([41.93, 45.47], 1_000)
    expect(first).toMatchObject({ accepted: true, addedMeters: 0, totalMeters: 0, reason: 'anchor' })
  })

  it('accumulates plausible steps and ignores jitter', () => {
    const odo = createRouteOdometer({ minStepMeters: 1.5 })
    const start: LatLng = [41.93, 45.47]
    odo.observe(start, 1_000)
    const step = odo.observe(northOf(start, 10), 2_000)
    expect(step.accepted).toBe(true)
    expect(step.addedMeters).toBeGreaterThan(9)
    expect(step.totalMeters).toBeGreaterThan(9)

    const jitter = odo.observe(northOf(start, 10.5), 2_200)
    expect(jitter.reason).toBe('jitter')
    expect(jitter.totalMeters).toBe(step.totalMeters)
  })

  it('rejects GPS jumps without resetting the total', () => {
    const odo = createRouteOdometer({ maxJumpMeters: 50 })
    const start: LatLng = [41.93, 45.47]
    odo.observe(start, 1_000)
    odo.observe(northOf(start, 20), 2_000)
    const before = odo.getTotalMeters()
    const jump = odo.observe(northOf(start, 500), 2_500)
    expect(jump.reason).toBe('jump')
    expect(odo.getTotalMeters()).toBe(before)
  })

  it('restore keeps meters and re-anchors so resume does not invent a teleport', () => {
    const odo = createRouteOdometer()
    odo.restore(1_250)
    expect(odo.getTotalMeters()).toBe(1_250)
    const start: LatLng = [41.93, 45.47]
    expect(odo.observe(start, 5_000).reason).toBe('anchor')
    expect(odo.getTotalMeters()).toBe(1_250)
    const next = odo.observe(northOf(start, 15), 6_000)
    expect(next.accepted).toBe(true)
    expect(odo.getTotalMeters()).toBeGreaterThan(1_260)
  })

  it('reset clears distance for a new route', () => {
    const odo = createRouteOdometer()
    const start: LatLng = [41.93, 45.47]
    odo.observe(start, 1_000)
    odo.observe(northOf(start, 30), 2_000)
    odo.reset()
    expect(odo.getTotalMeters()).toBe(0)
    expect(odo.getLastPosition()).toBeNull()
  })
})

describe('formatDistanceKm', () => {
  it('formats kilometres in 0.1 km (100 m) steps', () => {
    expect(distanceKmTenths(0)).toBe(0)
    expect(distanceKmTenths(80)).toBe(0.1)
    expect(distanceKmTenths(149)).toBe(0.1)
    expect(distanceKmTenths(150)).toBe(0.2)
    expect(distanceKmTenths(1_150)).toBe(1.2)
    expect(formatDistanceKm(0)).toBe('0.0 კმ')
    expect(formatDistanceKm(80)).toBe('0.1 კმ')
    expect(formatDistanceKm(12_340)).toBe('12.3 კმ')
  })
})
