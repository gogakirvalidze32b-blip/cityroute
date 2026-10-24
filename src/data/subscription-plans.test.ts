import { describe, expect, it } from 'vitest'
import { calculatePrice } from './subscription-plans'

describe('Premium package pricing', () => {
  it('uses the requested monthly price for one or two vehicles', () => {
    expect(calculatePrice('premium', 1)).toBe(99)
    expect(calculatePrice('premium', 2)).toBe(179)
  })
})
