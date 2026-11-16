import { describe, expect, it } from 'vitest'
import { seedAlongRouteMeters } from './route-nav'
import type { LatLng } from './gps'

describe('seedAlongRouteMeters', () => {
  const line: LatLng[] = [
    [41.93, 45.47],
    [41.94, 45.47], // ~1.11 km north
    [41.95, 45.47], // ~2.22 km
  ]

  it('returns 0 without a position', () => {
    expect(seedAlongRouteMeters(line, null)).toBe(0)
  })

  it('seeds near mid-route when starting from a mid point', () => {
    const mid: LatLng = [41.94, 45.47]
    const meters = seedAlongRouteMeters(line, mid)
    expect(meters).toBeGreaterThan(1000)
    expect(meters).toBeLessThan(1300)
  })
})
