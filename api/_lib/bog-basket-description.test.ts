import { describe, expect, it } from 'vitest'
import { bogBasketDescription } from './bog-payment'

describe('BOG basket description (shown on the bank checkout page)', () => {
  it('is readable Georgian text, not question marks', () => {
    expect(bogBasketDescription(1)).toBe('CityRoute Premium — 1 მოწყობილობა, 30 დღე')
    expect(bogBasketDescription(2)).toBe('CityRoute Premium — 2 მოწყობილობა, 30 დღე')
    expect(bogBasketDescription(2)).not.toMatch(/\?/)
  })
})
