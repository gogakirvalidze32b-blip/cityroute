import { beforeEach, describe, expect, it, vi } from 'vitest'

const sb = vi.hoisted(() => {
  const calls: { table: string; eq: [string, unknown][]; order: string[] }[] = []
  const result = { data: [] as unknown, error: null as unknown }
  const rpc = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ data: 'license-1' as unknown, error: null as unknown }))
  function from(table: string) {
    const call = { table, eq: [] as [string, unknown][], order: [] as string[] }
    calls.push(call)
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        call.eq.push([column, value])
        return builder
      },
      order: (column: string) => {
        call.order.push(column)
        return builder
      },
      then: (resolve: (value: typeof result) => unknown) => resolve(result),
    }
    return builder
  }
  return { calls, result, rpc, from, insert: vi.fn(), update: vi.fn() }
})

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: sb.from, rpc: sb.rpc }),
}))

import {
  activeLicense,
  adminGrantDrivingSchoolLicense,
  adminListDrivingSchools,
  adminReviewDrivingSchool,
  canGrantLicense,
  DEFAULT_LICENSE_DURATION_DAYS,
  validateReview,
  type AdminDrivingSchoolLicense,
} from './driving-school-admin'

describe('driving-school admin data access', () => {
  beforeEach(() => {
    sb.calls.length = 0
    sb.result.data = []
    sb.result.error = null
    sb.rpc.mockClear()
    sb.rpc.mockResolvedValue({ data: 'license-1', error: null })
  })

  it('filters the RLS-protected list by status, and "all" adds no status filter', async () => {
    await adminListDrivingSchools('pending')
    expect(sb.calls[0]).toMatchObject({ table: 'driving_schools', eq: [['status', 'pending']], order: ['submitted_at'] })
    await adminListDrivingSchools('all')
    expect(sb.calls[1]).toMatchObject({ table: 'driving_schools', eq: [] })
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('surfaces database errors from the list', async () => {
    sb.result.error = { message: 'permission denied' }
    await expect(adminListDrivingSchools('approved')).rejects.toEqual({ message: 'permission denied' })
  })

  it('approves/rejects only through admin_review_driving_school with exact arguments', async () => {
    await adminReviewDrivingSchool('school-1', 'approved', '  ')
    expect(sb.rpc).toHaveBeenLastCalledWith('admin_review_driving_school', {
      p_school_id: 'school-1',
      p_decision: 'approved',
      p_note: null,
    })
    await adminReviewDrivingSchool('school-1', 'rejected', '  არასრული მონაცემები ')
    expect(sb.rpc).toHaveBeenLastCalledWith('admin_review_driving_school', {
      p_school_id: 'school-1',
      p_decision: 'rejected',
      p_note: 'არასრული მონაცემები',
    })
  })

  it('requires a reason to reject and caps the note length', async () => {
    expect(validateReview('rejected', '')).not.toBeNull()
    expect(validateReview('approved', '')).toBeNull()
    expect(validateReview('approved', 'x'.repeat(1001))).not.toBeNull()
    await expect(adminReviewDrivingSchool('school-1', 'rejected', '')).rejects.toThrow()
    expect(sb.rpc).not.toHaveBeenCalled()
  })

  it('grants only 5 or 10 cars to Approved schools, with a 30-day default', async () => {
    expect(DEFAULT_LICENSE_DURATION_DAYS).toBe(30)
    expect(canGrantLicense({ status: 'approved' }, 5)).toBe(true)
    expect(canGrantLicense({ status: 'approved' }, 10)).toBe(true)
    expect(canGrantLicense({ status: 'approved' }, 2)).toBe(false)
    expect(canGrantLicense({ status: 'pending' }, 5)).toBe(false)
    expect(canGrantLicense({ status: 'rejected' }, 10)).toBe(false)
    expect(canGrantLicense(null, 5)).toBe(false)

    await expect(adminGrantDrivingSchoolLicense({ id: 's', status: 'pending' }, 5)).rejects.toThrow()
    await expect(adminGrantDrivingSchoolLicense({ id: 's', status: 'rejected' }, 10)).rejects.toThrow()
    await expect(adminGrantDrivingSchoolLicense({ id: 's', status: 'approved' }, 2 as 5)).rejects.toThrow()
    await expect(adminGrantDrivingSchoolLicense({ id: 's', status: 'approved' }, 5, 0)).rejects.toThrow()
    expect(sb.rpc).not.toHaveBeenCalled()

    await expect(adminGrantDrivingSchoolLicense({ id: 'school-1', status: 'approved' }, 10)).resolves.toBe('license-1')
    expect(sb.rpc).toHaveBeenLastCalledWith('admin_grant_driving_school_license', {
      p_school_id: 'school-1',
      p_car_count: 10,
      p_duration_days: 30,
    })
  })

  it('treats an expired "active" license as not active', () => {
    const base = { id: 'l', school_id: 's', car_count: 5, source: 'admin', price_amount: null, starts_at: '', granted_by: null, created_at: '' } as const
    const licenses: AdminDrivingSchoolLicense[] = [
      { ...base, status: 'active', expires_at: new Date(Date.now() - 1000).toISOString() },
      { ...base, id: 'old', status: 'replaced', expires_at: new Date(Date.now() + 1e9).toISOString() },
    ]
    expect(activeLicense(licenses)).toBeNull()
    const valid = { ...base, id: 'ok', status: 'active' as const, expires_at: new Date(Date.now() + 1e9).toISOString() }
    expect(activeLicense([valid])?.id).toBe('ok')
  })
})
