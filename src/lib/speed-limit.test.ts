import { describe, expect, it } from 'vitest'
import { SPEED_KM_BANDS } from '@/data/speed-km-bands'
import {
  resolveSpeedLimitByKm,
  resolveSpeedLimitByOdometerMeters,
  resolveSpeedLimitByRoadU,
} from '@/lib/speed-limit'

const EPS = 1e-6

const EXPECTED: Record<string, readonly (readonly [number, number, number])[]> = {
  'route-1': [
    [0, 0.1, 20], [0.1, 1.85, 50], [1.85, 2.2, 40], [2.2, 3.05, 50],
    [3.05, 6.8, 40], [6.8, 8.35, 50], [8.35, 99, 20],
  ],
  'route-2': [
    [0.7, 3.1, 40], [3.1, 4.35, 60], [4.35, 5.0, 50], [5.0, 5.1, 30],
    [5.1, 5.5, 50], [5.5, 5.6, 30], [5.6, 7.6, 40], [7.6, 9.05, 50], [9.05, 99, 20],
  ],
  'route-3': [
    [2.1, 2.2, 30], [2.2, 2.85, 40], [2.85, 5.6, 50], [5.6, 5.7, 30],
    [5.7, 6.1, 50], [6.1, 6.25, 30], [6.25, 6.8, 50], [6.8, 7.1, 40],
    [7.1, 8.95, 50], [8.95, 9.1, 20],
  ],
  'route-4': [
    [0.1, 2.1, 50], [2.1, 2.2, 30], [2.2, 2.7, 50], [2.7, 2.9, 30],
    [2.9, 4.2, 50], [4.2, 4.35, 30], [4.35, 4.7, 50], [4.7, 4.85, 30],
    [4.85, 5.1, 40], [5.1, 5.3, 30], [5.3, 5.7, 40], [5.7, 5.8, 30],
    [5.8, 6.55, 40], [6.55, 8.05, 50], [8.05, 99, 20],
  ],
}

describe('authoritative kilometer speed bands', () => {
  for (const [slug, rows] of Object.entries(EXPECTED)) {
    it(`${slug} contains every interval and exact boundaries`, () => {
      for (const [from, to, limit] of rows) {
        expect(resolveSpeedLimitByKm(slug, from)).toBe(limit)
        expect(resolveSpeedLimitByKm(slug, from + EPS)).toBe(limit)
        expect(resolveSpeedLimitByOdometerMeters(slug, Math.round(from * 1000))).toBe(limit)
        if (to !== 99) {
          expect(resolveSpeedLimitByKm(slug, to - EPS)).toBe(limit)
          expect(resolveSpeedLimitByOdometerMeters(slug, Math.round(to * 1000) - 1)).toBe(limit)
        }
      }

      const bands = SPEED_KM_BANDS[slug]!
      for (let i = 1; i < bands.length; i += 1) {
        expect(bands[i]!.fromKm).toBe(bands[i - 1]!.toKm)
      }
      for (const band of bands) {
        expect(band.toKm).toBeGreaterThan(band.fromKm)
      }
    })
  }

  it('transitions exactly to the next speed', () => {
    expect(resolveSpeedLimitByKm('route-1', 2.2 - EPS)).toBe(40)
    expect(resolveSpeedLimitByKm('route-1', 2.2)).toBe(50)
    expect(resolveSpeedLimitByKm('route-2', 7.6 - EPS)).toBe(40)
    expect(resolveSpeedLimitByKm('route-2', 7.6)).toBe(50)
    expect(resolveSpeedLimitByKm('route-3', 8.95 - EPS)).toBe(50)
    expect(resolveSpeedLimitByKm('route-3', 8.95)).toBe(20)
    expect(resolveSpeedLimitByKm('route-4', 5.7 - EPS)).toBe(40)
    expect(resolveSpeedLimitByKm('route-4', 5.7)).toBe(30)
  })

  it('roadU and odometer both use kilometer bands', () => {
    expect(resolveSpeedLimitByRoadU('route-3', 0, [[41.9, 45.4], [41.91, 45.41]])).toBe(50)
    expect(resolveSpeedLimitByOdometerMeters('route-4', 5_700)).toBe(30)
  })
})
