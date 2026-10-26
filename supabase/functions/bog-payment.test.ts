import { webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  BOG_SANDBOX_CALLBACK_PUBLIC_KEY,
  BOG_SANDBOX_API_URL,
  BOG_SANDBOX_TOKEN_URL,
  canApplyBogPaymentStatus,
  createBogIdempotencyKey,
  createBogOrder,
  getBogOrderDetails,
  mapBogPaymentStatus,
  toPersistedBogPaymentStatus,
  verifyBogCallbackSignature,
  verifyBogOrderDetails,
} from './_shared/bog-payment'

const sandboxIsolationPatch = readFileSync(
  resolve(process.cwd(), 'supabase/patches/bog_sandbox_payment_isolation.sql'),
  'utf8',
)

const migration011 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/011_premium_packages_and_access_safety.sql'),
  'utf8',
)
const migration012 = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/012_bog_verified_payment_activation.sql'),
  'utf8',
)

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto)
})

describe('BOG sandbox payment helpers', () => {
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

  it('does not reapply duplicate or stale callbacks and permits refund transitions', () => {
    expect(canApplyBogPaymentStatus('pending', 'pending')).toBe(false)
    expect(canApplyBogPaymentStatus('success', 'processing')).toBe(false)
    expect(canApplyBogPaymentStatus('success', 'refunded_partially')).toBe(true)
    expect(canApplyBogPaymentStatus('refunded_partially', 'refunded')).toBe(true)
    expect(canApplyBogPaymentStatus('refunded', 'success')).toBe(false)
    expect(canApplyBogPaymentStatus('failed', 'processing')).toBe(false)
    expect(canApplyBogPaymentStatus('cancelled', 'failed')).toBe(false)
    expect(canApplyBogPaymentStatus('pending', 'cancelled')).toBe(true)
    expect(canApplyBogPaymentStatus('pending', 'failed')).toBe(true)
    expect(canApplyBogPaymentStatus('failed', 'success')).toBe(false)
  })

  it('rejects unknown receipt statuses and never updates entitlements in Sandbox SQL', () => {
    const expected = {
      orderId: 'order-123',
      externalOrderId: 'cr-test-id',
      amount: 99,
      currency: 'GEL',
    }
    expect(() => verifyBogOrderDetails({
      order_id: expected.orderId,
      external_order_id: expected.externalOrderId,
      order_status: { key: 'unknown-bank-status' },
      purchase_units: { request_amount: '99', currency_code: 'GEL' },
    }, expected)).toThrow('unsupported order status')

    expect(sandboxIsolationPatch).toMatch(/create table if not exists public\.bog_sandbox_payment_transactions/i)
    expect(sandboxIsolationPatch).toMatch(/create or replace function public\.create_bog_sandbox_payment_transaction\(\s*p_user_id uuid,/i)
    expect(sandboxIsolationPatch).toMatch(/create or replace function public\.update_bog_sandbox_payment_status\(\s*p_payment_id text,/i)
    expect(sandboxIsolationPatch).not.toMatch(/update\s+public\.profiles/i)
    expect(sandboxIsolationPatch).toMatch(/subscription_activated', false/i)
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
