import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/011_bog_live_premium_support.sql'),
  'utf8',
)
const sessionMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/015_single_active_auth_session.sql'),
  'utf8',
)
const overrideMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/017_admin_session_limit_override.sql'),
  'utf8',
)
const bogApiRoutes = [
  'api/payments/bog/initialize.ts',
  'api/payments/bog/verify.ts',
  'api/payments/bog/callback.ts',
].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
const confirmerMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/033_bog_confirmer_isolation.sql'),
  'utf8',
)
const fixedPackageMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0291_bog_fixed_device_slot_packages.sql'),
  'utf8',
)
const trialGuardMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/032_downgrade_session_and_trial_guard.sql'),
  'utf8',
)
const trialGuardTest = readFileSync(
  resolve(process.cwd(), 'supabase/tests/032_downgrade_session_and_trial_guard.test.sql'),
  'utf8',
)
const fixedPackageTest = readFileSync(
  resolve(process.cwd(), 'supabase/tests/0291_bog_fixed_device_slot_packages.test.sql'),
  'utf8',
)
const bogHardeningMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/034_bog_pending_claim_abuse_protection.sql'),
  'utf8',
)
const bogHardeningTest = readFileSync(
  resolve(process.cwd(), 'supabase/tests/034_bog_pending_claim_abuse_protection.test.sql'),
  'utf8',
)
const bogRecoveryLeaseMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/035_bog_checkout_recovery_lease.sql'),
  'utf8',
)
const bogProduction = readFileSync(
  resolve(process.cwd(), 'api/_lib/bog-production.ts'),
  'utf8',
)

describe('BOG Live Production migration contract', () => {
  it('restricts recovery leases to service-role RPCs and serializes eligible claims', () => {
    expect(bogRecoveryLeaseMigration).toMatch(/create table public\.bog_checkout_recovery_leases/i)
    expect(bogRecoveryLeaseMigration).toMatch(/alter table public\.bog_checkout_recovery_leases enable row level security/i)
    expect(bogRecoveryLeaseMigration).not.toMatch(/force row level security/i)
    expect(bogRecoveryLeaseMigration).toMatch(/revoke all on public\.bog_checkout_recovery_leases from public, anon, authenticated, service_role/i)
    expect(bogRecoveryLeaseMigration).toMatch(/auth\.role\(\) is distinct from 'service_role'/i)
    expect(bogRecoveryLeaseMigration).toMatch(/payment\.status in \('pending', 'processing'\)/i)
    expect(bogRecoveryLeaseMigration).toMatch(/checkout_phase' in \('bank_call', 'ready'\)/i)
    expect(bogRecoveryLeaseMigration).toMatch(/for update/i)
    expect(bogRecoveryLeaseMigration).toMatch(/lease_expires_at <= pg_catalog\.clock_timestamp\(\)/i)
    expect(bogRecoveryLeaseMigration).toMatch(/grant execute on function public\.acquire_bog_checkout_recovery_lease\(text, integer\)\s+to service_role/i)
    expect(bogRecoveryLeaseMigration).toMatch(/grant execute on function public\.release_bog_checkout_recovery_lease\(text, uuid\)\s+to service_role/i)
    expect(bogRecoveryLeaseMigration).toMatch(/lease_token = p_lease_token/i)
  })

  it('preserves raw request bodies for the BOG Vercel API handlers', () => {
    for (const route of bogApiRoutes) {
      expect(route).toMatch(/export const config = \{ api: \{ bodyParser: false \} \}/)
    }
  })

  it('extends the existing payment table and leaves the generic payment RPC untouched', () => {
    expect(migration).toMatch(/to_regclass\('public\.payment_transactions'\) is null/i)
    expect(migration).toMatch(/alter table public\.payment_transactions\s+add column if not exists idempotency_key uuid/i)
    expect(migration).toMatch(/create or replace function public\.update_bog_payment_status/i)
    expect(migration).not.toMatch(/create table(?: if not exists)? public\.payment_transactions/i)
    expect(migration).not.toMatch(/create or replace function public\.update_payment_status\s*\(/i)
    expect(migration).toMatch(/revoke execute on function public\.update_bog_payment_status[\s\S]*from public, anon, authenticated/i)
    expect(migration).toMatch(/grant execute on function public\.update_bog_payment_status[\s\S]*to service_role/i)
  })

  it('checks receipt identity, GEL amounts, status transitions, and Premium activation only on success', () => {
    expect(migration).toMatch(/p_metadata->>'bank_external_order_id'\s+is distinct from v_merchant_payment_id/i)
    expect(migration).toMatch(/p_metadata->>'bank_currency'\s+is distinct from v_currency/i)
    expect(migration).toMatch(/v_amount not in \(99, 179\)/i)
    expect(migration).toMatch(/v_current_status = 'pending'[\s\S]*p_status in \('processing', 'success', 'failed', 'cancelled'\)/i)
    expect(migration).toMatch(/if p_status = 'success' then\s+update public\.profiles/i)
    expect(migration).not.toMatch(/if p_status in \('success', 'refunded_partially'\) then\s+update public\.profiles/i)
    expect(migration).toMatch(/Cumulative partial refund amount cannot decrease/i)
  })

  it('enforces active auth sessions and verified two-device subscriptions server-side', () => {
    expect(sessionMigration).toMatch(/create (?:or replace )?function public\.activate_current_session\(\)/i)
    expect(sessionMigration).toMatch(/create or replace function public\.has_current_active_session\(\)/i)
    expect(sessionMigration).toMatch(/public\.current_device_session_limit\(c\.user_id\)/i)
    expect(sessionMigration).toMatch(/t\.amount = 179[\s\S]*t\.currency = 'GEL'/i)
    expect(sessionMigration).toMatch(/t\.metadata->>'device_slots' = '2'/i)
    expect(sessionMigration).toMatch(/create or replace function public\.deactivate_current_session\(\)/i)
    expect(sessionMigration).toMatch(/public\.has_current_active_session\(\)/i)
    expect(migration).toMatch(/v_amount not in \(99, 179\)/i)
  })

  it('grants permanent second sessions only through audited support-admin RPCs', () => {
    expect(overrideMigration).toMatch(/create table public\.device_session_limit_overrides/i)
    expect(overrideMigration).toMatch(/where revoked_at is null/i)
    expect(overrideMigration).toMatch(/when exists \([\s\S]*device_session_limit_overrides[\s\S]*then 2/i)
    expect(overrideMigration).toMatch(/Only an active support admin may grant session overrides/i)
    expect(overrideMigration).toMatch(/Only an active support admin may revoke session overrides/i)
    expect(overrideMigration).toMatch(/grant execute on function public\.grant_device_session_limit_override/i)
    expect(overrideMigration).toMatch(/grant execute on function public\.revoke_device_session_limit_override/i)
  })

  it('isolates BOG settlement to cityroute_bog_confirmer and locks pending identity fields', () => {
    expect(confirmerMigration).toMatch(/create role cityroute_bog_confirmer nologin/i)
    expect(confirmerMigration).toMatch(/revoke cityroute_bog_confirmer from service_role/i)
    expect(confirmerMigration).toMatch(/auth\.role\(\) is distinct from 'cityroute_bog_confirmer'/i)
    expect(confirmerMigration).toMatch(/revoke execute on function public\.update_bog_payment_status[\s\S]*service_role/i)
    expect(confirmerMigration).toMatch(/grant execute on function public\.update_bog_payment_status[\s\S]*to cityroute_bog_confirmer/i)
    expect(confirmerMigration).toMatch(/create or replace function public\.create_bog_pending_payment/i)
    expect(confirmerMigration).toMatch(/p_idempotency_key uuid/i)
    expect(confirmerMigration).toMatch(/to_regclass\('public\.device_slot_packages'\) is null/i)
    expect(confirmerMigration).toMatch(/to_regclass\('public\.payment_transactions_user_bog_idempotency_key'\) is null/i)
    expect(confirmerMigration).toMatch(/auth\.role\(\) is distinct from 'authenticated'[\s\S]*auth\.uid\(\) is distinct from p_user_id/i)
    expect(confirmerMigration).toMatch(/grant execute on function public\.create_bog_pending_payment[\s\S]*to authenticated/i)
    expect(confirmerMigration).toMatch(/revoke all on function public\.create_bog_pending_payment[\s\S]*cityroute_bog_confirmer/i)
    expect(confirmerMigration).toMatch(/new\.status is distinct from old\.status and not v_write_allowed/i)
    expect(confirmerMigration).toMatch(/BOG payment status can change only through the confirmer write path/i)
    expect(confirmerMigration).toMatch(/active package/i)
    expect(confirmerMigration).toMatch(/unsupported checkout metadata/i)
    expect(confirmerMigration).toMatch(/initial bog client request IDs must be non-empty strings/i)
    expect(confirmerMigration).toMatch(/grant select, update on table public\.payment_transactions to service_role/i)
    expect(confirmerMigration).not.toMatch(/grant select, insert, update on table public\.payment_transactions to service_role/i)
    expect(confirmerMigration).toMatch(/claim expiry may be renewed only for an expired pending claim/i)
    expect(confirmerMigration).toMatch(/bank call timestamp may be set only when a pending claim enters bank_call/i)
    expect(confirmerMigration).toMatch(/client request IDs are append-only/i)
    expect(confirmerMigration).toMatch(/BOG payment identity fields are immutable outside the confirmer write path/i)
    expect(confirmerMigration).toMatch(/BOG payment_id can change only during checkout bank_call to ready handoff/i)
    expect(confirmerMigration).toMatch(/BOG checkout handoff fields are immutable after ready/i)
    expect(confirmerMigration).toMatch(/claim_payment_id/i)
    expect(confirmerMigration).toMatch(/bank_payment_id/i)
    expect(confirmerMigration).toMatch(/v_handoff_already_done/i)
    expect(confirmerMigration).toMatch(/pg_get_userbyid\(p\.proowner\) = current_user/i)
    expect(confirmerMigration).not.toMatch(/pg_catalog\.current_user/i)
    expect(confirmerMigration).toMatch(/new\.user_id is distinct from old\.user_id/i)
    expect(confirmerMigration).toMatch(/new\.amount is distinct from old\.amount/i)
    expect(confirmerMigration).toMatch(/new\.merchant_payment_id is distinct from old\.merchant_payment_id/i)
    expect(confirmerMigration).toMatch(/new\.idempotency_key is distinct from old\.idempotency_key/i)
    expect(confirmerMigration).toMatch(/'checkout_phase'/i)
    expect(bogProduction).toMatch(/SUPABASE_BOG_CONFIRM_KEY/i)
    expect(bogProduction).toMatch(/bogConfirmKeyIsIsolated/i)
    expect(bogProduction).toMatch(/createBogConfirmerClient/i)
    expect(bogProduction).toMatch(/createClient\(supabaseUrl, anonKey, \{[\s\S]*Authorization: `Bearer \$\{confirmKey\}`/i)
    expect(bogProduction).not.toMatch(/createClient\(supabaseUrl, confirmKey/)
    expect(bogProduction).toMatch(/confirmer\.rpc\('update_bog_payment_status'/i)
    expect(bogProduction).toMatch(/checkoutClient\.rpc\('create_bog_pending_payment'/i)
    expect(bogProduction).toMatch(/global: \{ headers: \{ Authorization: `Bearer \$\{accessToken\}` \} \}/i)
    expect(bogProduction).toMatch(/assertConfirmerReady[\s\S]*rpc\('update_bog_payment_status'[\s\S]*Invalid BOG payment status update/i)
    expect(bogProduction).not.toMatch(/admin\.from\('payment_transactions'\)\.insert/i)
    expect(bogProduction).not.toMatch(/admin\.rpc\('update_bog_payment_status'/i)
  })

  it('limits BOG packages and settlement to the active fixed-price catalog', () => {
    expect(fixedPackageMigration).toMatch(/device_slot_packages_fixed_bog_packages_check/i)
    expect(fixedPackageMigration).toMatch(/device_slots = 1 and price_amount = 99/i)
    expect(fixedPackageMigration).toMatch(/device_slots = 2 and price_amount = 179/i)
    expect(fixedPackageMigration).toMatch(/force row level security/i)
    expect(fixedPackageMigration).toMatch(/revoke all on public\.device_slot_packages/i)
    expect(fixedPackageMigration).toMatch(/grant select on public\.device_slot_packages/i)
    expect(fixedPackageMigration).not.toMatch(/update_payment_status\s*\(/i)
    expect(trialGuardMigration).toMatch(/create or replace function public\.bog_fixed_device_package_matches/i)
    expect(trialGuardMigration).toMatch(/package\.active/i)
    expect(trialGuardMigration).toMatch(/p_package_price is null/i)
    expect(trialGuardMigration).toMatch(/BOG amount and device package must match an active fixed package/i)
    expect(fixedPackageTest).toMatch(/application roles have read-only catalog grants/i)
    expect(fixedPackageTest).toMatch(/database rejects packages outside the fixed BOG catalog/i)
  })

  it('preserves TBC activation through both trial-guard migrations and tests BOG rejection', () => {
    for (const guard of [trialGuardMigration, bogHardeningMigration]) {
      expect(guard).toMatch(/public\.update_payment_status\(text, text, text, text, jsonb\)/i)
      expect(guard).toMatch(/payment\.provider = 'tbc'/i)
      expect(guard).toMatch(/payment\.paid_at = pg_catalog\.transaction_timestamp\(\)/i)
      expect(guard).toMatch(/payment\.updated_at = pg_catalog\.transaction_timestamp\(\)/i)
      expect(guard).not.toMatch(/create or replace function public\.update_payment_status\s*\(/i)
    }
    expect(trialGuardTest).toMatch(/existing TBC success path can renew an active Premium profile/i)
    expect(bogHardeningTest).toMatch(/an unverified BOG pending claim cannot activate Premium/i)
    expect(bogHardeningTest).toMatch(/migration 034 preserves successful TBC renewal/i)
  })

  it('serializes and caps pending claims while correcting the trial-guard owner check forward-only', () => {
    expect(bogHardeningMigration).toMatch(/pg_catalog\.pg_advisory_xact_lock/i)
    expect(bogHardeningMigration).toMatch(/v_max_active_claims constant integer := 3/i)
    expect(bogHardeningMigration).toMatch(/transaction\.metadata->>'checkout_phase' is distinct from 'claimed'/i)
    expect(bogHardeningMigration).toMatch(/claim_expires_at[\s\S]*'infinity'::timestamptz/i)
    expect(bogHardeningMigration).toMatch(/BOG idempotency key is already bound to another payment attempt/i)
    expect(bogHardeningMigration).toMatch(/if found then[\s\S]*return;/i)
    expect(bogHardeningMigration).toMatch(/pg_catalog\.pg_get_userbyid\(p\.proowner\) = current_user/i)
    expect(bogHardeningMigration).not.toMatch(/pg_catalog\.current_user/i)
    expect(bogHardeningMigration).toMatch(/Migrations 0291, 032, and 033 must be applied before migration 034/i)
    expect(bogHardeningMigration).toMatch(/grant execute on function public\.create_bog_pending_payment[\s\S]*to authenticated/i)
    expect(bogHardeningMigration).not.toMatch(/grant execute on function public\.create_bog_pending_payment[\s\S]*to service_role/i)
  })
})
