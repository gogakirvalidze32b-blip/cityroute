import { afterEach, describe, expect, it, vi } from 'vitest'
import { GpsInterpolator } from './gps-interpolation'

describe('GpsInterpolator', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts minor heading changes while moving', () => {
    vi.stubGlobal('requestAnimationFrame', () => 0)
    vi.stubGlobal('cancelAnimationFrame', () => {})

    const interpolator = new GpsInterpolator()

    interpolator.updateTarget({
      position: [0, 0],
      heading: 10,
      speed: 10,
      timestamp: 1000,
    })

    interpolator.updateTarget({
      position: [0, 0],
      heading: 13,
      speed: 10,
      timestamp: 1100,
    })

    expect(interpolator['targetState']?.heading).toBe(13)
    interpolator.stop()
  })
})
