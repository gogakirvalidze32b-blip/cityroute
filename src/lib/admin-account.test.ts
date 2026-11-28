import { describe, expect, it } from 'vitest'
import { ADMIN_HOME_PATH, isAdminOnlyAccount } from './admin-account'

describe('admin-only account', () => {
  it('matches only cityroute.ge@gmail.com (case/space-insensitive)', () => {
    expect(isAdminOnlyAccount({ email: 'cityroute.ge@gmail.com' })).toBe(true)
    expect(isAdminOnlyAccount({ email: '  CityRoute.GE@Gmail.com ' })).toBe(true)
    for (const email of ['gogakirvalidze@gmail.com', 'cityroute.ge@gmail.com.evil', 'xcityroute.ge@gmail.com', '', null, undefined]) {
      expect(isAdminOnlyAccount({ email }), String(email)).toBe(false)
    }
    expect(isAdminOnlyAccount(null)).toBe(false)
    expect(ADMIN_HOME_PATH).toBe('/support-admin')
  })
})
