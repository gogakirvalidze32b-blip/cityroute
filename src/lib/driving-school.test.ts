import { describe, expect, it } from 'vitest'
import {
  canPurchaseDrivingSchoolPackage,
  DEFAULT_DRIVING_SCHOOL_PACKAGES,
  DRIVING_SCHOOL_CAR_COUNTS,
  formatDrivingSchoolPrice,
  parseDrivingSchoolPackage,
  validateDrivingSchoolApplication,
  type DrivingSchoolApplication,
} from './driving-school'

const validApplication: DrivingSchoolApplication = {
  name: 'ავტოსკოლა თელავი',
  contactName: 'გიორგი',
  contactPhone: '+995 555 12 34 56',
  contactEmail: 'school@example.com',
  address: 'ერეკლე II-ის გამზ. 1',
  city: 'თელავი',
  registrationCode: '404123456',
  verificationInfo: 'ლიცენზია №123',
}

describe('driving-school packages', () => {
  it('offers only 5 and 10 cars and never the individual 1/2-car packages', () => {
    expect([...DRIVING_SCHOOL_CAR_COUNTS]).toEqual([5, 10])
    expect(DEFAULT_DRIVING_SCHOOL_PACKAGES.map((item) => item.car_count)).toEqual([5, 10])
    for (const carCount of [1, 2, 3, 99, 179]) {
      expect(() =>
        parseDrivingSchoolPackage({ car_count: carCount, price_amount: 99, currency: 'GEL', duration_days: 30, sort_order: 1 }),
      ).toThrow()
    }
  })

  it('shows "price to be determined" when no price is set', () => {
    expect(formatDrivingSchoolPrice({ price_amount: null })).toBe('ფასი დაზუსტდება')
    expect(formatDrivingSchoolPrice({ price_amount: 450 })).toBe('450 ₾')
  })

  it('only lets an Approved school buy a priced package', () => {
    const priced = { car_count: 5 as const, price_amount: 400 }
    const unpriced = { car_count: 10 as const, price_amount: null }
    expect(canPurchaseDrivingSchoolPackage(null, priced)).toBe(false)
    expect(canPurchaseDrivingSchoolPackage({ status: 'pending' }, priced)).toBe(false)
    expect(canPurchaseDrivingSchoolPackage({ status: 'rejected' }, priced)).toBe(false)
    expect(canPurchaseDrivingSchoolPackage({ status: 'approved' }, unpriced)).toBe(false)
    expect(canPurchaseDrivingSchoolPackage({ status: 'approved' }, priced)).toBe(true)
    expect(
      canPurchaseDrivingSchoolPackage({ status: 'approved' }, { car_count: 2 as unknown as 5, price_amount: 179 }),
    ).toBe(false)
  })

  it('validates the registration form like the database constraints', () => {
    expect(validateDrivingSchoolApplication(validApplication)).toEqual({})
    expect(validateDrivingSchoolApplication({ ...validApplication, registrationCode: '', verificationInfo: '' })).toEqual({})
    const errors = validateDrivingSchoolApplication({
      ...validApplication,
      name: ' ',
      contactPhone: 'abc',
      contactEmail: 'not-an-email',
      address: 'x',
      registrationCode: '!!',
    })
    expect(Object.keys(errors).sort()).toEqual(['address', 'contactEmail', 'contactPhone', 'name', 'registrationCode'])
  })
})
