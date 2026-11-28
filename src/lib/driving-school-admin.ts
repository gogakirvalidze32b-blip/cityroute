// Driving-school admin data access. Uses the signed-in user's own Supabase
// client only: reads go through RLS (admins may read all driving_school rows via
// is_support_admin()), and every write goes through the secured SECURITY DEFINER
// RPCs from migration 038, which re-check is_support_admin() in the database.
// Never uses a service-role key and never writes tables directly.
import { getSupabase } from '@/lib/supabase'
import { isDrivingSchoolCarCount, type DrivingSchoolCarCount, type DrivingSchoolStatus } from '@/lib/driving-school'

export type AdminDrivingSchool = {
  id: string
  owner_id: string
  name: string
  contact_name: string
  contact_phone: string
  contact_email: string
  address: string
  city: string
  registration_code: string | null
  verification_info: string
  status: DrivingSchoolStatus
  review_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  submitted_at: string
  created_at: string
}

export type AdminDrivingSchoolLicense = {
  id: string
  school_id: string
  car_count: DrivingSchoolCarCount
  status: 'active' | 'replaced' | 'revoked'
  source: 'admin' | 'bog'
  price_amount: number | null
  starts_at: string
  expires_at: string
  granted_by: string | null
  created_at: string
}

export type AdminDrivingSchoolCar = {
  id: string
  school_id: string
  slot_number: number
  label: string
  status: 'active' | 'disabled'
  android_device_id: string | null
  device_bound_at: string | null
  device_last_seen_at: string | null
}

export type AdminSchoolFilter = DrivingSchoolStatus | 'all'
export type AdminReviewDecision = 'approved' | 'rejected'

export const DEFAULT_LICENSE_DURATION_DAYS = 30
export const MAX_REVIEW_NOTE_LENGTH = 1000

const SCHOOL_COLUMNS =
  'id, owner_id, name, contact_name, contact_phone, contact_email, address, city, registration_code, verification_info, status, review_note, reviewed_by, reviewed_at, submitted_at, created_at'

export async function adminListDrivingSchools(filter: AdminSchoolFilter): Promise<AdminDrivingSchool[]> {
  let query = getSupabase().from('driving_schools').select(SCHOOL_COLUMNS)
  if (filter !== 'all') query = query.eq('status', filter)
  const { data, error } = await query.order('submitted_at', { ascending: false })
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid driving-school list response')
  return data as AdminDrivingSchool[]
}

export async function adminGetSchoolLicenses(schoolId: string): Promise<AdminDrivingSchoolLicense[]> {
  const { data, error } = await getSupabase()
    .from('driving_school_licenses')
    .select('id, school_id, car_count, status, source, price_amount, starts_at, expires_at, granted_by, created_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as AdminDrivingSchoolLicense[]
}

export async function adminGetSchoolCars(schoolId: string): Promise<AdminDrivingSchoolCar[]> {
  const { data, error } = await getSupabase()
    .from('driving_school_cars')
    .select('id, school_id, slot_number, label, status, android_device_id, device_bound_at, device_last_seen_at')
    .eq('school_id', schoolId)
    .order('slot_number')
  if (error) throw error
  return (data ?? []) as AdminDrivingSchoolCar[]
}

/** Client-side guard mirroring the RPC's rules; the database enforces them again. */
export function validateReview(decision: AdminReviewDecision, note: string): string | null {
  if (decision !== 'approved' && decision !== 'rejected') return 'უცნობი გადაწყვეტილება.'
  const trimmed = note.trim()
  if (trimmed.length > MAX_REVIEW_NOTE_LENGTH) return `შენიშვნა არ უნდა აღემატებოდეს ${MAX_REVIEW_NOTE_LENGTH} სიმბოლოს.`
  if (decision === 'rejected' && trimmed.length < 3) return 'უარყოფისას მიუთითე მიზეზი (მინ. 3 სიმბოლო).'
  return null
}

/** Grant is offered only for Approved schools and only for 5 or 10 cars. */
export function canGrantLicense(school: Pick<AdminDrivingSchool, 'status'> | null, carCount: unknown): boolean {
  return school?.status === 'approved' && isDrivingSchoolCarCount(carCount)
}

export function activeLicense(
  licenses: readonly AdminDrivingSchoolLicense[],
  now = Date.now(),
): AdminDrivingSchoolLicense | null {
  return licenses.find((item) => item.status === 'active' && new Date(item.expires_at).getTime() > now) ?? null
}

export async function adminReviewDrivingSchool(
  schoolId: string,
  decision: AdminReviewDecision,
  note: string,
): Promise<void> {
  const problem = validateReview(decision, note)
  if (problem) throw new Error(problem)
  const trimmed = note.trim()
  const { error } = await getSupabase().rpc('admin_review_driving_school', {
    p_school_id: schoolId,
    p_decision: decision,
    p_note: trimmed === '' ? null : trimmed,
  })
  if (error) throw error
}

export async function adminGrantDrivingSchoolLicense(
  school: Pick<AdminDrivingSchool, 'id' | 'status'>,
  carCount: DrivingSchoolCarCount,
  durationDays = DEFAULT_LICENSE_DURATION_DAYS,
): Promise<string> {
  if (!canGrantLicense(school, carCount)) {
    throw new Error('ლიცენზიის მინიჭება შესაძლებელია მხოლოდ დადასტურებულ ავტოსკოლაზე, 5 ან 10 მანქანით.')
  }
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 366) {
    throw new Error('ვადა უნდა იყოს 1-დან 366 დღემდე.')
  }
  const { data, error } = await getSupabase().rpc('admin_grant_driving_school_license', {
    p_school_id: school.id,
    p_car_count: carCount,
    p_duration_days: durationDays,
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('Invalid license grant response')
  return data
}

export function adminErrorMessage(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string'
      ? (error as { message: string }).message
      : ''
  if (/Only support admins/i.test(message)) return 'მოქმედება დაშვებულია მხოლოდ ადმინისტრატორისთვის (საჭიროა აქტიური სესია).'
  if (/Only approved driving schools/i.test(message)) return 'ლიცენზია შეიძლება მიენიჭოს მხოლოდ დადასტურებულ ავტოსკოლას.'
  if (/not found/i.test(message)) return 'ავტოსკოლა ვერ მოიძებნა.'
  if (/[ა-ჿ]/.test(message)) return message
  return 'მოქმედება ვერ შესრულდა. სცადე თავიდან.'
}
