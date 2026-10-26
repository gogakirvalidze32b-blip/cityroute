// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canApplyBogStatus,
  verifyBogOrderDetails,
} from './bog-payment.ts'
import {
  handleBogCallback,
  handleBogInitialize,
  handleBogVerify,
} from './bog-production.ts'

const environment = {
  VERCEL_ENV: 'production',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  BOG_CLIENT_KEY: 'client-key',
  BOG_SECRET_KEY: 'secret-key',
  PRODUCTION_APP_URL: 'https://cityroute.ge',
}

const successfulOrder = {
  order_id: 'bog-order-1',
  external_order_id: 'cr-merchant-1',
  order_status: { key: 'completed' },
  purchase_units: { request_amount: '179.00', currency_code: 'GEL', refund_amount: '0' },
  payment_detail: { transaction_id: 'bank-transaction-1' },
}

function paymentTransaction(status = 'pending') {
  return {
    payment_id: 'bog-order-1',
    merchant_payment_id: 'cr-merchant-1',
    user_id: 'user-1',
    amount: 179,
    currency: 'GEL',
    status,
  }
}

function request(url: string, init: RequestInit = {}) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: 'Bearer user-token',
      origin: 'https://cityroute.ge',
      ...init.headers,
    },
  })
}

describe('BOG Production payment API', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calculates 179 GEL on the server for two devices and stores the selected slots', async () => {
    const createOrder = vi.fn(async (input: { amount: number; deviceSlots: number }) => {
      expect(input.amount).toBe(179)
      expect(input.deviceSlots).toBe(2)
      return { paymentId: 'bog-order-1', paymentUrl: 'https://payment.bog.ge/order/1' }
    })
    const insertTransaction = vi.fn(async () => {})
    const initRequest = request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots: 2,
        requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        amount: 1,
      }),
    })
    expect(initRequest.headers.get('origin')).toBe('https://cityroute.ge')
    const response = await handleBogInitialize(initRequest, {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder,
      insertTransaction,
      getTransactionById: async () => null,
      getTransactionByMerchantId: async () => null,
      getOrderDetails: async () => successfulOrder,
      updatePaymentStatus: async () => {},
      verifyCallbackSignature: async () => true,
    })

    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      paymentUrl: 'https://payment.bog.ge/order/1',
      amount: 179,
    })
    expect(insertTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amount: 179,
      currency: 'GEL',
      metadata: { provider: 'bog', device_slots: 2 },
    }))
  })

  it('does not initialize Live payments outside Vercel Production', async () => {
    const authenticateUser = vi.fn()
    const response = await handleBogInitialize(request('https://preview.cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots: 1,
        requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      }),
    }), {
      environment: { ...environment, VERCEL_ENV: 'preview' },
      authenticateUser,
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getTransactionById: vi.fn(),
      getTransactionByMerchantId: vi.fn(),
      getOrderDetails: vi.fn(),
      updatePaymentStatus: vi.fn(),
      verifyCallbackSignature: vi.fn(),
    })
    expect(response.status).toBe(404)
    expect(authenticateUser).not.toHaveBeenCalled()
  })

  it('updates Premium through the RPC only after an independently fetched receipt verifies', async () => {
    const updatePaymentStatus = vi.fn(async () => {})
    const response = await handleBogVerify(request(
      'https://cityroute.ge/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-1',
      { method: 'GET' },
    ), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getTransactionById: async () => paymentTransaction('pending'),
      getTransactionByMerchantId: async () => paymentTransaction('pending'),
      getOrderDetails: async () => successfulOrder,
      updatePaymentStatus,
      verifyCallbackSignature: async () => true,
    })
    expect(response.status).toBe(200)
    expect(updatePaymentStatus).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'bog-order-1',
      status: 'success',
      transactionId: 'bank-transaction-1',
      metadata: expect.objectContaining({
        bank_status: 'completed',
        bank_amount: '179.00',
        bank_currency: 'GEL',
        bank_external_order_id: 'cr-merchant-1',
      }),
    }))
  })

  it('rejects receipt mismatches without applying a successful payment', async () => {
    const updatePaymentStatus = vi.fn()
    const response = await handleBogVerify(request(
      'https://cityroute.ge/api/payments/bog/verify?provider=bog&paymentId=bog-order-1',
      { method: 'GET' },
    ), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getTransactionById: async () => paymentTransaction('pending'),
      getTransactionByMerchantId: vi.fn(),
      getOrderDetails: async () => ({
        ...successfulOrder,
        purchase_units: { request_amount: '99.00', currency_code: 'GEL' },
      }),
      updatePaymentStatus,
      verifyCallbackSignature: async () => true,
    })
    expect(response.status).toBe(500)
    expect(updatePaymentStatus).not.toHaveBeenCalled()
  })

  it('verifies callbacks against BOG and does not apply a duplicate success twice', async () => {
    let current = paymentTransaction('pending')
    const updatePaymentStatus = vi.fn(async ({ status }: { status: string }) => {
      current = { ...current, status }
    })
    const dependencies = {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getTransactionById: async () => current,
      getTransactionByMerchantId: vi.fn(),
      getOrderDetails: async () => successfulOrder,
      updatePaymentStatus,
      verifyCallbackSignature: async () => true,
    }
    const callbackRequest = () => request('https://cityroute.ge/api/payments/bog/callback', {
      method: 'POST',
      headers: { 'callback-signature': 'verified-signature' },
      body: JSON.stringify({ event: 'order_payment', body: { order_id: 'bog-order-1' } }),
    })

    const firstResponse = await handleBogCallback(callbackRequest(), dependencies)
    const secondResponse = await handleBogCallback(callbackRequest(), dependencies)
    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    expect(updatePaymentStatus).toHaveBeenCalledTimes(1)
  })
})

describe('BOG receipt validation and duplicate handling', () => {
  it('accepts the stored order only when IDs, amount, and currency match', () => {
    expect(() => verifyBogOrderDetails(successfulOrder, {
      paymentId: 'bog-order-1',
      merchantPaymentId: 'cr-merchant-1',
      amount: 179,
      currency: 'GEL',
    })).not.toThrow()
    expect(() => verifyBogOrderDetails(successfulOrder, {
      paymentId: 'bog-order-1',
      merchantPaymentId: 'cr-merchant-1',
      amount: 99,
      currency: 'GEL',
    })).toThrow(/amount mismatch/)
  })

  it('treats repeated success as stale and permits a single activation transition', () => {
    expect(canApplyBogStatus('pending', 'success')).toBe(true)
    expect(canApplyBogStatus('success', 'success')).toBe(false)
  })
})
