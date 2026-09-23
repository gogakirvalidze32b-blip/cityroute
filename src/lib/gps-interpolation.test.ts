import test from 'node:test'
import assert from 'node:assert/strict'
import { GpsInterpolator } from './gps-interpolation.ts'

globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id as number)

test('accepts minor heading changes while moving', () => {
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

  assert.equal(interpolator['targetState']?.heading, 13)
})
