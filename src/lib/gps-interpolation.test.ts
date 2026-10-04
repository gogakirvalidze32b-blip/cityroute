import { describe, it, expect } from 'vitest'
import { GpsInterpolator } from './gps-interpolation.ts'

globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0) as unknown as number
globalThis.cancelAnimationFrame = (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>)

describe('GpsInterpolator', () => {
  it('accepts minor heading changes while moving', () => {
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
  })
})