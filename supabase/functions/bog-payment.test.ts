import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BOG_PRODUCTION_CALLBACK_PUBLIC_KEY,
  BOG_PRODUCTION_CONFIGURATION,
  BOG_PRODUCTION_TOKEN_URL,
  BOG_PRODUCTION_API_URL,
  BOG_SANDBOX_CALLBACK_PUBLIC_KEY,
  BOG_SANDBOX_API_URL,
  BOG_SANDBOX_TOKEN_URL,
  canApplyBogPaymentStatus,
  createBogIdempotencyKey,
  createBogOrder,
  getBogOrderDetails,
  isBogPaymentUrl,
  mapBogPaymentStatus,
  toPersistedBogPaymentStatus,
  verifyBogCallbackSignature,
  verifyBogOrderDetails,
} from './_shared/bog-payment'

const migration011 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/011_premium_packages_and_access_safety.sql'),
  'utf8',
)
const migration012 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/012_bog_verified_payment_activation.sql'),
  'utf8',
)
const sandboxIsolationPatch = readFileSync(
  resolve(process.cwd(), 'supabase/patches/bog_sandbox_payment_isolation.sql'),
  'utf8',
)
const productionInitializer = readFileSync(
  resolve(process.cwd(), 'supabase/functions/payment-initialize-production/index.ts'),
  'utf8',
)
const productionVerifier = readFileSync(
  resolve(process.cwd(), 'supabase/functions/payment-verify-production/index.ts'),
  'utf8',
)
const productionCallback = readFileSync(
  resolve(process.cwd(), 'supabase/functions/payment-webhook-bog-production/index.ts'),
  'utf8',
)

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto)
})

it('keeps SQL bank-status mapping aligned with the Edge Function allowlist', () => {
  const bankStatuses: Record<string, string> = {
    completed: 'success',
    rejected: 'failed',
    refunded: 'refunded',
    refunded_partially: 'refunded_partially',
    created: 'pending',
    cancelled: 'cancelled',
    canceled: 'cancelled',
    processing: 'processing',
    auth_requested: 'processing',
    blocked: 'processing',
    partial_completed: 'processing',
    refund_requested: 'processing',
  }

  for (const [bankStatus, expected] of Object.entries(bankStatuses)) {
    expect(mapBogPaymentStatus(bankStatus)).toBe(expected)
    expect(sandboxIsolationPatch).toMatch(new RegExp(`when '${bankStatus}' then '${expected}'`))
  }
  expect(sandboxIsolationPatch).toMatch(/else null\s+end;\s+if v_expected_status is null then/i)
  expect(mapBogPaymentStatus('unexpected_bank_status')).toBe('unknown')
})

describe('BOG sandbox payment helpers', () => {
  it('uses the documented Live API endpoints and keeps the checkout host isolated', () => {
    expect(BOG_PRODUCTION_TOKEN_URL).toBe(
      'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token',
    )
    expect(BOG_PRODUCTION_API_URL).toBe('https://api.bog.ge')
    expect(BOG_PRODUCTION_CONFIGURATION.checkoutHost).toBe('payment.bog.ge')
    expect(isBogPaymentUrl('https://payment.bog.ge/?order_id=order-1', BOG_PRODUCTION_CONFIGURATION)).toBe(true)
    expect(isBogPaymentUrl('https://payment-sandbox.bog.ge/?order_id=order-1', BOG_PRODUCTION_CONFIGURATION)).toBe(false)
    expect(BOG_PRODUCTION_CALLBACK_PUBLIC_KEY).toContain(
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4RUyAw3+CdkS3ZNILQh',
    )
  })

  it('routes Live payments through the existing Production ledger and verified Premium RPC', () => {
    expect(productionInitializer).toMatch(/create_bog_payment_transaction/)
    expect(productionInitializer).not.toMatch(/bog_sandbox_payment_transactions/)
    expect(productionVerifier).toMatch(/from\('payment_transactions'\)/)
    expect(productionVerifier).toMatch(/rpc\('update_payment_status'/)
    expect(productionVerifier).toMatch(/p_provider:\s*'bog'/)
    expect(productionCallback).toMatch(/from\('payment_transactions'\)/)
    expect(productionCallback).toMatch(/rpc\('update_payment_status'/)
    expect(productionCallback).toMatch(/BOG_PRODUCTION_CALLBACK_PUBLIC_KEY/)
    expect(productionCallback).toMatch(/verifyBogCallbackSignature\(\s*rawBody,\s*req\.headers\.get\('Callback-Signature'\),\s*BOG_PRODUCTION_CALLBACK_PUBLIC_KEY/s)
    expect(productionCallback).not.toMatch(/bog_sandbox_payment_transactions/)
  })

  it('preserves known legacy plan labels and fails on unknown labels instead of rewriting them', () => {
    expect(migration011).not.toMatch(
      /update\s+public\.profiles\s+set\s+subscription_plan\s*=\s*'premium'\s+where\s+subscription_plan\s+is\s+not\s+null/i,
    )
    expect(migration011).toMatch(/subscription_plan\s+in\s*\('premium',\s*'nav',\s*'panel',\s*'full'\)/i)
    expect(migration011).toMatch(/Unknown subscription_plan values exist/i)
    expect(migration011).toMatch(/cardinality\(constraint_columns\)\s*<>\s*1/i)
  })

  it('extends a still-valid active term only after verified success', () => {
    expect(migration012).toMatch(/if p_status = 'success'\s+then\s+update public\.profiles/i)
    expect(migration012).toMatch(
      /when subscription_status = 'active'\s+and subscription_expires_at > now\(\)\s+then subscription_expires_at \+ interval '30 days'/i,
    )
    expect(migration012).toMatch(/else now\(\) \+ interval '30 days'/i)
    expect(migration012).not.toMatch(/p_status = 'refunded_partially'\s+and v_current_status/i)
  })

  it('guards unique indexes and status constraints against unknown existing data', () => {
    expect(migration012).toMatch(/Duplicate BOG user\/idempotency keys exist/i)
    expect(migration012).toMatch(/Duplicate BOG merchant payment IDs exist/i)
    expect(migration012).toMatch(/Additional payment status CHECK constraints exist/i)
    expect(migration012).toMatch(/Unknown payment status values exist/i)
  })

  it('fails safely when migration constraint or index names already have an unexpected definition', () => {
    expect(migration012).toMatch(/Constraint payment_transactions_status_check is not a single-column status CHECK/i)
    expect(migration012).toMatch(/A BOG payment index name already exists/i)
    expect(migration012).not.toMatch(/create unique index if not exists payment_transactions_/i)
  })

  it('does not let refund status modify profile entitlements', () => {
    expect(migration012).toMatch(/if p_status = 'success'\s+then\s+update public\.profiles/i)
    expect(migration012).not.toMatch(/elsif p_status = 'refunded'\s+then\s+update public\.profiles/i)
    expect(migration012).not.toMatch(/p_status = 'refunded_partially'\s+and v_current_status <> 'success'/i)
  })

  it('keeps Sandbox payment records and RPCs isolated from production entitlements', () => {
    expect(sandboxIsolationPatch).toMatch(/create table if not exists public\.bog_sandbox_payment_transactions/i)
    expect(sandboxIsolationPatch).toMatch(/create or replace function public\.create_bog_sandbox_payment_transaction/i)
    expect(sandboxIsolationPatch).toMatch(/create or replace function public\.update_bog_sandbox_payment_status/i)
    expect(sandboxIsolationPatch).toMatch(/revoke all on public\.bog_sandbox_payment_transactions from anon, authenticated/i)
    expect(sandboxIsolationPatch).not.toMatch(/update\s+public\.profiles/i)
    expect(sandboxIsolationPatch).toMatch(/subscription_activated', false/i)
  })

  it('limits Sandbox transaction creation to the service role and hardens definer search paths', () => {
    expect(sandboxIsolationPatch).toMatch(
      /create or replace function public\.create_bog_sandbox_payment_transaction\(\s*p_user_id uuid,/i,
    )
    expect(sandboxIsolationPatch).toMatch(
      /if auth\.role\(\) is distinct from 'service_role' then\s+raise exception 'Only the service role can create Sandbox payment transactions'/i,
    )
    expect(sandboxIsolationPatch).toMatch(
      /drop function if exists public\.create_bog_sandbox_payment_transaction\(text, text, uuid, numeric, text, jsonb\);/i,
    )
    expect(sandboxIsolationPatch).toMatch(
      /revoke execute on function public\.create_bog_sandbox_payment_transaction\(uuid, text, text, uuid, numeric, text, jsonb\)\s+from public, anon, authenticated/i,
    )
    expect(sandboxIsolationPatch).toMatch(
      /grant execute on function public\.create_bog_sandbox_payment_transaction\(uuid, text, text, uuid, numeric, text, jsonb\)\s+to service_role/i,
    )
    expect(sandboxIsolationPatch).toMatch(
      /revoke execute on function public\.set_bog_sandbox_payment_updated_at\(\)\s+from public, anon, authenticated/i,
    )
    expect(sandboxIsolationPatch).toMatch(
      /grant execute on function public\.set_bog_sandbox_payment_updated_at\(\)\s+to service_role/i,
    )
    expect(sandboxIsolationPatch).toMatch(
      /revoke execute on function public\.update_bog_sandbox_payment_status\(text, text, text, jsonb\)\s+from public, anon, authenticated/i,
    )
    expect(sandboxIsolationPatch).toMatch(
      /grant execute on function public\.update_bog_sandbox_payment_status\(text, text, text, jsonb\)\s+to service_role/i,
    )
    expect(sandboxIsolationPatch).not.toMatch(/set search_path = public/i)
    expect(sandboxIsolationPatch.match(/set search_path = pg_catalog/gi)).toHaveLength(3)
  })

  it('rejects unknown bank statuses and duplicate Sandbox identifiers safely', () => {
    expect(sandboxIsolationPatch).toMatch(/payment_id text not null unique/i)
    expect(sandboxIsolationPatch).toMatch(/merchant_payment_id text not null unique/i)
    expect(sandboxIsolationPatch).toMatch(/unique \(user_id, idempotency_key\)/i)
    expect(sandboxIsolationPatch).toMatch(/if p_amount is null then\s+raise exception 'Payment amount is required'/i)
    expect(sandboxIsolationPatch).toMatch(/on conflict do nothing\s+returning id into transaction_id/i)
    expect(sandboxIsolationPatch).toMatch(/if not found then\s+raise exception 'Sandbox payment ID, merchant ID, or idempotency key already exists'/i)
    expect(sandboxIsolationPatch).toMatch(/existing\.payment_id is distinct from p_payment_id/i)
    expect(sandboxIsolationPatch).toMatch(/existing\.merchant_payment_id is distinct from p_merchant_payment_id/i)
    expect(sandboxIsolationPatch).toMatch(/existing\.metadata->>'device_slots' is distinct from p_metadata->>'device_slots'/i)
    expect(sandboxIsolationPatch).toMatch(/else null\s+end;\s+if v_expected_status is null then\s+raise exception 'Unsupported BOG Sandbox bank status'/i)

    const unknownOrder = {
      order_id: 'order-123',
      external_order_id: 'cr-test-id',
      order_status: { key: 'bank_added_new_status' },
      purchase_units: { request_amount: '99', currency_code: 'GEL' },
    }
    expect(() => verifyBogOrderDetails(unknownOrder, {
      orderId: 'order-123',
      externalOrderId: 'cr-test-id',
      amount: 99,
      currency: 'GEL',
    })).toThrow('unsupported order status')
    expect(() => toPersistedBogPaymentStatus('unknown')).toThrow('unsupported BOG payment status')
  })

  it('matches the complete SQL and Edge Function Sandbox transition matrix', () => {
    const statuses = [
      'pending',
      'processing',
      'success',
      'failed',
      'cancelled',
      'refunded',
      'refunded_partially',
    ] as const
    const allowed: Record<string, readonly string[]> = {
      pending: ['processing', 'success', 'failed', 'cancelled', 'refunded', 'refunded_partially'],
      processing: ['success', 'failed', 'cancelled', 'refunded', 'refunded_partially'],
      success: ['refunded', 'refunded_partially'],
      failed: [],
      cancelled: [],
      refunded: [],
      refunded_partially: ['refunded'],
    }

    for (const current of statuses) {
      for (const next of statuses) {
        if (current === next) {
          expect(canApplyBogPaymentStatus(current, next)).toBe(current === 'refunded_partially')
        } else if (allowed[current].includes(next)) {
          expect(canApplyBogPaymentStatus(current, next)).toBe(true)
        } else {
          expect(() => canApplyBogPaymentStatus(current, next)).toThrow('Invalid BOG payment status transition')
        }
      }
    }

    expect(sandboxIsolationPatch).toMatch(/v_current_status = 'pending' and p_status in \(\s*'processing', 'success', 'failed', 'cancelled', 'refunded', 'refunded_partially'/i)
    expect(sandboxIsolationPatch).toMatch(/v_current_status = 'processing' and p_status in \(\s*'success', 'failed', 'cancelled', 'refunded', 'refunded_partially'/i)
    expect(sandboxIsolationPatch).toMatch(/v_current_status = 'success' and p_status in \('refunded', 'refunded_partially'\)/i)
    expect(sandboxIsolationPatch).toMatch(/v_current_status = 'refunded_partially' and p_status = 'refunded'/i)
    expect(sandboxIsolationPatch).toMatch(
      /v_current_status = 'refunded_partially' and p_status = 'refunded_partially' then[\s\S]*?v_refund_amount < v_previous_refund_amount[\s\S]*?metadata = coalesce\(metadata, '\{\}'::jsonb\) \|\| coalesce\(p_metadata, '\{\}'::jsonb\)/i,
    )
  })

  it('routes BOG Sandbox functions only through the isolated payment table and RPC', () => {
    const initialize = readFileSync(
      resolve(process.cwd(), 'supabase/functions/payment-initialize/index.ts'),
      'utf8',
    )
    const verify = readFileSync(
      resolve(process.cwd(), 'supabase/functions/payment-verify/index.ts'),
      'utf8',
    )
    const callback = readFileSync(
      resolve(process.cwd(), 'supabase/functions/payment-webhook-bog/index.ts'),
      'utf8',
    )
    expect(initialize).toMatch(/create_bog_sandbox_payment_transaction/)
    expect(initialize).toMatch(/adminClient\.rpc\('create_bog_sandbox_payment_transaction'/)
    expect(initialize).toMatch(/p_user_id:\s*user\.id/)
    expect(initialize).toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
    expect(initialize).toMatch(/req\.headers\.get\('Origin'\)\s*!==\s*appUrl\.origin/)
    expect(initialize).toMatch(/!appUrl\.hostname\.endsWith\('\.vercel\.app'\)/)
    expect(verify).toMatch(/bog_sandbox_payment_transactions/)
    expect(verify).toMatch(/update_bog_sandbox_payment_status/)
    expect(callback).toMatch(/bog_sandbox_payment_transactions/)
    expect(callback).toMatch(/update_bog_sandbox_payment_status/)
    expect(verify).not.toMatch(/from\('payment_transactions'\)/)
    expect(callback).not.toMatch(/from\('payment_transactions'\)/)
  })

  it('creates a sandbox order using official payload and redirects only to BOG sandbox', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'sandbox-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'order-123',
        _links: { redirect: { href: 'https://payment-sandbox.bog.ge/?order_id=order-123' } },
      }), { status: 201 }))

    const order = await createBogOrder({
      credentials: { clientKey: 'client-id', secretKey: 'secret-key' },
      idempotencyKey: 'd0a3f04b-42f6-4ab1-999b-0cf8d90b1947',
      merchantPaymentId: 'cr-test-id',
      deviceSlots: 2,
      amount: 179,
      callbackUrl: 'https://preview-project.supabase.co/functions/v1/payment-webhook-bog',
      successUrl: 'https://cityroute-preview.vercel.app/payment/return?provider=bog&merchantPaymentId=cr-test-id',
      failUrl: 'https://cityroute-preview.vercel.app/payment/return?provider=bog&merchantPaymentId=cr-test-id',
    }, fetcher)

    expect(order.paymentId).toBe('order-123')
    expect(order.paymentUrl).toBe('https://payment-sandbox.bog.ge/?order_id=order-123')
    expect(fetcher.mock.calls[0][0]).toBe(BOG_SANDBOX_TOKEN_URL)
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({
      Authorization: `Basic ${btoa('client-id:secret-key')}`,
    })
    expect(fetcher.mock.calls[1][0]).toBe(`${BOG_SANDBOX_API_URL}/payments/v1/ecommerce/orders`)
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      'Idempotency-Key': 'd0a3f04b-42f6-4ab1-999b-0cf8d90b1947',
      'Accept-Language': 'ka',
    })
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      external_order_id: 'cr-test-id',
      purchase_units: { currency: 'GEL', total_amount: 179 },
      redirect_urls: {
        success: 'https://cityroute-preview.vercel.app/payment/return?provider=bog&merchantPaymentId=cr-test-id',
      },
    })
  })

  it('creates Production orders only through the documented Live endpoints and checkout host', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'live-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'live-order-123',
        _links: { redirect: { href: 'https://payment.bog.ge/?order_id=live-order-123' } },
      }), { status: 201 }))

    const order = await createBogOrder({
      credentials: { clientKey: 'live-client-id', secretKey: 'live-secret-key' },
      idempotencyKey: 'd0a3f04b-42f6-4ab1-999b-0cf8d90b1947',
      merchantPaymentId: 'cr-live-id',
      deviceSlots: 1,
      amount: 99,
      callbackUrl: 'https://project.supabase.co/functions/v1/payment-webhook-bog-production',
      successUrl: 'https://cityroute.ge/payment/return?provider=bog-production',
      failUrl: 'https://cityroute.ge/payment/return?provider=bog-production&checkout=not-completed',
    }, fetcher, BOG_PRODUCTION_CONFIGURATION)

    expect(order.paymentId).toBe('live-order-123')
    expect(order.paymentUrl).toBe('https://payment.bog.ge/?order_id=live-order-123')
    expect(fetcher.mock.calls[0][0]).toBe(BOG_PRODUCTION_TOKEN_URL)
    expect(fetcher.mock.calls[1][0]).toBe(`${BOG_PRODUCTION_API_URL}/payments/v1/ecommerce/orders`)
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({
      external_order_id: 'cr-live-id',
      purchase_units: { currency: 'GEL', total_amount: 99 },
      redirect_urls: {
        success: 'https://cityroute.ge/payment/return?provider=bog-production',
      },
    })
  })

  it('fetches payment status from the official Sandbox receipt endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'sandbox-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ order_id: 'order/123' }), { status: 200 }))

    await getBogOrderDetails({
      clientKey: 'client-id',
      secretKey: 'secret-key',
    }, 'order/123', fetcher)

    expect(fetcher.mock.calls[1][0]).toBe(`${BOG_SANDBOX_API_URL}/payments/v1/receipt/order%2F123`)
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({
      Authorization: 'Bearer sandbox-token',
    })
  })

  it('does not accept a checkout URL outside the official sandbox host', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'sandbox-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'order-123',
        _links: { redirect: { href: 'https://attacker.example/pay' } },
      }), { status: 201 }))

    await expect(createBogOrder({
      credentials: { clientKey: 'client-id', secretKey: 'secret-key' },
      idempotencyKey: 'd0a3f04b-42f6-4ab1-999b-0cf8d90b1947',
      merchantPaymentId: 'cr-test-id',
      deviceSlots: 1,
      amount: 99,
      callbackUrl: 'https://preview-project.supabase.co/functions/v1/payment-webhook-bog',
      successUrl: 'https://cityroute-preview.vercel.app/payment/return',
      failUrl: 'https://cityroute-preview.vercel.app/payment/return',
    }, fetcher)).rejects.toThrow('invalid order or checkout URL')
  })

  it('maps successful, rejected, pending, cancelled, and refund statuses explicitly', () => {
    expect(mapBogPaymentStatus('completed')).toBe('success')
    expect(mapBogPaymentStatus('rejected')).toBe('failed')
    expect(mapBogPaymentStatus('created')).toBe('pending')
    expect(mapBogPaymentStatus('cancelled')).toBe('cancelled')
    expect(mapBogPaymentStatus('canceled')).toBe('cancelled')
    expect(mapBogPaymentStatus('refunded')).toBe('refunded')
    expect(mapBogPaymentStatus('refunded_partially')).toBe('refunded_partially')
    expect(mapBogPaymentStatus('unknown-status')).toBe('unknown')
    expect(() => toPersistedBogPaymentStatus('unknown')).toThrow('unsupported BOG payment status')
  })

  it('uses the documented Sandbox callback key rather than the Production callback key', () => {
    expect(BOG_SANDBOX_CALLBACK_PUBLIC_KEY).toContain(
      'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqczfAuhtxw2iF68kS0Hy',
    )
  })

  it('derives stable user-scoped idempotency keys for payment retries', async () => {
    const requestId = 'd0a3f04b-42f6-4ab1-999b-0cf8d90b1947'
    const first = await createBogIdempotencyKey('user-1', requestId)

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(await createBogIdempotencyKey('user-1', requestId)).toBe(first)
    expect(await createBogIdempotencyKey('user-2', requestId)).not.toBe(first)
    expect(await createBogIdempotencyKey('user-1', 'other-request')).not.toBe(first)
  })

  it('treats exact duplicate callbacks as no-op and rejects invalid transitions', () => {
    expect(canApplyBogPaymentStatus('pending', 'pending')).toBe(false)
    expect(() => canApplyBogPaymentStatus('success', 'processing')).toThrow('Invalid BOG payment status transition')
    expect(canApplyBogPaymentStatus('success', 'refunded_partially')).toBe(true)
    expect(canApplyBogPaymentStatus('refunded_partially', 'refunded')).toBe(true)
    expect(() => canApplyBogPaymentStatus('refunded', 'success')).toThrow('Invalid BOG payment status transition')
    expect(() => canApplyBogPaymentStatus('failed', 'processing')).toThrow('Invalid BOG payment status transition')
    expect(() => canApplyBogPaymentStatus('cancelled', 'failed')).toThrow('Invalid BOG payment status transition')
    expect(canApplyBogPaymentStatus('pending', 'cancelled')).toBe(true)
    expect(canApplyBogPaymentStatus('pending', 'failed')).toBe(true)
    expect(() => canApplyBogPaymentStatus('failed', 'success')).toThrow('Invalid BOG payment status transition')
  })

  it('requires the bank order ID, external ID, amount, and GEL currency to match', () => {
    const order = {
      order_id: 'order-123',
      external_order_id: 'cr-test-id',
      order_status: { key: 'completed' },
      purchase_units: { request_amount: '179.00', currency_code: 'GEL' },
      payment_detail: { transaction_id: 'bank-transaction-1' },
    }

    expect(verifyBogOrderDetails(order, {
      orderId: 'order-123',
      externalOrderId: 'cr-test-id',
      amount: 179,
      currency: 'GEL',
    })).toMatchObject({ status: 'success', transactionId: 'bank-transaction-1' })
    expect(() => verifyBogOrderDetails(order, {
      orderId: 'order-123',
      externalOrderId: 'cr-other-id',
      amount: 179,
      currency: 'GEL',
    })).toThrow('external order ID')
    expect(() => verifyBogOrderDetails(order, {
      orderId: 'order-123',
      externalOrderId: 'cr-test-id',
      amount: 99,
      currency: 'GEL',
    })).toThrow('amount')
    expect(() => verifyBogOrderDetails(order, {
      orderId: 'order-123',
      externalOrderId: 'cr-test-id',
      amount: 179,
      currency: 'USD',
    })).toThrow('currency')
  })

  it('validates full and partial refund totals against the original bank order', () => {
    const expected = {
      orderId: 'order-123',
      externalOrderId: 'cr-test-id',
      amount: 179,
      currency: 'GEL',
    }
    const refundedOrder = {
      order_id: 'order-123',
      external_order_id: 'cr-test-id',
      order_status: { key: 'refunded' },
      purchase_units: {
        request_amount: '179.00',
        refund_amount: '179.00',
        currency_code: 'GEL',
      },
    }
    const partiallyRefundedOrder = {
      ...refundedOrder,
      order_status: { key: 'refunded_partially' },
      purchase_units: { ...refundedOrder.purchase_units, refund_amount: '25.00' },
    }

    expect(verifyBogOrderDetails(refundedOrder, expected)).toMatchObject({
      status: 'refunded',
      refundAmount: '179.00',
    })
    expect(verifyBogOrderDetails(partiallyRefundedOrder, expected)).toMatchObject({
      status: 'refunded_partially',
      refundAmount: '25.00',
    })
    expect(() => verifyBogOrderDetails({
      ...partiallyRefundedOrder,
      purchase_units: { ...partiallyRefundedOrder.purchase_units, refund_amount: '179.00' },
    }, expected)).toThrow('partial refund amount')
    expect(() => verifyBogOrderDetails({
      ...refundedOrder,
      purchase_units: { ...refundedOrder.purchase_units, refund_amount: '178.00' },
    }, expected)).toThrow('full refund amount')
  })

  it('verifies the BOG callback signature against the exact raw body before parsing', async () => {
    const keyPair = await webcrypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )
    const rawBody = '{"event":"order_payment","body":{"order_id":"order-123"}}'
    const signature = await webcrypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      keyPair.privateKey,
      new TextEncoder().encode(rawBody),
    )
    const publicKey = await webcrypto.subtle.exportKey('spki', keyPair.publicKey)
    const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(publicKey)))}\n-----END PUBLIC KEY-----`
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))

    expect(await verifyBogCallbackSignature(rawBody, signatureBase64, publicKeyPem)).toBe(true)
    expect(await verifyBogCallbackSignature(`${rawBody} `, signatureBase64, publicKeyPem)).toBe(false)
    expect(await verifyBogCallbackSignature(rawBody, null, publicKeyPem)).toBe(false)
  })
})
