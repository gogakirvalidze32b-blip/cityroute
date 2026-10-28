import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/011_bog_live_premium_support.sql'),
  'utf8',
)
const bogApiRoutes = [
  'api/payments/bog/initialize.ts',
  'api/payments/bog/verify.ts',
  'api/payments/bog/callback.ts',
].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))

describe('BOG Live Production migration contract', () => {
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
})
