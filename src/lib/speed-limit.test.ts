import { describe, expect, it } from 'vitest'
import { createExamSession } from '@/lib/exam-session'
import {
  currentSegmentIndex,
  getPinSpeedLimit,
  isSpeedLimitViolation,
  recordSpeedLimitViolation,
  SPEED_LIMIT_ERROR_ID,
} from '@/lib/speed-limit'
import { SPEED_LIMITS_BY_ROUTE } from '@/data/speed-limits'

describe('speed limit violation', () => {
  it.each([
    [50, 49, false],
    [50, 50, false],
    [50, 51, true],
    [50, 56, true],
    [30, 29, false],
    [30, 31, true],
  ])('limit %i / speed %i -> violation=%s', (limit, speed, expected) => {
    expect(isSpeedLimitViolation(speed, limit)).toBe(expected)
  })
  it('unknown limit never violates', () => {
    expect(isSpeedLimitViolation(120, null)).toBe(false)
  })
  it.each([
    [40, 40, false],
    [40, 41, true],
    [60, 60, false],
    [60, 61, true],
    [90, 90, false],
    [90, 91, true],
  ])('limit %i / speed %i -> violation=%s', (limit, speed, expected) => {
    expect(isSpeedLimitViolation(speed, limit)).toBe(expected)
  })
  it('null / invalid limit is never a violation at any speed', () => {
    for (const v of [0, 30, 60, 150]) {
      expect(isSpeedLimitViolation(v, null)).toBe(false)
      expect(isSpeedLimitViolation(v, Number.NaN)).toBe(false)
    }
  })
  it('all 126 entries are currently unverified (null)', () => {
    const all = Object.values(SPEED_LIMITS_BY_ROUTE).flat()
    expect(all.length).toBe(126)
    expect(all.every((e) => e.speedLimitKmh === null)).toBe(true)
  })
  it('records as a minor error in the existing system', () => {
    const s = recordSpeedLimitViolation(createExamSession('r', 'R'))
    expect(s.counts[SPEED_LIMIT_ERROR_ID].minor).toBe(1)
    expect(s.minorTotal).toBe(1)
  })
})

describe('pin -> segment', () => {
  const pins = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  it('follows the pin sequence', () => {
    expect(currentSegmentIndex(pins, pins[0])).toBe(0) // before pin 1
    expect(currentSegmentIndex(pins, pins[1])).toBe(0) // pin 1 reached
    expect(currentSegmentIndex(pins, pins[2])).toBe(1) // pin 2 reached
    expect(currentSegmentIndex(pins, null)).toBe(2) // all reached
  })
  it('data layer covers 126 pins and ignores mismatching coordinates', () => {
    const total = Object.values(SPEED_LIMITS_BY_ROUTE).reduce((n, v) => n + v.length, 0)
    expect(total).toBe(126)
    expect(getPinSpeedLimit('route-1', { sort_order: 1, lat: 0, lng: 0 })).toBeNull()
  })
})
