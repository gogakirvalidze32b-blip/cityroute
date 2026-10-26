import { describe, expect, it } from 'vitest'
import { calculatePrice } from './subscription-plans'

describe('Premium device pricing', () => {
  it('prices one device at 99 GEL and two devices at 179 GEL', () => {
    expect(calculatePrice('premium', 1)).toBe(99)
    expect(calculatePrice('premium', 2)).toBe(179)
  })
})
