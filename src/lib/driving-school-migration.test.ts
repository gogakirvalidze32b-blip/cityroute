import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const school = read('supabase/migrations/038_driving_school_packages.sql')
// The individual 99/179 catalog (device_slot_packages) is created on Preview by
// 029_dynamic_device_limits.sql (seed rows + broad CHECKs). 0291 is an alternative
// for an empty database with a strict 99/179-only CHECK; it is NOT applied on
// Preview (its preflight aborts when the table exists). Both files are checked so
// that neither seeds anything other than 1 = 99 GEL and 2 = 179 GEL.
const previewCatalog = read('supabase/migrations/029_dynamic_device_limits.sql')
const alternativeFixedCatalog = read('supabase/migrations/0291_bog_fixed_device_slot_packages.sql')
// SQL without comments, so the isolation notes in the header do not count as usage.
const schoolSql = school.replace(/--.*$/gm, '')

describe('driving-school migration isolation from individual 99 ₾ / 179 ₾ packages', () => {
  it('does not touch any table or function of the individual Premium system', () => {
    for (const name of [
      'profiles',
      'device_slot_packages',
      'payment_transactions',
      'device_session_limit_overrides',
      'device_sessions',
      'current_device_session_limit',
      'current_verified_premium_device_slots',
      'verified_device_slot_limit',
      'create_bog_pending_payment',
      'update_bog_payment_status',
      'bog_fixed_device_package_matches',
      'confirmed_bog_activation_matches',
      'has_active_access',
      'select_subscription_plan',
      'get_current_account_entitlement',
    ]) {
      expect(schoolSql, name).not.toMatch(new RegExp(`public\\.${name}\\b`, 'i'))
    }
    expect(schoolSql).not.toMatch(/\b(drop|truncate)\b/i)
    expect(schoolSql).not.toMatch(/\balter\s+table\s+public\.(?!driving_school)/i)
    expect(schoolSql).not.toMatch(/\b(update|insert\s+into|delete\s+from)\s+public\.(?!driving_school)/i)
    expect(schoolSql).not.toMatch(/create\s+or\s+replace\s+function\s+public\.(?!(driving_school|enforce_driving_school|submit_driving_school|admin_review_driving_school|admin_grant_driving_school|owner_upsert_driving_school|owner_set_driving_school))/i)
  })

  it('seeds the individual catalog only with 1 car = 99 GEL and 2 cars = 179 GEL, and no later migration changes it', () => {
    // 029 — the migration actually applied on Preview.
    expect(previewCatalog).toMatch(/create table public\.device_slot_packages/)
    expect(previewCatalog).toMatch(/\('premium', 1, 99, 'GEL', true, 1\),\s*\('premium', 2, 179, 'GEL', true, 2\)\s*on conflict/)
    expect(previewCatalog).toMatch(/grant select on public\.device_slot_packages to anon, authenticated;/)
    expect(previewCatalog).toMatch(/alter table public\.device_slot_packages force row level security;/)
    // 0291 — alternative (empty-DB only, not applied on Preview); its strict CHECK must stay 99/179.
    expect(alternativeFixedCatalog).toMatch(/\(device_slots = 1 and price_amount = 99\)\s*or \(device_slots = 2 and price_amount = 179\)/)
    expect(alternativeFixedCatalog).toMatch(/\('premium', 1, 99, 'GEL', true, 1\),\s*\('premium', 2, 179, 'GEL', true, 2\);/)
    expect(alternativeFixedCatalog).toMatch(/device_slot_packages already exists/)
    const later = readdirSync(resolve(root, 'supabase/migrations')).filter((file) => /^0(3\d|4\d)_.*\.sql$/.test(file)) // everything after 029/0291
    expect(later).toContain('038_driving_school_packages.sql')
    for (const file of later) {
      const sql = read(`supabase/migrations/${file}`).replace(/--.*$/gm, '')
      expect(sql, file).not.toMatch(/(insert\s+into|(?<!before\s)update|alter\s+table|drop\s+table)\s+public\.device_slot_packages/i)
    }
  })

  it('stores 5/10-car packages in their own catalog with price to be determined', () => {
    expect(schoolSql).toMatch(/create table public\.driving_school_packages/)
    expect(schoolSql).toMatch(/car_count integer primary key check \(car_count in \(5, 10\)\)/)
    expect(schoolSql).toMatch(/\(5, null, 'GEL', 30, true, 1\),\s*\(10, null, 'GEL', 30, true, 2\);/)
  })

  it('models one owner per school, Pending/Approved/Rejected review and admin-only approval', () => {
    expect(schoolSql).toMatch(/constraint driving_schools_owner_unique unique \(owner_id\)/)
    expect(schoolSql).toMatch(/status in \('pending', 'approved', 'rejected'\)/)
    expect(schoolSql).toMatch(/admin_review_driving_school[\s\S]*?if not public\.is_support_admin\(\)/)
    expect(schoolSql).toMatch(/admin_grant_driving_school_license[\s\S]*?Only approved driving schools can receive a license/)
    expect(schoolSql).toMatch(/driving_school_package_purchasable[\s\S]*?school\.status = 'approved'[\s\S]*?package\.price_amount is not null/)
  })

  it('enforces strict car limits, expiry and future one-device-per-car binding', () => {
    expect(schoolSql).toMatch(/create unique index driving_school_licenses_one_active[\s\S]*?where status = 'active'/)
    expect(schoolSql).toMatch(/license\.expires_at > pg_catalog\.now\(\)/)
    expect(schoolSql).toMatch(/create trigger driving_school_cars_limit/)
    expect(schoolSql).toMatch(/create unique index driving_school_cars_one_device[\s\S]*?android_device_id is not null and status = 'active'/)
    expect(schoolSql).toMatch(/p_action not in \('disable', 'enable', 'release_device'\)/)
  })

  it('F1: aborts unless the migration role and every definer-function owner bypass RLS', () => {
    expect(schoolSql).toMatch(/rolname = current_user\s+and \(migration_role\.rolsuper or migration_role\.rolbypassrls\)/)
    expect(schoolSql).toMatch(/raise exception 'Migration 038 must run as a role with SUPERUSER or BYPASSRLS/)
    const postflight = schoolSql.slice(schoolSql.indexOf('$postflight$'), schoolSql.lastIndexOf('commit;'))
    expect(postflight).toMatch(/definer\.prosecdef/)
    expect(postflight).toMatch(/not \(owner_role\.rolsuper or owner_role\.rolbypassrls\)/)
    for (const fn of [
      'driving_school_active_car_limit',
      'enforce_driving_school_car_limit',
      'submit_driving_school_application',
      'admin_review_driving_school',
      'admin_grant_driving_school_license',
      'driving_school_package_purchasable',
      'owner_upsert_driving_school_car',
      'owner_set_driving_school_car_status',
    ]) {
      expect(postflight, fn).toContain(`'${fn}'`)
      expect(schoolSql, fn).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`))
    }
    expect(schoolSql.indexOf('$postflight$')).toBeGreaterThan(schoolSql.indexOf('owner_set_driving_school_car_status(uuid, text) to authenticated'))
  })

  it('F2: release_device works without an active license but car additions stay limited', () => {
    const owner = schoolSql.slice(schoolSql.indexOf('function public.owner_set_driving_school_car_status'))
    const release = owner.slice(owner.indexOf("if p_action = 'release_device' then"), owner.indexOf('  else'))
    expect(release).toMatch(/android_device_id = null/)
    expect(release).not.toMatch(/\bstatus\s*=/)
    expect(release).not.toMatch(/school\.status = 'approved'/)
    expect(release).toMatch(/school\.owner_id = auth\.uid\(\)/)
    expect(owner.slice(owner.indexOf('  else'))).toMatch(/school\.status = 'approved'/)

    const trigger = schoolSql.slice(
      schoolSql.indexOf('function public.enforce_driving_school_car_limit'),
      schoolSql.indexOf('create trigger driving_school_cars_limit'),
    )
    expect(trigger).toMatch(/tg_op = 'UPDATE'\s+and old\.status = 'active'\s+and new\.slot_number = old\.slot_number\s+and new\.school_id = old\.school_id/)
    expect(trigger).toMatch(/new\.slot_number > v_limit/)
    expect(trigger).toMatch(/v_active \+ 1 > v_limit/)
    expect(schoolSql).toMatch(/before insert or update of status, slot_number, school_id on public\.driving_school_cars/)
  })

  it('locks the new tables behind RLS with RPC-only writes', () => {
    for (const table of ['driving_schools', 'driving_school_packages', 'driving_school_licenses', 'driving_school_cars']) {
      expect(schoolSql).toMatch(new RegExp(`alter table public\\.${table} force row level security`))
    }
    expect(schoolSql).not.toMatch(/grant\s+(insert|update|delete|all)\s+on\s+public\.driving_school/i)
  })
})

describe('driving-school code isolation', () => {
  it('keeps the BOG serverless payment code and individual package loader free of school logic', () => {
    for (const file of [
      'api/_lib/bog-production.ts',
      'api/_lib/bog-payment.ts',
      'api/payments/bog/initialize.ts',
      'api/payments/bog/callback.ts',
      'api/payments/bog/verify.ts',
      'src/lib/device-slot-packages.ts',
      'src/components/PaymentButton.tsx',
      'src/context/AuthContext.tsx',
      'src/lib/device.ts',
    ]) {
      expect(read(file), file).not.toMatch(/driving_school|driving-school|DrivingSchool/)
    }
  })

  it('keeps the school client away from the individual catalog and BOG checkout', () => {
    const client = read('src/lib/driving-school.ts').replace(/\/\/.*$/gm, '')
    const component = read('src/components/DrivingSchoolPackages.tsx').replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '')
    const adminClient = read('src/lib/driving-school-admin.ts').replace(/\/\/.*$/gm, '')
    const adminPage = read('src/components/admin/DrivingSchoolsAdminPanel.tsx').replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '')
    const ownerCars = read('src/components/DrivingSchoolOwnerCars.tsx').replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '')
    for (const source of [client, component, adminClient, adminPage, ownerCars]) {
      expect(source).not.toMatch(/device_slot_packages|\/api\/payments|PaymentButton|deviceSlots|device_slots|profiles/)
    }
    // Admin writes only through the secured RPCs; no direct table writes, no service role.
    for (const source of [adminClient, adminPage]) {
      expect(source).not.toMatch(/\.(insert|update|upsert|delete)\(/)
      expect(source).not.toMatch(/service_role|SERVICE_ROLE|serviceRole/)
    }
    expect(adminClient).toMatch(/rpc\('admin_review_driving_school'/)
    expect(adminClient).toMatch(/rpc\('admin_grant_driving_school_license'/)
  })
})
