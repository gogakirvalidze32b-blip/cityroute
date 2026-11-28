// Driving-school (ავტოსკოლა) packages — isolated from individual Premium.
// Never reads or writes device_slot_packages, profiles.device_slots or the BOG
// payment endpoints; those belong only to the 1-car 99 ₾ / 2-car 179 ₾ flow.
import { getSupabase } from '@/lib/supabase'

export const DRIVING_SCHOOL_CAR_COUNTS = [5, 10] as const
export type DrivingSchoolCarCount = (typeof DRIVING_SCHOOL_CAR_COUNTS)[number]

export type DrivingSchoolStatus = 'pending' | 'approved' | 'rejected'

export type DrivingSchoolPackage = {
  car_count: DrivingSchoolCarCount
  /** null = price to be determined; such a package is never purchasable. */
  price_amount: number | null
  currency: 'GEL'
  duration_days: number
  sort_order: number
}

export type DrivingSchool = {
  id: string
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
  submitted_at: string
}

export type DrivingSchoolApplication = {
  name: string
  contactName: string
  contactPhone: string
  contactEmail: string
  address: string
  city: string
  registrationCode: string
  verificationInfo: string
}

export const DRIVING_SCHOOL_STATUS_LABELS: Record<DrivingSchoolStatus, string> = {
  pending: 'განხილვაშია',
  approved: 'დადასტურებულია',
  rejected: 'უარყოფილია',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isDrivingSchoolCarCount(value: unknown): value is DrivingSchoolCarCount {
  return value === 5 || value === 10
}

export function parseDrivingSchoolPackage(value: unknown): DrivingSchoolPackage {
  if (
    !isRecord(value) ||
    !isDrivingSchoolCarCount(value.car_count) ||
    !(value.price_amount === null || (Number.isInteger(value.price_amount) && Number(value.price_amount) >= 1)) ||
    value.currency !== 'GEL' ||
    !Number.isInteger(value.duration_days) ||
    Number(value.duration_days) < 1 ||
    !Number.isInteger(value.sort_order)
  ) {
    throw new Error('Invalid driving-school package entry')
  }
  return value as DrivingSchoolPackage
}

/** Fallback shown when the school catalog is not deployed yet: 5 and 10 cars, price TBD. */
export const DEFAULT_DRIVING_SCHOOL_PACKAGES: readonly DrivingSchoolPackage[] = [
  { car_count: 5, price_amount: null, currency: 'GEL', duration_days: 30, sort_order: 1 },
  { car_count: 10, price_amount: null, currency: 'GEL', duration_days: 30, sort_order: 2 },
]

function isMissingRelation(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST202'
}

export async function loadDrivingSchoolPackages(): Promise<DrivingSchoolPackage[]> {
  const { data, error } = await getSupabase()
    .from('driving_school_packages')
    .select('car_count, price_amount, currency, duration_days, sort_order')
    .eq('active', true)
    .order('sort_order')
    .order('car_count')
  if (isMissingRelation(error)) return [...DEFAULT_DRIVING_SCHOOL_PACKAGES]
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Invalid driving-school package catalog response')
  return data.map(parseDrivingSchoolPackage)
}

export async function loadMyDrivingSchool(userId: string): Promise<DrivingSchool | null> {
  const { data, error } = await getSupabase()
    .from('driving_schools')
    .select('id, name, contact_name, contact_phone, contact_email, address, city, registration_code, verification_info, status, review_note, submitted_at')
    .eq('owner_id', userId)
    .maybeSingle()
  if (isMissingRelation(error)) return null
  if (error) throw error
  return (data as DrivingSchool | null) ?? null
}

/** Purchase gate: only Approved schools, and only packages with a set price. */
export function canPurchaseDrivingSchoolPackage(
  school: Pick<DrivingSchool, 'status'> | null,
  pkg: Pick<DrivingSchoolPackage, 'price_amount' | 'car_count'>,
): boolean {
  return (
    school?.status === 'approved' &&
    isDrivingSchoolCarCount(pkg.car_count) &&
    pkg.price_amount !== null &&
    Number.isInteger(pkg.price_amount) &&
    pkg.price_amount >= 1
  )
}

export function formatDrivingSchoolPrice(pkg: Pick<DrivingSchoolPackage, 'price_amount'>): string {
  return pkg.price_amount === null ? 'ფასი დაზუსტდება' : `${pkg.price_amount} ₾`
}

const PHONE_RE = /^\+?[0-9 ()-]{6,24}$/
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const REGISTRATION_RE = /^[0-9A-Za-z-]{5,20}$/

/** Mirrors the CHECK constraints of public.driving_schools; returns field -> Georgian error. */
export function validateDrivingSchoolApplication(
  input: DrivingSchoolApplication,
): Partial<Record<keyof DrivingSchoolApplication, string>> {
  const errors: Partial<Record<keyof DrivingSchoolApplication, string>> = {}
  const name = input.name.trim()
  if (name.length < 2 || name.length > 160) errors.name = 'მიუთითე ავტოსკოლის სახელი'
  const contact = input.contactName.trim()
  if (contact.length < 2 || contact.length > 120) errors.contactName = 'მიუთითე საკონტაქტო პირი'
  if (!PHONE_RE.test(input.contactPhone.trim())) errors.contactPhone = 'მიუთითე სწორი ტელეფონის ნომერი'
  const email = input.contactEmail.trim()
  if (!EMAIL_RE.test(email) || email.length > 254) errors.contactEmail = 'მიუთითე სწორი ელფოსტა'
  const address = input.address.trim()
  if (address.length < 4 || address.length > 300) errors.address = 'მიუთითე მისამართი'
  const city = input.city.trim()
  if (city && (city.length < 2 || city.length > 80)) errors.city = 'მიუთითე ქალაქი'
  const code = input.registrationCode.trim()
  if (code && !REGISTRATION_RE.test(code)) errors.registrationCode = 'საიდენტიფიკაციო კოდი არასწორია'
  if (input.verificationInfo.trim().length > 2000) errors.verificationInfo = 'ტექსტი ძალიან გრძელია'
  return errors
}

export async function submitDrivingSchoolApplication(input: DrivingSchoolApplication): Promise<string> {
  const { data, error } = await getSupabase().rpc('submit_driving_school_application', {
    p_name: input.name.trim(),
    p_contact_name: input.contactName.trim(),
    p_contact_phone: input.contactPhone.trim(),
    p_contact_email: input.contactEmail.trim(),
    p_address: input.address.trim(),
    p_city: input.city.trim(),
    p_registration_code: input.registrationCode.trim(),
    p_verification_info: input.verificationInfo.trim(),
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('Invalid driving-school application response')
  return data
}

// ---------------------------------------------------------------------------
// Owner car management (Approved schools). Reads go through RLS (owners see
// only their own school's rows); writes only through the migration-038 RPCs,
// which re-check ownership, Approved status and the car limit in the database.
// ---------------------------------------------------------------------------

export type OwnerSchoolLicense = {
  id: string
  car_count: DrivingSchoolCarCount
  status: 'active' | 'replaced' | 'revoked'
  starts_at: string
  expires_at: string
}

export type OwnerSchoolCar = {
  id: string
  slot_number: number
  label: string
  status: 'active' | 'disabled'
  android_device_id: string | null
  device_bound_at: string | null
}

export type OwnerCarAction = 'disable' | 'enable' | 'release_device'

export const MAX_CAR_LABEL_LENGTH = 60

export async function loadMySchoolLicenses(schoolId: string): Promise<OwnerSchoolLicense[]> {
  const { data, error } = await getSupabase()
    .from('driving_school_licenses')
    .select('id, car_count, status, starts_at, expires_at')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as OwnerSchoolLicense[]
}

export async function loadMySchoolCars(schoolId: string): Promise<OwnerSchoolCar[]> {
  const { data, error } = await getSupabase()
    .from('driving_school_cars')
    .select('id, slot_number, label, status, android_device_id, device_bound_at')
    .eq('school_id', schoolId)
    .order('slot_number')
  if (error) throw error
  return (data ?? []) as OwnerSchoolCar[]
}

/** The license that currently counts: status active and not expired. */
export function currentOwnerLicense(
  licenses: readonly OwnerSchoolLicense[],
  now = Date.now(),
): OwnerSchoolLicense | null {
  return licenses.find((item) => item.status === 'active' && new Date(item.expires_at).getTime() > now) ?? null
}

/** Slots 1..limit that have no car row yet (a disabled car still occupies its slot). */
export function freeCarSlots(limit: number, cars: readonly Pick<OwnerSchoolCar, 'slot_number'>[]): number[] {
  const used = new Set(cars.map((car) => car.slot_number))
  const free: number[] = []
  for (let slot = 1; slot <= limit; slot += 1) if (!used.has(slot)) free.push(slot)
  return free
}

export function activeCarCount(cars: readonly Pick<OwnerSchoolCar, 'status'>[]): number {
  return cars.filter((car) => car.status === 'active').length
}

/** Client-side mirror of the database limit; the trigger enforces it again. */
export function canAddCar(
  license: Pick<OwnerSchoolLicense, 'car_count'> | null,
  cars: readonly Pick<OwnerSchoolCar, 'slot_number' | 'status'>[],
): boolean {
  if (!license) return false
  return activeCarCount(cars) < license.car_count && freeCarSlots(license.car_count, cars).length > 0
}

export async function ownerUpsertCar(slotNumber: number, label: string): Promise<string> {
  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 10) throw new Error('არასწორი slot.')
  const trimmed = label.trim()
  if (trimmed.length > MAX_CAR_LABEL_LENGTH) throw new Error(`დასახელება არ უნდა აღემატებოდეს ${MAX_CAR_LABEL_LENGTH} სიმბოლოს.`)
  const { data, error } = await getSupabase().rpc('owner_upsert_driving_school_car', {
    p_slot_number: slotNumber,
    p_label: trimmed,
  })
  if (error) throw error
  if (typeof data !== 'string') throw new Error('Invalid car response')
  return data
}

export async function ownerSetCarStatus(carId: string, action: OwnerCarAction): Promise<void> {
  if (action !== 'disable' && action !== 'enable' && action !== 'release_device') throw new Error('Unknown car action')
  const { error } = await getSupabase().rpc('owner_set_driving_school_car_status', {
    p_car_id: carId,
    p_action: action,
  })
  if (error) throw error
}

export function ownerCarErrorMessage(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message: unknown }).message === 'string'
      ? (error as { message: string }).message
      : ''
  if (/exceeds the active driving-school license|allows only/i.test(message)) return 'ლიცენზიის მანქანების ლიმიტი ამოწურულია.'
  if (/Only an approved driving-school owner/i.test(message)) return 'მანქანების მართვა შეუძლია მხოლოდ დადასტურებული ავტოსკოლის მფლობელს.'
  if (/Sign in again/i.test(message)) return 'სესია აღარ არის აქტიური. შედი თავიდან.'
  if (/Car not found/i.test(message)) return 'მანქანა ვერ მოიძებნა.'
  if (/[ა-ჿ]/.test(message)) return message
  return 'მოქმედება ვერ შესრულდა. სცადე თავიდან.'
}
