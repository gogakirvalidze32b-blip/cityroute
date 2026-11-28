import { beforeEach, describe, expect, it, vi } from 'vitest'

const sb = vi.hoisted(() => ({
  rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: 'car-1' as unknown, error: null as unknown })),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ rpc: sb.rpc }),
}))

import {
  activeCarCount,
  canAddCar,
  currentOwnerLicense,
  freeCarSlots,
  ownerCarErrorMessage,
  ownerSetCarStatus,
  ownerUpsertCar,
} from './driving-school'

const future = new Date(Date.now() + 10 * 86_400_000).toISOString()
const past = new Date(Date.now() - 1000).toISOString()

describe('owner car management helpers', () => {
  beforeEach(() => {
    sb.rpc.mockClear()
    sb.rpc.mockResolvedValue({ data: 'car-1', error: null })
  })

  it('counts only an active, unexpired license', () => {
    const base = { id: 'l', car_count: 5 as const, starts_at: '' }
    expect(currentOwnerLicense([{ ...base, status: 'active', expires_at: past }])).toBeNull()
    expect(currentOwnerLicense([{ ...base, status: 'revoked', expires_at: future }])).toBeNull()
    expect(currentOwnerLicense([{ ...base, status: 'active', expires_at: future }])?.id).toBe('l')
  })

  it('offers only free slots within the license and enforces the 5/10 car limit', () => {
    const cars = [
      { slot_number: 1, status: 'active' as const },
      { slot_number: 3, status: 'disabled' as const },
    ]
    expect(freeCarSlots(5, cars)).toEqual([2, 4, 5])
    expect(activeCarCount(cars)).toBe(1)
    expect(canAddCar(null, [])).toBe(false)
    expect(canAddCar({ car_count: 5 }, cars)).toBe(true)

    const full = [1, 2, 3, 4, 5].map((slot) => ({ slot_number: slot, status: 'active' as const }))
    expect(freeCarSlots(5, full)).toEqual([])
    expect(canAddCar({ car_count: 5 }, full)).toBe(false)
    expect(canAddCar({ car_count: 10 }, full)).toBe(true)
  })

  it('adds/renames a car only through owner_upsert_driving_school_car', async () => {
    await expect(ownerUpsertCar(2, '  AA-123-BB ')).resolves.toBe('car-1')
    expect(sb.rpc).toHaveBeenCalledWith('owner_upsert_driving_school_car', { p_slot_number: 2, p_label: 'AA-123-BB' })
    await expect(ownerUpsertCar(11, '')).rejects.toThrow()
    await expect(ownerUpsertCar(1, 'x'.repeat(61))).rejects.toThrow()
    expect(sb.rpc).toHaveBeenCalledTimes(1)
  })

  it('changes car status only through owner_set_driving_school_car_status', async () => {
    for (const action of ['disable', 'enable', 'release_device'] as const) {
      await ownerSetCarStatus('car-9', action)
      expect(sb.rpc).toHaveBeenLastCalledWith('owner_set_driving_school_car_status', { p_car_id: 'car-9', p_action: action })
    }
    await expect(ownerSetCarStatus('car-9', 'delete' as 'disable')).rejects.toThrow()
  })

  it('translates database limit and permission errors', () => {
    expect(ownerCarErrorMessage({ message: 'Car slot 6 exceeds the active driving-school license (5 cars)' })).toMatch(/ლიმიტი/)
    expect(ownerCarErrorMessage({ message: 'Driving-school license allows only 5 active cars' })).toMatch(/ლიმიტი/)
    expect(ownerCarErrorMessage({ message: 'Only an approved driving-school owner can manage cars' })).toMatch(/დადასტურებული/)
    expect(ownerCarErrorMessage({ message: 'boom' })).toMatch(/ვერ შესრულდა/)
  })
})
