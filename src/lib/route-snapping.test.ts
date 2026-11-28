import { describe, expect, it } from 'vitest'
import { distanceToRoute, isOnRoute, snapToRoute } from './route-snapping'
import type { LatLng } from './gps'

// East-west road along latitude 41.92.
const ROAD: LatLng[] = [
  [41.92, 45.47],
  [41.92, 45.48],
]
const M_PER_DEG_LAT = 111_195

describe('route-snapping distances are metres', () => {
  it('reports ~20 m for a point 20 m north of the road', () => {
    const point: LatLng = [41.92 + 20 / M_PER_DEG_LAT, 45.475]
    expect(distanceToRoute(point, ROAD)).toBeGreaterThan(19)
    expect(distanceToRoute(point, ROAD)).toBeLessThan(21)
    expect(isOnRoute(point, ROAD, 50)).toBe(true)
  })

  it('snaps within the max distance and leaves far points unchanged', () => {
    const near: LatLng = [41.92 + 20 / M_PER_DEG_LAT, 45.475]
    const snapped = snapToRoute(near, ROAD, 50)
    expect(snapped[0]).toBeCloseTo(41.92, 6)
    const far: LatLng = [41.92 + 200 / M_PER_DEG_LAT, 45.475]
    expect(snapToRoute(far, ROAD, 50)).toEqual(far)
    expect(isOnRoute(far, ROAD, 50)).toBe(false)
  })
})
