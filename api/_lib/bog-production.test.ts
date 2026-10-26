import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  buildBogPaymentStatusRpcCall,
  handleBogProductionCallback,
  handleBogProductionInitialize,
  handleBogProductionVerify,
  type BogProductionDependencies,
} from './bog-production'
import type { BogOrderDetails } from '../../supabase/functions/_shared/bog-payment'

type TestTransaction = {
  payment_id: string
  merchant_payment_id: string | null
  user_id: string
  amount: number | string
  currency: string
  status: string
}

const env = {
  VERCEL_ENV: 'production',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'public-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-service-role-key',
  BOG_CLIENT_KEY: 'server-only-client-key',
  BOG_SECRET_KEY: 'server-only-secret-key',
  PRODUCTION_APP_URL: 'https://cityroute.ge',
}
const productionSql = readFileSync(
  resolve(process.cwd(), 'supabase/patches/bog_production_payment_api.sql'),
  'utf8',
)

const h = vi.hoisted(() => ({
  authenticateUser: vi.fn(async () => ({ id: 'user-1' })),
  createOrder: vi.fn(async () => ({ paymentId: 'bank-order-1', paymentUrl: 'https://payment.bog.ge/checkout/1' })),
  insertTransaction: vi.fn(async () => {}),
  getTransactionById: vi.fn(async (): Promise<TestTransaction | null> => ({
    payment_id: 'bank-order-1',
    merchant_payment_id: 'cr-merchant-order-1',
    user_id: 'user-1',
    amount: 99,
    currency: 'GEL',
    status: 'pending',
  })),
  getTransactionByMerchantId: vi.fn(async (): Promise<TestTransaction | null> => ({
    payment_id: 'bank-order-1',
    merchant_payment_id: 'cr-merchant-order-1',
    user_id: 'user-1',
    amount: 99,
    currency: 'GEL',
    status: 'pending',
  })),
  getOrderDetails: vi.fn(async (): Promise<BogOrderDetails> => ({
    order_id: 'bank-order-1',
    external_order_id: 'cr-merchant-order-1',
    order_status: { key: 'completed' },
    purchase_units: { request_amount: '99.00', currency_code: 'GEL', refund_amount: '0' },
    payment_detail: { transaction_id: 'bank-transaction-1' },
  })),
  updatePaymentStatus: vi.fn(async () => {}),
  verifyCallbackSignature: vi.fn(async () => true),
}))

function dependencies(overrides: Partial<BogProductionDependencies> = {}): BogProductionDependencies {
  return {
    environment: env,
    authenticateUser: h.authenticateUser,
    createOrder: h.createOrder,
    insertTransaction: h.insertTransaction,
    getTransactionById: h.getTransactionById,
    getTransactionByMerchantId: h.getTransactionByMerchantId,
    getOrderDetails: h.getOrderDetails,
    updatePaymentStatus: h.updatePaymentStatus,
    verifyCallbackSignature: h.verifyCallbackSignature,
    ...overrides,
  }
}

function request(
  path: string,
  method = 'POST',
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  const requestHeaders: Record<string, string> = {
    Origin: 'https://cityroute.ge',
    Authorization: 'Bearer verified-user-token',
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...headers,
  }
  const webRequest = new Request(`https://cityroute.ge${path}`, {
    method,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  Object.defineProperty(webRequest, 'headers', {
    value: { get: (name: string) => requestHeaders[Object.keys(requestHeaders)
      .find((key) => key.toLowerCase() === name.toLowerCase()) ?? ''] ?? null },
  })
  return webRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  h.authenticateUser.mockResolvedValue({ id: 'user-1' })
  h.createOrder.mockResolvedValue({
    paymentId: 'bank-order-1',
    paymentUrl: 'https://payment.bog.ge/checkout/1',
  })
  h.getTransactionById.mockResolvedValue({
    payment_id: 'bank-order-1',
    merchant_payment_id: 'cr-merchant-order-1',
    user_id: 'user-1',
    amount: 99,
    currency: 'GEL',
    status: 'pending',
  })
  h.getTransactionByMerchantId.mockResolvedValue({
    payment_id: 'bank-order-1',
    merchant_payment_id: 'cr-merchant-order-1',
    user_id: 'user-1',
    amount: 99,
    currency: 'GEL',
    status: 'pending',
  })
  h.getOrderDetails.mockResolvedValue({
    order_id: 'bank-order-1',
    external_order_id: 'cr-merchant-order-1',
    order_status: { key: 'completed' },
    purchase_units: { request_amount: '99.00', currency_code: 'GEL', refund_amount: '0' },
    payment_detail: { transaction_id: 'bank-transaction-1' },
  })
  h.verifyCallbackSignature.mockResolvedValue(true)
})

describe('BOG Production Vercel API', () => {
  it('calls the dedicated BOG status RPC with the SQL function arguments', () => {
    expect(buildBogPaymentStatusRpcCall({
      paymentId: 'bank-order-1',
      status: 'success',
      transactionId: 'bank-transaction-1',
      metadata: {
        bank_status: 'completed',
        bank_amount: '99',
        bank_refund_amount: null,
        bank_currency: 'GEL',
        bank_external_order_id: 'cr-merchant-order-1',
      },
    })).toEqual({
      functionName: 'update_bog_payment_status',
      args: {
        p_payment_id: 'bank-order-1',
        p_status: 'success',
        p_transaction_id: 'bank-transaction-1',
        p_metadata: {
          bank_status: 'completed',
          bank_amount: '99',
          bank_refund_amount: null,
          bank_currency: 'GEL',
          bank_external_order_id: 'cr-merchant-order-1',
        },
      },
    })
  })

  it('keeps the reviewed SQL RPC signature, grants, TBC function, and BOG indexes aligned', () => {
    expect(productionSql).toMatch(
      /create(?: or replace)? function public\.update_bog_payment_status\(\s*p_payment_id text,\s*p_status text,\s*p_transaction_id text default null,\s*p_metadata jsonb default '\{\}'::jsonb\s*\)/i,
    )
    expect(productionSql).toMatch(
      /revoke execute on function public\.update_bog_payment_status\(text, text, text, jsonb\)\s+from public, anon, authenticated/i,
    )
    expect(productionSql).toMatch(
      /grant execute on function public\.update_bog_payment_status\(text, text, text, jsonb\)\s+to service_role/i,
    )
    expect(productionSql).not.toMatch(/create(?: or replace)? function public\.update_payment_status\s*\(/i)
    expect(productionSql).toMatch(/provider text not null check \(provider in \('tbc', 'bog'\)\)/i)
    expect(productionSql).toMatch(/payment_transactions_user_bog_idempotency_key/i)
    expect(productionSql).toMatch(/payment_transactions_bog_merchant_payment_id/i)
  })

  it('rejects unknown statuses, prevents stale transitions, and records cumulative refunds without reactivating Premium', () => {
    expect(productionSql).toMatch(/else null\s+end;\s+if v_expected_status is null then\s+raise exception 'Unsupported BOG bank status'/i)
    expect(productionSql).toMatch(/Cumulative partial refund amount cannot decrease/i)
    expect(productionSql).toMatch(/v_refund_amount = v_previous_refund_amount/i)
    expect(productionSql).toMatch(/if p_status = 'success' then\s+update public\.profiles/i)
    expect(productionSql).not.toMatch(/if p_status in \('success', 'refunded_partially'\)\s+then\s+update public\.profiles/i)
    expect(productionSql).toMatch(
      /v_current_status = 'success'\s+and p_status in \('refunded', 'refunded_partially'\)/i,
    )
    expect(productionSql).toMatch(
      /v_current_status = 'refunded_partially'\s+and p_status = 'refunded'/i,
    )
  })

  it('fails closed on Preview before authenticating or contacting BOG', async () => {
    const deps = dependencies({ environment: { ...env, VERCEL_ENV: 'preview' } })
    const response = await handleBogProductionInitialize(
      request('/api/payments/bog/initialize', 'POST', { provider: 'bog', deviceSlots: 1 }),
      deps,
    )

    expect(response.status).toBe(404)
    expect(h.authenticateUser).not.toHaveBeenCalled()
    expect(h.createOrder).not.toHaveBeenCalled()
  })

  it('requires the exact Production origin and authenticated user for initialization', async () => {
    const wrongOriginRequest = request(
      '/api/payments/bog/initialize',
      'POST',
      { provider: 'bog', deviceSlots: 1 },
      { Origin: 'https://preview.example.vercel.app' },
    )
    const wrongOrigin = await handleBogProductionInitialize(
      wrongOriginRequest,
      dependencies(),
    )
    expect(wrongOrigin.status).toBe(403)
    expect(h.createOrder).not.toHaveBeenCalled()

    const unauthenticated = await handleBogProductionInitialize(
      request('/api/payments/bog/initialize', 'POST', { provider: 'bog', deviceSlots: 1 }, {
        Authorization: '',
      }),
      dependencies(),
    )
    expect(unauthenticated.status, await unauthenticated.clone().text()).toBe(401)
    expect(h.createOrder).not.toHaveBeenCalled()
  })

  it('derives the price server-side and writes a pending transaction after order creation', async () => {
    const response = await handleBogProductionInitialize(
      request('/api/payments/bog/initialize', 'POST', {
        provider: 'bog',
        deviceSlots: 2,
        requestId: '4a456c9c-9581-4d3b-81f8-dca45ce19b3c',
        amount: 0,
        currency: 'USD',
      }),
      dependencies(),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.amount).toBe(179)
    expect(body.paymentUrl).toBe('https://payment.bog.ge/checkout/1')
    expect(h.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      amount: 179,
      deviceSlots: 2,
      credentials: {
        clientKey: env.BOG_CLIENT_KEY,
        secretKey: env.BOG_SECRET_KEY,
      },
      callbackUrl: 'https://cityroute.ge/api/payments/bog/callback',
    }))
    expect(h.insertTransaction).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      payment_id: 'bank-order-1',
      amount: 179,
      currency: 'GEL',
      status: 'pending',
    }))
  })

  it('does not persist or return checkout for invalid packages or missing idempotency IDs', async () => {
    const response = await handleBogProductionInitialize(
      request('/api/payments/bog/initialize', 'POST', {
        provider: 'bog',
        deviceSlots: 3,
        requestId: 'not-a-uuid',
      }),
      dependencies(),
    )

    expect(response.status).toBe(400)
    expect(h.createOrder).not.toHaveBeenCalled()
    expect(h.insertTransaction).not.toHaveBeenCalled()
  })

  it('requires the authenticated owner and verifies the authoritative amount and currency', async () => {
    h.getTransactionByMerchantId.mockResolvedValueOnce(null)
    const notOwner = await handleBogProductionVerify(
      request('/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-order-1', 'GET'),
      dependencies(),
    )
    expect(notOwner.status).toBe(404)
    expect(h.getOrderDetails).not.toHaveBeenCalled()

    h.getOrderDetails.mockResolvedValueOnce({
      order_id: 'bank-order-1',
      external_order_id: 'cr-merchant-order-1',
      order_status: { key: 'completed' },
      purchase_units: { request_amount: '100', currency_code: 'GEL' },
    })
    const mismatch = await handleBogProductionVerify(
      request('/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-order-1', 'GET'),
      dependencies(),
    )
    expect(mismatch.status).toBe(500)
    expect(h.updatePaymentStatus).not.toHaveBeenCalled()
  })

  it('uses only the existing service-role status RPC after a verified successful receipt', async () => {
    h.getTransactionById.mockResolvedValueOnce({
      payment_id: 'bank-order-1',
      merchant_payment_id: 'cr-merchant-order-1',
      user_id: 'user-1',
      amount: 99,
      currency: 'GEL',
      status: 'success',
    })
    const response = await handleBogProductionVerify(
      request('/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-order-1', 'GET'),
      dependencies(),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('success')
    expect(body.sandbox).toBe(false)
    expect(h.updatePaymentStatus).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'bank-order-1',
      status: 'success',
      transactionId: 'bank-transaction-1',
      metadata: expect.objectContaining({
        bank_amount: '99.00',
        bank_currency: 'GEL',
        bank_external_order_id: 'cr-merchant-order-1',
      }),
    }))
  })

  it('does not move a terminal payment back to pending', async () => {
    h.getTransactionByMerchantId.mockResolvedValueOnce({
      payment_id: 'bank-order-1',
      merchant_payment_id: 'cr-merchant-order-1',
      user_id: 'user-1',
      amount: 99,
      currency: 'GEL',
      status: 'failed',
    })
    h.getOrderDetails.mockResolvedValueOnce({
      order_id: 'bank-order-1',
      external_order_id: 'cr-merchant-order-1',
      order_status: { key: 'created' },
      purchase_units: { request_amount: '99', currency_code: 'GEL' },
    })
    const response = await handleBogProductionVerify(
      request('/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-order-1', 'GET'),
      dependencies(),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('failed')
    expect(h.updatePaymentStatus).not.toHaveBeenCalled()
  })

  it('returns the database status after a concurrent callback update', async () => {
    h.getTransactionByMerchantId.mockResolvedValueOnce({
      payment_id: 'bank-order-1',
      merchant_payment_id: 'cr-merchant-order-1',
      user_id: 'user-1',
      amount: 99,
      currency: 'GEL',
      status: 'pending',
    })
    h.getTransactionById.mockResolvedValueOnce({
      payment_id: 'bank-order-1',
      merchant_payment_id: 'cr-merchant-order-1',
      user_id: 'user-1',
      amount: 99,
      currency: 'GEL',
      status: 'refunded',
    })

    const response = await handleBogProductionVerify(
      request('/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-order-1', 'GET'),
      dependencies(),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('refunded')
    expect(h.updatePaymentStatus).toHaveBeenCalledOnce()
  })

  it('rejects an unsigned callback before looking up or changing any transaction', async () => {
    h.verifyCallbackSignature.mockResolvedValueOnce(false)
    const response = await handleBogProductionCallback(
      request('/api/payments/bog/callback', 'POST', {
        event: 'order_payment',
        body: { order_id: 'bank-order-1' },
      }, { 'Callback-Signature': 'invalid' }),
      dependencies(),
    )

    expect(response.status).toBe(401)
    expect(h.getTransactionById).not.toHaveBeenCalled()
    expect(h.updatePaymentStatus).not.toHaveBeenCalled()
  })

  it('verifies signed callbacks against the bank receipt before updating status', async () => {
    const response = await handleBogProductionCallback(
      request('/api/payments/bog/callback', 'POST', {
        event: 'order_payment',
        body: { order_id: 'bank-order-1' },
      }, { 'Callback-Signature': 'verified-signature' }),
      dependencies(),
    )

    expect(response.status).toBe(200)
    expect(h.verifyCallbackSignature).toHaveBeenCalledOnce()
    expect(h.getOrderDetails).toHaveBeenCalledWith('bank-order-1')
    expect(h.updatePaymentStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }))
  })

  it('records verified refunds through the existing RPC without implementing entitlement changes', async () => {
    h.getOrderDetails.mockResolvedValueOnce({
      order_id: 'bank-order-1',
      external_order_id: 'cr-merchant-order-1',
      order_status: { key: 'refunded_partially' },
      purchase_units: {
        request_amount: '99',
        refund_amount: '25',
        currency_code: 'GEL',
      },
    })
    h.getTransactionById.mockResolvedValueOnce({
      payment_id: 'bank-order-1',
      merchant_payment_id: 'cr-merchant-order-1',
      user_id: 'user-1',
      amount: 99,
      currency: 'GEL',
      status: 'success',
    })
    const response = await handleBogProductionCallback(
      request('/api/payments/bog/callback', 'POST', {
        event: 'order_payment',
        body: { order_id: 'bank-order-1' },
      }, { 'Callback-Signature': 'verified-signature' }),
      dependencies(),
    )

    expect(response.status).toBe(200)
    expect(h.updatePaymentStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'refunded_partially',
      metadata: expect.objectContaining({ bank_refund_amount: '25' }),
    }))
  })

  it('does not apply a refund to an order that has not reached success', async () => {
    h.getOrderDetails.mockResolvedValueOnce({
      order_id: 'bank-order-1',
      external_order_id: 'cr-merchant-order-1',
      order_status: { key: 'refunded' },
      purchase_units: {
        request_amount: '99',
        refund_amount: '99',
        currency_code: 'GEL',
      },
    })
    const response = await handleBogProductionCallback(
      request('/api/payments/bog/callback', 'POST', {
        event: 'order_payment',
        body: { order_id: 'bank-order-1' },
      }, { 'Callback-Signature': 'verified-signature' }),
      dependencies(),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.duplicateOrStale).toBe(true)
    expect(h.updatePaymentStatus).not.toHaveBeenCalled()
  })

  it('acknowledges duplicate callbacks without repeating the entitlement RPC', async () => {
    h.getTransactionById.mockResolvedValueOnce({
      payment_id: 'bank-order-1',
      merchant_payment_id: 'cr-merchant-order-1',
      user_id: 'user-1',
      amount: 99,
      currency: 'GEL',
      status: 'success',
    })
    const response = await handleBogProductionCallback(
      request('/api/payments/bog/callback', 'POST', {
        event: 'order_payment',
        body: { order_id: 'bank-order-1' },
      }, { 'Callback-Signature': 'verified-signature' }),
      dependencies(),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.duplicateOrStale).toBe(true)
    expect(h.updatePaymentStatus).not.toHaveBeenCalled()
  })
})
