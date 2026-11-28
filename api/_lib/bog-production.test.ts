// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canApplyBogStatus,
  createBogIdempotencyKey,
  getBogOrderDetails,
  logBogDiagnostic,
  verifyBogOrderDetails,
  type BogOrderDetails,
  type BogStatus,
} from './bog-payment.ts'
import {
  bogConfirmKeyIsIsolated,
  createBogConfirmerClient,
  createMemoryCheckoutLedger,
  decideBogCheckoutRetry,
  handleBogCallback,
  handleBogInitialize,
  handleBogVerify,
  resolveDeviceSlotPackage,
  type StoredBogCheckout,
} from './bog-production.ts'

type BogInitializeDependencies = NonNullable<Parameters<typeof handleBogInitialize>[1]>

const environment = {
  VERCEL_ENV: 'production',
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  SUPABASE_BOG_CONFIRM_KEY: 'bog-confirm-jwt-key',
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

function paymentTransaction(status = 'pending', amount = 179) {
  return {
    payment_id: 'bog-order-1',
    merchant_payment_id: 'cr-merchant-1',
    user_id: 'user-1',
    amount,
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

  describe('BOG diagnostic logging', () => {
    beforeEach(() => {
      vi.restoreAllMocks()
    })

    it('projects only safe diagnostic fields and redacts sensitive message content', () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})

      logBogDiagnostic({
        stage: 'verify.handler',
        outcome: 'failure',
        paymentId: 'f32cb949-f999-4217-8308-5862e856cc7f',
        merchantPaymentId: 'cr-68ed36e6-6986-57f1-86e6-42171affffea',
        httpStatus: 200,
        orderStatus: 'rejected',
        paymentStatus: 'failed',
        errorCode: 'invalid_client',
        error: new Error('Payer jane@example.com card 4111111111111111 token secret-token'),
        configPresence: {
          BOG_CLIENT_KEY: true,
          BOG_SECRET_KEY: true,
          SUPABASE_BOG_CONFIRM_KEY: false,
          UNLISTED_SECRET: 'do-not-log-this',
        },
        rejectReason: 'Payment rejected by the servicing bank',
        paymentDetailCode: '12',
        paymentDetailCodeDescription: 'Cardholder Jane Doe; card 4111111111111111',
        actions: [{
          status: 'rejected',
          code: '12',
          code_description: 'Payer jane@example.com',
        }],
      })

      const [label, event] = info.mock.calls[0]
      expect(label).toBe('[BOG_DIAGNOSTIC]')
      expect(event).toMatchObject({
        stage: 'verify.handler',
        outcome: 'failure',
        http_status: 200,
        order_status: 'rejected',
        payment_status: 'failed',
        error_code: 'invalid_client',
        error_message: 'other',
        config_present: {
          BOG_CLIENT_KEY: true,
          BOG_SECRET_KEY: true,
          SUPABASE_BOG_CONFIRM_KEY: false,
        },
        reject_reason: 'servicing_bank_rejection',
        payment_detail: {
          code: '12',
          code_description: 'other',
        },
        actions: [{
          status: 'rejected',
          code: '12',
          code_description: 'other',
        }],
      })
      const serialized = JSON.stringify(info.mock.calls)
      expect(serialized).not.toContain('4111111111111111')
      expect(serialized).not.toContain('jane@example.com')
      expect(serialized).not.toContain('secret-token')
      expect(serialized).not.toContain('do-not-log-this')
    })

    it('replaces unknown BOG statuses and codes with fixed placeholders', () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const longValue = 'x'.repeat(100_000)
      const bearerValue = 'Bearer eyJhbGciOiJIUzI1NiJ9'

      logBogDiagnostic({
        stage: 'bog.receipt',
        outcome: 'success',
        orderStatus: 'secret-token',
        paymentStatus: bearerValue,
        errorCode: longValue,
        error: new Error(bearerValue),
        rejectReason: `payer ${longValue}`,
        paymentDetailCode: longValue,
        paymentDetailCodeDescription: bearerValue,
        actions: [
          'secret-token',
          {
            status: bearerValue,
            code: 'secret-token',
            code_description: longValue,
          },
          {
            status: { token: 'secret-token' },
            code: ['Bearer eyJhbGciOiJIUzI1NiJ9'],
            code_description: { nested: longValue },
          },
          {
            status: 'REJECTED',
            code: 12,
            code_description: 'Payment rejected by the servicing bank',
          },
        ],
      })

      const event = info.mock.calls[0][1]
      expect(event).toMatchObject({
        order_status: 'UNKNOWN_STATUS',
        payment_status: 'UNKNOWN_STATUS',
        error_code: 'UNKNOWN_CODE',
        error_message: 'other',
        reject_reason: 'other',
        payment_detail: {
          code: 'UNKNOWN_CODE',
          code_description: 'other',
        },
        actions: [
          { status: 'UNKNOWN_STATUS', code: 'UNKNOWN_CODE' },
          { status: 'UNKNOWN_STATUS', code: 'UNKNOWN_CODE', code_description: 'other' },
          { status: 'UNKNOWN_STATUS', code: 'UNKNOWN_CODE' },
          { status: 'rejected', code: '12', code_description: 'servicing_bank_rejection' },
        ],
      })
      const serialized = JSON.stringify(info.mock.calls)
      expect(serialized).not.toContain('secret-token')
      expect(serialized).not.toContain(bearerValue)
      expect(serialized).not.toContain(longValue)
    })

    it('silently drops malformed action data and tolerates malformed receipt shape', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const malformedAction = Object.defineProperty({}, 'status', {
        get() {
          throw new Error('secret-token')
        },
      })
      expect(() => logBogDiagnostic({
        stage: 'bog.receipt',
        actions: [malformedAction],
      })).not.toThrow()
      expect(info).not.toHaveBeenCalled()

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response('null', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)
      try {
        const malformedReceipt = await getBogOrderDetails(
          { clientKey: 'test-client-key', secretKey: 'test-secret-key' },
          'f32cb949-f999-4217-8308-5862e856cc7f',
        )
        expect(malformedReceipt).toBeNull()
        expect(info).toHaveBeenCalledWith('[BOG_DIAGNOSTIC]', expect.objectContaining({
          stage: 'bog.receipt',
          payment_id: 'f32cb949-f999-4217-8308-5862e856cc7f',
        }))
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('omits correlation values that are not payment UUIDs', () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      logBogDiagnostic({
        stage: 'verify.handler',
        paymentId: 'payer-identifier',
        merchantPaymentId: 'jane@example.com',
      })

      expect(info.mock.calls[0][1]).not.toHaveProperty('payment_id')
      expect(info.mock.calls[0][1]).not.toHaveProperty('merchant_payment_id')
      expect(JSON.stringify(info.mock.calls)).not.toContain('jane@example.com')
      expect(JSON.stringify(info.mock.calls)).not.toContain('payer-identifier')
    })

    it('extracts selected BOG receipt diagnostics without logging the receipt or token', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          order_id: 'f32cb949-f999-4217-8308-5862e856cc7f',
          external_order_id: 'cr-68ed36e6-6986-57f1-86e6-42171affffea',
          order_status: { key: 'rejected' },
          reject_reason: 'Payment rejected by the servicing bank',
          purchase_units: { request_amount: '99.00', currency_code: 'GEL' },
          payment_detail: {
            status: 'rejected',
            code: '12',
            code_description: 'Cardholder Jane Doe; private-account-value',
            actions: [{ status: 'rejected', code: '12', code_description: 'payer private-value' }],
          },
          private_receipt_value: 'must-not-be-logged',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      try {
        const order = await getBogOrderDetails(
          { clientKey: 'test-client-key', secretKey: 'test-secret-key' },
          'f32cb949-f999-4217-8308-5862e856cc7f',
        )

        expect(order.order_status?.key).toBe('rejected')
        const receiptEvent = info.mock.calls
          .map(([, event]) => event)
          .find((event) => typeof event === 'object' && event !== null && 'stage' in event && event.stage === 'bog.receipt')
        expect(receiptEvent).toMatchObject({
          stage: 'bog.receipt',
          http_status: 200,
          order_status: 'rejected',
          payment_status: 'rejected',
          reject_reason: 'servicing_bank_rejection',
          payment_detail: {
            code: '12',
            code_description: 'other',
          },
          actions: [{ status: 'rejected', code: '12', code_description: 'other' }],
        })
        const serialized = JSON.stringify(info.mock.calls)
        expect(serialized).not.toContain('test-access-token')
        expect(serialized).not.toContain('test-client-key')
        expect(serialized).not.toContain('test-secret-key')
        expect(serialized).not.toContain('private-account-value')
        expect(serialized).not.toContain('private_receipt_value')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('records BOG HTTP failure status and error code without logging response text', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {})
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'test-access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          error_code: 'UNKNOWN_CODE',
          message: 'payer jane@example.com card 4111111111111111',
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }))
      vi.stubGlobal('fetch', fetchMock)

      try {
        await expect(getBogOrderDetails(
          { clientKey: 'test-client-key', secretKey: 'test-secret-key' },
          'f32cb949-f999-4217-8308-5862e856cc7f',
        )).rejects.toThrow('BOG receipt lookup failed (503)')
        const receiptEvent = info.mock.calls
          .map(([, event]) => event)
          .find((event) => typeof event === 'object' && event !== null && 'stage' in event && event.stage === 'bog.receipt')
        expect(receiptEvent).toMatchObject({
          stage: 'bog.receipt',
          outcome: 'failure',
          http_status: 503,
          error_code: 'UNKNOWN_CODE',
          error_message: 'receipt_lookup_failure',
        })
        const serialized = JSON.stringify(info.mock.calls)
        expect(serialized).not.toContain('jane@example.com')
        expect(serialized).not.toContain('4111111111111111')
        expect(serialized).not.toContain('test-access-token')
        expect(serialized).not.toContain('secret-token')
      } finally {
        vi.unstubAllGlobals()
      }
    })

    it('does not interrupt mocked verification when console.info throws', async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {
        throw new Error('logger failure')
      })
      let currentStatus = 'pending'
      const updatePaymentStatus = vi.fn(async ({ status }: { status: string }) => {
        currentStatus = status
      })
      const response = await handleBogVerify(request(
        'https://cityroute.ge/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-1',
        { method: 'GET' },
      ), {
        environment,
        authenticateUser: async () => ({ id: 'user-1' }),
        createOrder: vi.fn(),
        insertTransaction: vi.fn(),
        getDeviceSlotPackage: async () => ({ deviceSlots: 1, priceAmount: 99 }),
        acquireBogRecoveryLease: async () => 'lease-test',
        releaseBogRecoveryLease: async () => true,
        getTransactionById: async () => paymentTransaction(currentStatus),
        getTransactionByMerchantId: async () => paymentTransaction(currentStatus),
        getOrderDetails: async () => successfulOrder,
        updatePaymentStatus,
        verifyCallbackSignature: async () => true,
      })

      expect(response.status, await response.clone().text()).toBe(200)
      expect(await response.json()).toMatchObject({ status: 'success', bankStatus: 'completed' })
      expect(updatePaymentStatus).toHaveBeenCalledTimes(1)
      expect(currentStatus).toBe('success')
    })
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
      checkoutLedger: createMemoryCheckoutLedger(),
      acquireBogRecoveryLease: async () => 'lease-test',
      releaseBogRecoveryLease: async () => true,
      getDeviceSlotPackage: async () => ({ deviceSlots: 2, priceAmount: 179 }),
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
    expect(insertTransaction).not.toHaveBeenCalled()
  })

  it('calculates 99 GEL on the server for one device and ignores a client-supplied amount', async () => {
    const createOrder = vi.fn(async (input: { amount: number; deviceSlots: number }) => {
      expect(input.amount).toBe(99)
      expect(input.deviceSlots).toBe(1)
      return { paymentId: 'bog-order-1', paymentUrl: 'https://payment.bog.ge/order/1' }
    })
    const insertTransaction = vi.fn(async () => {})
    const response = await handleBogInitialize(request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots: 1,
        requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        amount: 179,
      }),
    }), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder,
      checkoutLedger: createMemoryCheckoutLedger(),
      acquireBogRecoveryLease: async () => 'lease-test',
      releaseBogRecoveryLease: async () => true,
      getDeviceSlotPackage: async () => ({ deviceSlots: 1, priceAmount: 99 }),
      insertTransaction,
      getTransactionById: async () => null,
      getTransactionByMerchantId: async () => null,
      getOrderDetails: async () => successfulOrder,
      updatePaymentStatus: async () => {},
      verifyCallbackSignature: async () => true,
    })

    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, amount: 99 })
    expect(insertTransaction).not.toHaveBeenCalled()
  })

  it('rejects a package that is not active in the server catalog', async () => {
    const createOrder = vi.fn()
    const insertTransaction = vi.fn()
    const response = await handleBogInitialize(request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots: 3,
        requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      }),
    }), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder,
      getDeviceSlotPackage: async () => null,
      acquireBogRecoveryLease: async () => null,
      releaseBogRecoveryLease: async () => true,
      insertTransaction,
      getTransactionById: async () => null,
      getTransactionByMerchantId: async () => null,
      getOrderDetails: async () => successfulOrder,
      updatePaymentStatus: async () => {},
      verifyCallbackSignature: async () => true,
    })

    expect(response.status).toBe(400)
    expect(createOrder).not.toHaveBeenCalled()
    expect(insertTransaction).not.toHaveBeenCalled()
  })

  it('rejects checkout without an authenticated user token before querying or creating an order', async () => {
    const authenticateUser = vi.fn()
    const createOrder = vi.fn()
    const response = await handleBogInitialize(request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: {
        authorization: '',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots: 1,
        requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      }),
    }), {
      environment,
      authenticateUser,
      createOrder,
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
      insertTransaction: vi.fn(),
      getTransactionById: vi.fn(),
      getTransactionByMerchantId: vi.fn(),
      getOrderDetails: vi.fn(),
      updatePaymentStatus: vi.fn(),
      verifyCallbackSignature: vi.fn(),
    })
    expect(response.status).toBe(401)
    expect(authenticateUser).not.toHaveBeenCalled()
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('fails closed before checkout when the confirmer role cannot pass its authorization probe', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const createOrder = vi.fn()
    const getDeviceSlotPackage = vi.fn(async () => ({ deviceSlots: 1, priceAmount: 99 }))
    const response = await handleBogInitialize(request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots: 1,
        requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      }),
    }), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder,
      getDeviceSlotPackage,
      assertConfirmerReady: async () => {
        throw new Error('confirmer JWT is not authorized')
      },
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
      insertTransaction: vi.fn(),
      getTransactionById: vi.fn(),
      getTransactionByMerchantId: vi.fn(),
      getOrderDetails: vi.fn(),
      updatePaymentStatus: vi.fn(),
      verifyCallbackSignature: vi.fn(),
    })
    expect(response.status).toBe(503)
    expect(getDeviceSlotPackage).not.toHaveBeenCalled()
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('requires an isolated BOG confirmer JWT that is not the service_role key', () => {
    expect(bogConfirmKeyIsIsolated('service-role-key', 'bog-confirm-jwt-key')).toBe(true)
    expect(bogConfirmKeyIsIsolated('service-role-key', 'service-role-key')).toBe(false)
    expect(bogConfirmKeyIsIsolated('service-role-key', undefined)).toBe(false)
  })

  it('builds the confirmer client with anon apikey and confirmer Bearer Authorization', () => {
    const client = createBogConfirmerClient(
      'https://example.supabase.co',
      'anon-publishable-key',
      'bog-confirm-jwt-key',
    )
    // supabase-js stores the createClient key as the apikey header source
    const apiKey: unknown = Reflect.get(client, 'supabaseKey')
    expect(apiKey).toBe('anon-publishable-key')
    expect(apiKey).not.toBe('bog-confirm-jwt-key')
    expect(apiKey).not.toBe('service-role-key')
  })

  it('rejects production configuration when the confirmer JWT is missing or reused', async () => {
    const response = await handleBogVerify(request(
      'https://cityroute.ge/api/payments/bog/verify?provider=bog&paymentId=bog-order-1',
      { method: 'GET' },
    ), {
      environment: { ...environment, SUPABASE_BOG_CONFIRM_KEY: environment.SUPABASE_SERVICE_ROLE_KEY },
      authenticateUser: vi.fn(),
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
      getTransactionById: vi.fn(),
      getTransactionByMerchantId: vi.fn(),
      getOrderDetails: vi.fn(),
      updatePaymentStatus: vi.fn(),
      verifyCallbackSignature: vi.fn(),
    })
    expect(response.status).toBe(503)
  })

  it('rejects verify when the confirmer JWT is absent', async () => {
    const response = await handleBogVerify(request(
      'https://cityroute.ge/api/payments/bog/verify?provider=bog&paymentId=bog-order-1',
      { method: 'GET' },
    ), {
      environment: { ...environment, SUPABASE_BOG_CONFIRM_KEY: undefined },
      authenticateUser: vi.fn(),
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
      getTransactionById: vi.fn(),
      getTransactionByMerchantId: vi.fn(),
      getOrderDetails: vi.fn(),
      updatePaymentStatus: vi.fn(),
      verifyCallbackSignature: vi.fn(),
    })
    expect(response.status).toBe(503)
  })

  it('rejects a callback with an invalid BOG signature before any settlement', async () => {
    const updatePaymentStatus = vi.fn()
    const getOrderDetails = vi.fn()
    const response = await handleBogCallback(request('https://cityroute.ge/api/payments/bog/callback', {
      method: 'POST',
      headers: { 'callback-signature': 'forged-signature' },
      body: JSON.stringify({ event: 'order_payment', body: { order_id: 'bog-order-1' } }),
    }), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
      getTransactionById: vi.fn(),
      getTransactionByMerchantId: vi.fn(),
      getOrderDetails,
      updatePaymentStatus,
      verifyCallbackSignature: async () => false,
    })
    expect(response.status).toBe(401)
    expect(getOrderDetails).not.toHaveBeenCalled()
    expect(updatePaymentStatus).not.toHaveBeenCalled()
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
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
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

  it.each([
    { amount: 99 },
    { amount: 179 },
  ])('updates Premium for a verified $amount GEL order', async ({ amount }) => {
    let status = 'pending'
    const updatePaymentStatus = vi.fn(async ({ status: nextStatus }: { status: string }) => {
      status = nextStatus
    })
    const response = await handleBogVerify(request(
      'https://cityroute.ge/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-1',
      { method: 'GET' },
    ), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
      getTransactionById: async () => paymentTransaction(status, amount),
      getTransactionByMerchantId: async () => paymentTransaction(status, amount),
      getOrderDetails: async () => ({
        ...successfulOrder,
        purchase_units: { ...successfulOrder.purchase_units, request_amount: `${amount}.00` },
      }),
      updatePaymentStatus,
      verifyCallbackSignature: async () => true,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'success' })
    expect(updatePaymentStatus).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'bog-order-1',
      status: 'success',
      transactionId: 'bank-transaction-1',
      metadata: expect.objectContaining({
        bank_status: 'completed',
        bank_amount: `${amount}.00`,
        bank_currency: 'GEL',
        bank_external_order_id: 'cr-merchant-1',
      }),
    }))
  })

  it('does not activate Premium while the bank still reports a pending payment', async () => {
    const updatePaymentStatus = vi.fn()
    const response = await handleBogVerify(request(
      'https://cityroute.ge/api/payments/bog/verify?provider=bog&merchantPaymentId=cr-merchant-1',
      { method: 'GET' },
    ), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder: vi.fn(),
      insertTransaction: vi.fn(),
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
      getTransactionById: async () => paymentTransaction('pending'),
      getTransactionByMerchantId: async () => paymentTransaction('pending'),
      getOrderDetails: async () => ({
        ...successfulOrder,
        order_status: { key: 'created' },
      }),
      updatePaymentStatus,
      verifyCallbackSignature: async () => true,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'pending', bankStatus: 'created' })
    expect(updatePaymentStatus).not.toHaveBeenCalled()
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
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
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
      getDeviceSlotPackage: vi.fn(),
      acquireBogRecoveryLease: vi.fn(),
      releaseBogRecoveryLease: vi.fn(),
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

describe('BOG device package catalog lookup', () => {
  const missingTable = {
    code: '42P01',
    message: 'relation "public.device_slot_packages" does not exist',
  }
  const missingFromSchemaCache = {
    code: 'PGRST205',
    message: "Could not find the table 'public.device_slot_packages' in the schema cache",
  }

  function initializeWith(deviceSlots: number, lookup: (slots: number) => Promise<{ deviceSlots: number; priceAmount: number } | null>) {
    const createOrder = vi.fn(async () => ({ paymentId: 'bog-order-1', paymentUrl: 'https://payment.bog.ge/order/1' }))
    const insertTransaction = vi.fn(async () => {})
    const response = handleBogInitialize(request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots,
        requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
        amount: 1,
      }),
    }), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder,
      checkoutLedger: createMemoryCheckoutLedger(),
      acquireBogRecoveryLease: async () => 'lease-test',
      releaseBogRecoveryLease: async () => true,
      getDeviceSlotPackage: lookup,
      insertTransaction,
      getTransactionById: async () => null,
      getTransactionByMerchantId: async () => null,
      getOrderDetails: async () => successfulOrder,
      updatePaymentStatus: async () => {},
      verifyCallbackSignature: async () => true,
    })
    return { response, createOrder, insertTransaction }
  }

  it('always uses the database catalog price when the table exists', () => {
    const warn = vi.fn()
    expect(resolveDeviceSlotPackage(1, {
      data: { device_slots: 1, price_amount: 109 },
      error: null,
    }, warn)).toEqual({ deviceSlots: 1, priceAmount: 109 })
    expect(resolveDeviceSlotPackage(2, { data: null, error: null }, warn)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('falls back to legacy 99/179 GEL only when the catalog table is missing, and logs it', () => {
    const warn = vi.fn()
    expect(resolveDeviceSlotPackage(1, { data: null, error: missingTable }, warn))
      .toEqual({ deviceSlots: 1, priceAmount: 99 })
    expect(resolveDeviceSlotPackage(2, { data: null, error: missingFromSchemaCache }, warn))
      .toEqual({ deviceSlots: 2, priceAmount: 179 })
    expect(resolveDeviceSlotPackage(3, { data: null, error: missingTable }, warn)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('device_slot_packages table is missing'),
      expect.objectContaining({ deviceSlots: 1, priceAmount: 99, errorCode: '42P01' }),
    )
  })

  it.each([
    { name: 'permission denied', error: { code: '42501', message: 'permission denied for table device_slot_packages' } },
    { name: 'connection failure', error: { message: 'TypeError: fetch failed' } },
    { name: 'invalid query', error: { code: 'PGRST100', message: 'failed to parse filter' } },
    { name: 'missing column', error: { code: '42703', message: 'column device_slot_packages.price_amount does not exist' } },
    { name: 'another missing table', error: { code: '42P01', message: 'relation "public.payment_transactions" does not exist' } },
  ])('does not fall back on $name', ({ error }) => {
    const warn = vi.fn()
    expect(() => resolveDeviceSlotPackage(1, { data: null, error }, warn)).toThrow()
    expect(warn).not.toHaveBeenCalled()
  })

  it('starts a 99 GEL order through the fallback while migration 029 is not applied', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { response, createOrder, insertTransaction } = initializeWith(1, async (slots) =>
      resolveDeviceSlotPackage(slots, { data: null, error: missingTable }),
    )
    const result = await response
    expect(result.status, await result.clone().text()).toBe(200)
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 99, deviceSlots: 1 }))
    expect(insertTransaction).not.toHaveBeenCalled()
    expect(info.mock.calls.map(([, event]) => event)).toContainEqual(expect.objectContaining({
      stage: 'db.package_catalog',
      outcome: 'fallback',
      database_operation: 'device_slot_packages',
      database_outcome: 'fallback',
    }))
  })

  it('refuses to start an order when the catalog lookup fails for any other reason', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { response, createOrder, insertTransaction } = initializeWith(1, async (slots) =>
      resolveDeviceSlotPackage(slots, {
        data: null,
        error: { code: '42501', message: 'permission denied for table device_slot_packages' },
      }),
    )
    const result = await response
    expect(result.status).toBe(500)
    expect(createOrder).not.toHaveBeenCalled()
    expect(insertTransaction).not.toHaveBeenCalled()
  })
})

describe('BOG pending checkout retry', () => {
  const checkoutUrl = 'https://payment.bog.ge/order/existing'
  const trusted = { deviceSlots: 1, priceAmount: 99 }
  const requestId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
  let merchantPaymentId = ''

  beforeEach(async () => {
    merchantPaymentId = `cr-${await createBogIdempotencyKey('user-1', requestId)}`
  })

  function stored(overrides: Partial<StoredBogCheckout> = {}): StoredBogCheckout {
    return {
      payment_id: 'bog-order-existing',
      merchant_payment_id: merchantPaymentId,
      amount: 99,
      currency: 'GEL',
      status: 'pending',
      metadata: { device_slots: 1, checkout_url: checkoutUrl },
      ...overrides,
    }
  }

  async function retry(existing: StoredBogCheckout | null, deviceSlots = 1) {
    const createOrder = vi.fn()
    const insertTransaction = vi.fn()
    const response = await handleBogInitialize(request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots,
        requestId,
        amount: 1,
      }),
    }), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder,
      getDeviceSlotPackage: async () => (
        deviceSlots === 1 ? { deviceSlots: 1, priceAmount: 99 } : { deviceSlots: 2, priceAmount: 179 }
      ),
      acquireBogRecoveryLease: async () => null,
      releaseBogRecoveryLease: async () => true,
      findTransactionByIdempotencyKey: async () => existing,
      insertTransaction,
      getTransactionById: async () => null,
      getTransactionByMerchantId: async () => null,
      getOrderDetails: async () => successfulOrder,
      updatePaymentStatus: async () => {},
      verifyCallbackSignature: async () => true,
    })
    return { response, createOrder, insertTransaction }
  }

  it('refuses to create a bank order when the atomic checkout ledger is unavailable', async () => {
    const createOrder = vi.fn()
    const insertTransaction = vi.fn()
    const response = await handleBogInitialize(request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'bog',
        deviceSlots: 1,
        requestId,
      }),
    }), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder,
      getDeviceSlotPackage: async () => trusted,
      acquireBogRecoveryLease: async () => null,
      releaseBogRecoveryLease: async () => true,
      findTransactionByIdempotencyKey: async () => null,
      insertTransaction,
      getTransactionById: async () => null,
      getTransactionByMerchantId: async () => null,
      getOrderDetails: async () => successfulOrder,
      updatePaymentStatus: async () => {},
      verifyCallbackSignature: async () => true,
    })
    expect(response.status).toBe(503)
    expect(createOrder).not.toHaveBeenCalled()
    expect(insertTransaction).not.toHaveBeenCalled()
  })

  it('reuses a legacy pending order from its stored amount and does not create another bank order', async () => {
    expect(decideBogCheckoutRetry(stored(), trusted, merchantPaymentId)).toEqual({
      action: 'reuse',
      paymentUrl: checkoutUrl,
      amount: 99,
    })
    const { response, createOrder, insertTransaction } = await retry(stored())
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, paymentUrl: checkoutUrl, amount: 99 })
    expect(createOrder).not.toHaveBeenCalled()
    expect(insertTransaction).not.toHaveBeenCalled()
  })

  it('reuses a new pending order that already has package_price', async () => {
    const existing = stored({ metadata: { device_slots: 1, package_price: 99, checkout_url: checkoutUrl } })
    const { response, createOrder } = await retry(existing)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ amount: 99, paymentUrl: checkoutUrl })
    expect(createOrder).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'wrong stored amount', order: stored({ amount: 179 }) },
    { name: 'wrong device count', order: stored({ metadata: { device_slots: 2, checkout_url: checkoutUrl } }) },
    { name: 'missing device count', order: stored({ metadata: { checkout_url: checkoutUrl } }) },
    { name: 'conflicting package price', order: stored({ metadata: { device_slots: 1, package_price: 179, checkout_url: checkoutUrl } }) },
    { name: 'already successful payment', order: stored({ status: 'success' }) },
    { name: 'untrusted checkout URL', order: stored({ metadata: { device_slots: 1, checkout_url: 'https://evil.example/pay' } }) },
    { name: 'legacy order without a checkout URL', order: stored({ metadata: { device_slots: 1 } }) },
  ])('rejects a $name before creating a bank order', async ({ order }) => {
    const { response, createOrder, insertTransaction } = await retry(order)
    expect(response.status).toBe(409)
    expect(createOrder).not.toHaveBeenCalled()
    expect(insertTransaction).not.toHaveBeenCalled()
  })

  it('rejects the same idempotency key when the selected package changed', async () => {
    const { response, createOrder } = await retry(stored(), 2)
    expect(response.status).toBe(409)
    expect(createOrder).not.toHaveBeenCalled()
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

describe('BOG atomic checkout claim', () => {
  const recoveryLeases = new Map<string, string>()
  const recoveryReceipts = new Map<string, BogOrderDetails>()
  let recoveryLeaseSequence = 0

  beforeEach(() => {
    recoveryLeases.clear()
    recoveryReceipts.clear()
    recoveryLeaseSequence = 0
  })

  const requestIds = [
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-a222-222222222222',
    '33333333-3333-4333-b333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-9555-555555555555',
    '66666666-6666-4666-a666-666666666666',
    '77777777-7777-4777-b777-777777777777',
    '88888888-8888-4888-8888-888888888888',
  ]

  function initialize(
    ledger: ReturnType<typeof createMemoryCheckoutLedger>,
    requestId: string,
    createOrder: BogInitializeDependencies['createOrder'],
    deviceSlots = 1,
    recovery: {
      getOrderDetails?: () => Promise<BogOrderDetails>
      updatePaymentStatus?: (input: {
        paymentId: string
        status: BogStatus
        transactionId: string | null
        metadata: Record<string, string | null>
      }) => Promise<void>
    } = {},
  ) {
    return handleBogInitialize(request('https://cityroute.ge/api/payments/bog/initialize', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-authenticated-user-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ provider: 'bog', deviceSlots, requestId, amount: 1 }),
    }), {
      environment,
      authenticateUser: async () => ({ id: 'user-1' }),
      createOrder,
      checkoutLedger: ledger,
      claimLeaseMs: 1_000,
      bankCallTimeoutMs: 40,
      waitTimeoutMs: 500,
      pollIntervalMs: 5,
      getDeviceSlotPackage: async () => (
        deviceSlots === 2 ? { deviceSlots: 2, priceAmount: 179 } : { deviceSlots: 1, priceAmount: 99 }
      ),
      acquireBogRecoveryLease: async (claimPaymentId) => {
        if (recoveryLeases.has(claimPaymentId)) return null
        const token = `lease-${++recoveryLeaseSequence}`
        recoveryLeases.set(claimPaymentId, token)
        return token
      },
      releaseBogRecoveryLease: async (claimPaymentId, token) => {
        if (recoveryLeases.get(claimPaymentId) !== token) return false
        recoveryLeases.delete(claimPaymentId)
        return true
      },
      insertTransaction: async () => {},
      getTransactionById: async () => null,
      getTransactionByMerchantId: async () => null,
      getOrderDetails: recovery.getOrderDetails ?? (async (paymentId) => recoveryReceipts.get(paymentId) ?? successfulOrder),
      updatePaymentStatus: recovery.updatePaymentStatus ?? (async () => {}),
      verifyCallbackSignature: async () => true,
    })
  }

  function seedStaleBankCall(
    ledger: ReturnType<typeof createMemoryCheckoutLedger>,
    requestId: string,
    overrides: Partial<StoredBogCheckout> = {},
  ) {
    const checkout: StoredBogCheckout = {
      user_id: 'user-1',
      payment_id: 'unissued:reconciliation-claim',
      merchant_payment_id: 'cr-reconciliation-claim',
      idempotency_key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      amount: 99,
      currency: 'GEL',
      status: 'pending',
      created_at: new Date(Date.now() - 60_000).toISOString(),
      metadata: {
        provider: 'bog',
        device_slots: 1,
        package_price: 99,
        checkout_phase: 'bank_call',
        bank_call_started_at: new Date(Date.now() - 60_000).toISOString(),
        client_request_ids: [requestId],
      },
      ...overrides,
    }
    ledger.seed(checkout)
    return checkout
  }

  function seedReadyCheckout(
    ledger: ReturnType<typeof createMemoryCheckoutLedger>,
    requestId: string,
    paymentId = 'bog-ready-order',
    merchantPaymentId = 'cr-ready-order',
  ) {
    const checkout: StoredBogCheckout = {
      user_id: 'user-1',
      payment_id: paymentId,
      merchant_payment_id: merchantPaymentId,
      idempotency_key: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      amount: 99,
      currency: 'GEL',
      status: 'pending',
      created_at: new Date().toISOString(),
      metadata: {
        provider: 'bog',
        device_slots: 1,
        package_price: 99,
        checkout_phase: 'ready',
        checkout_url: `https://payment.bog.ge/order/${paymentId}`,
        claim_payment_id: 'unissued:ready-claim',
        bank_payment_id: paymentId,
        client_request_ids: [requestId],
      },
    }
    ledger.seed(checkout)
    return checkout
  }

  function bankOrder(paymentId: string) {
    return vi.fn(async (input: { amount: number; merchantPaymentId: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      recoveryReceipts.set(paymentId, {
        order_id: paymentId,
        external_order_id: input.merchantPaymentId,
        order_status: { key: 'created' },
        purchase_units: { request_amount: input.amount.toFixed(2), refund_amount: '0', currency_code: 'GEL' },
      })
      return { paymentId, paymentUrl: `https://payment.bog.ge/order/${paymentId}` }
    })
  }

  it('lets two simultaneous identical requests create one bank order', async () => {
    const ledger = createMemoryCheckoutLedger()
    const createOrder = bankOrder('bog-once')
    const responses = await Promise.all([
      initialize(ledger, requestIds[0], createOrder),
      initialize(ledger, requestIds[0], createOrder),
    ])
    const bodies = await Promise.all(responses.map((response) => response.json()))
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(bodies.map((body) => body.paymentUrl)).toEqual([
      'https://payment.bog.ge/order/bog-once',
      'https://payment.bog.ge/order/bog-once',
    ])
    expect(bodies.every((body) => body.amount === 99)).toBe(true)
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 99, deviceSlots: 1 }))
  })

  it('passes the authenticated bearer token to the atomic checkout ledger', async () => {
    const ledger = createMemoryCheckoutLedger()
    const reserve = vi.spyOn(ledger, 'reserve')
    const response = await initialize(ledger, requestIds[0], bankOrder('bog-auth-token'))
    expect(response.status).toBe(200)
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      accessToken: 'test-authenticated-user-token',
    }))
  })

  it('lets several simultaneous identical requests create one bank order', async () => {
    const ledger = createMemoryCheckoutLedger()
    const createOrder = bankOrder('bog-many')
    const responses = await Promise.all(requestIds.map(() => initialize(ledger, requestIds[0], createOrder)))
    const bodies = await Promise.all(responses.map((response) => response.json()))
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(new Set(bodies.map((body) => body.paymentUrl)).size).toBe(1)
    expect(createOrder).toHaveBeenCalledTimes(1)
  })

  it('treats different request ids for the same package as one logical order', async () => {
    const ledger = createMemoryCheckoutLedger()
    const createOrder = bankOrder('bog-logical')
    const responses = await Promise.all([
      initialize(ledger, requestIds[0], createOrder, 2),
      initialize(ledger, requestIds[1], createOrder, 2),
    ])
    const bodies = await Promise.all(responses.map((response) => response.json()))
    expect(bodies.map((body) => body.amount)).toEqual([179, 179])
    expect(bodies[0].paymentUrl).toBe(bodies[1].paymentUrl)
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({ amount: 179, deviceSlots: 2 }))
  })

  it('keeps the distributed lease after a timed-out BOG request to block overlapping retries', async () => {
    const ledger = createMemoryCheckoutLedger()
    const createOrder = vi.fn((_input: { idempotencyKey: string }) =>
      new Promise<{ paymentId: string; paymentUrl: string }>(() => {}),
    )
    const first = await initialize(ledger, requestIds[0], createOrder)
    expect(first.status).toBe(409)
    expect((await first.json()).code).toBe('payment_attempt_unresolved')
    await new Promise((resolve) => setTimeout(resolve, 80))
    const second = await initialize(ledger, requestIds[1], createOrder)
    expect(second.status).toBe(409)
    expect((await second.json()).code).toBe('payment_attempt_unresolved')
    expect(createOrder).toHaveBeenCalledTimes(1)
  })

  it('recovers a crashed bank call by replaying the same BOG idempotency key and verifying its receipt', async () => {
    const ledger = createMemoryCheckoutLedger()
    const claim = seedStaleBankCall(ledger, requestIds[0])
    const createOrder = vi.fn(async () => ({
      paymentId: 'bog-recovered-order',
      paymentUrl: 'https://payment.bog.ge/order/recovered',
    }))
    const receipt: BogOrderDetails = {
      order_id: 'bog-recovered-order',
      external_order_id: claim.merchant_payment_id!,
      order_status: { key: 'created' },
      purchase_units: { request_amount: '99.00', refund_amount: '0', currency_code: 'GEL' },
    }
    const updatePaymentStatus = vi.fn(async () => {})
    const response = await initialize(ledger, requestIds[0], createOrder, 1, {
      getOrderDetails: async () => receipt,
      updatePaymentStatus,
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      paymentUrl: 'https://payment.bog.ge/order/recovered',
      amount: 99,
    })
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: claim.idempotency_key,
      merchantPaymentId: claim.merchant_payment_id,
      amount: 99,
      deviceSlots: 1,
    }))
    expect(updatePaymentStatus).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'bog-recovered-order',
      status: 'pending',
      metadata: expect.objectContaining({ bank_external_order_id: claim.merchant_payment_id }),
    }))
    await expect(ledger.read(claim.payment_id)).resolves.toMatchObject({
      payment_id: 'bog-recovered-order',
      metadata: {
        checkout_phase: 'ready',
        claim_payment_id: claim.payment_id,
        bank_payment_id: 'bog-recovered-order',
      },
    })
  })

  it('retries settlement for duplicate recovery requests without activating Premium twice', async () => {
    const ledger = createMemoryCheckoutLedger()
    const claim = seedStaleBankCall(ledger, requestIds[0])
    const createOrder = vi.fn(async () => ({
      paymentId: 'bog-recovered-success',
      paymentUrl: 'https://payment.bog.ge/order/recovered-success',
    }))
    const receipt: BogOrderDetails = {
      order_id: 'bog-recovered-success',
      external_order_id: claim.merchant_payment_id!,
      order_status: { key: 'completed' },
      purchase_units: { request_amount: '99', refund_amount: '0', currency_code: 'GEL' },
      payment_detail: { transaction_id: 'bank-recovered-success' },
    }
    let settled = false
    let premiumActivations = 0
    const updatePaymentStatus = vi.fn(async ({ status }: { status: BogStatus }) => {
      if (status === 'success' && !settled) {
        settled = true
        premiumActivations += 1
      }
    })
    const options = { getOrderDetails: async () => receipt, updatePaymentStatus }

    const first = await initialize(ledger, requestIds[0], createOrder, 1, options)
    const second = await initialize(ledger, requestIds[0], createOrder, 1, options)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(updatePaymentStatus).toHaveBeenCalledTimes(2)
    expect(premiumActivations).toBe(1)
    expect(updatePaymentStatus).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: 'bog-recovered-success',
      status: 'success',
      transactionId: 'bank-recovered-success',
    }))
  })

  it('uses a database lease to prevent concurrent retries from replaying one recovery claim', async () => {
    const ledger = createMemoryCheckoutLedger()
    const claim = seedStaleBankCall(ledger, requestIds[0])
    const createOrder = vi.fn(async () => ({
      paymentId: 'bog-concurrent-recovery',
      paymentUrl: 'https://payment.bog.ge/order/concurrent-recovery',
    }))
    const receipt: BogOrderDetails = {
      order_id: 'bog-concurrent-recovery',
      external_order_id: claim.merchant_payment_id!,
      order_status: { key: 'completed' },
      purchase_units: { request_amount: '99', refund_amount: '0', currency_code: 'GEL' },
    }
    const updatePaymentStatus = vi.fn(async () => {})
    let startReceipt: (() => void) | undefined
    let markReceiptStarted: (() => void) | undefined
    const receiptStarted = new Promise<void>((resolve) => { markReceiptStarted = resolve })
    const getOrderDetails = vi.fn(async () => {
      markReceiptStarted?.()
      await new Promise<void>((resolve) => { startReceipt = resolve })
      return receipt
    })
    const options = { getOrderDetails, updatePaymentStatus }
    const firstPromise = initialize(ledger, requestIds[0], createOrder, 1, options)
    await receiptStarted
    const secondPromise = initialize(ledger, requestIds[0], createOrder, 1, options)
    const second = await secondPromise
    expect(second.status).toBe(409)
    startReceipt?.()
    const first = await firstPromise

    expect(first.status).toBe(200)
    expect(createOrder).toHaveBeenCalledTimes(1)
    expect(createOrder).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: claim.idempotency_key,
    }))
    expect(getOrderDetails).toHaveBeenCalledTimes(1)
    expect(updatePaymentStatus).toHaveBeenCalledTimes(1)
    await expect(ledger.read(claim.payment_id)).resolves.toMatchObject({
      payment_id: 'bog-concurrent-recovery',
      metadata: { checkout_phase: 'ready' },
    })
  })

  it('re-verifies and retries settlement for ready claims without extending Premium twice', async () => {
    const ledger = createMemoryCheckoutLedger()
    const ready = seedReadyCheckout(ledger, requestIds[0])
    const receipt: BogOrderDetails = {
      order_id: ready.payment_id,
      external_order_id: ready.merchant_payment_id!,
      order_status: { key: 'completed' },
      purchase_units: { request_amount: '99.00', refund_amount: '0', currency_code: 'GEL' },
      payment_detail: { transaction_id: 'bank-ready-success' },
    }
    let settled = false
    let premiumActivations = 0
    const updatePaymentStatus = vi.fn(async ({ status }: { status: BogStatus }) => {
      if (status === 'success' && !settled) {
        settled = true
        premiumActivations += 1
      }
    })
    const options = {
      getOrderDetails: async () => receipt,
      updatePaymentStatus,
    }

    const first = await initialize(ledger, requestIds[0], bankOrder('unused'), 1, options)
    const retry = await initialize(ledger, requestIds[0], bankOrder('unused'), 1, options)

    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(updatePaymentStatus).toHaveBeenCalledTimes(2)
    expect(premiumActivations).toBe(1)
  })

  it('does not retry settlement for a ready claim with an invalid BOG receipt', async () => {
    const ledger = createMemoryCheckoutLedger()
    const ready = seedReadyCheckout(ledger, requestIds[0])
    const updatePaymentStatus = vi.fn(async () => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const response = await initialize(ledger, requestIds[0], bankOrder('unused'), 1, {
      getOrderDetails: async () => ({
        order_id: ready.payment_id,
        external_order_id: 'cr-wrong-merchant',
        order_status: { key: 'completed' },
        purchase_units: { request_amount: '99', refund_amount: '0', currency_code: 'GEL' },
      }),
      updatePaymentStatus,
    })

    expect(response.status).toBe(409)
    expect(updatePaymentStatus).not.toHaveBeenCalled()
  })

  it('leaves a stale claim unresolved when the recovered order ID does not match the BOG receipt', async () => {
    const ledger = createMemoryCheckoutLedger()
    const claim = seedStaleBankCall(ledger, requestIds[0])
    const createOrder = vi.fn(async () => ({
      paymentId: 'bog-recovery-id',
      paymentUrl: 'https://payment.bog.ge/order/recovery-id',
    }))
    const updatePaymentStatus = vi.fn(async () => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await initialize(ledger, requestIds[0], createOrder, 1, {
      getOrderDetails: async () => ({
        order_id: 'bog-another-order',
        external_order_id: claim.merchant_payment_id,
        order_status: { key: 'created' },
        purchase_units: { request_amount: '99', refund_amount: '0', currency_code: 'GEL' },
      }),
      updatePaymentStatus,
    })

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('payment_attempt_unresolved')
    expect(updatePaymentStatus).not.toHaveBeenCalled()
    await expect(ledger.read(claim.payment_id)).resolves.toMatchObject({
      payment_id: claim.payment_id,
      metadata: { checkout_phase: 'bank_call' },
    })
  })

  it('leaves a stale claim unresolved when the BOG receipt merchant ID is incorrect', async () => {
    const ledger = createMemoryCheckoutLedger()
    const claim = seedStaleBankCall(ledger, requestIds[0])
    const createOrder = vi.fn(async () => ({
      paymentId: 'bog-wrong-merchant',
      paymentUrl: 'https://payment.bog.ge/order/wrong-merchant',
    }))
    const updatePaymentStatus = vi.fn(async () => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await initialize(ledger, requestIds[0], createOrder, 1, {
      getOrderDetails: async () => ({
        order_id: 'bog-wrong-merchant',
        external_order_id: 'cr-someone-else',
        order_status: { key: 'created' },
        purchase_units: { request_amount: '99', refund_amount: '0', currency_code: 'GEL' },
      }),
      updatePaymentStatus,
    })

    expect(response.status).toBe(409)
    expect(updatePaymentStatus).not.toHaveBeenCalled()
    await expect(ledger.read(claim.payment_id)).resolves.toMatchObject({
      payment_id: claim.payment_id,
      metadata: { checkout_phase: 'bank_call' },
    })
  })

  it('leaves a stale claim unresolved for an unknown BOG status', async () => {
    const ledger = createMemoryCheckoutLedger()
    const claim = seedStaleBankCall(ledger, requestIds[0])
    const createOrder = vi.fn(async () => ({
      paymentId: 'bog-unknown-status',
      paymentUrl: 'https://payment.bog.ge/order/unknown-status',
    }))
    const updatePaymentStatus = vi.fn(async () => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await initialize(ledger, requestIds[0], createOrder, 1, {
      getOrderDetails: async () => ({
        order_id: 'bog-unknown-status',
        external_order_id: claim.merchant_payment_id,
        order_status: { key: 'bank_new_status' },
        purchase_units: { request_amount: '99', refund_amount: '0', currency_code: 'GEL' },
      }),
      updatePaymentStatus,
    })

    expect(response.status).toBe(409)
    expect(updatePaymentStatus).not.toHaveBeenCalled()
    await expect(ledger.read(claim.payment_id)).resolves.toMatchObject({
      payment_id: claim.payment_id,
      metadata: { checkout_phase: 'bank_call' },
    })
  })

  it('returns an explicit rate-limit response when the database rejects excess active claims', async () => {
    const ledger = createMemoryCheckoutLedger()
    const createOrder = vi.fn()
    const limitError = Object.assign(new Error('Too many active BOG checkout attempts'), { code: 'P0001' })
    vi.spyOn(ledger, 'reserve').mockRejectedValue(limitError)

    const response = await initialize(ledger, requestIds[0], createOrder)

    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ code: 'too_many_active_checkouts' })
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('replays the same BOG order when the bank succeeded but the database write failed', async () => {
    const ledger = createMemoryCheckoutLedger()
    const createOrder = vi.fn(async (_input: { idempotencyKey: string; merchantPaymentId: string }) => ({
      paymentId: 'bog-db-fail',
      paymentUrl: 'https://payment.bog.ge/order/db-fail',
    }))
    const complete = vi.fn(async () => {
      throw new Error('database write failed')
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failingLedger = {
      ...ledger,
      complete,
    }
    const first = await initialize(failingLedger, requestIds[0], createOrder)
    expect(first.status).toBe(409)
    await new Promise((resolve) => setTimeout(resolve, 80))
    recoveryLeases.clear()
    const second = await initialize(failingLedger, requestIds[1], createOrder, 1, {
      getOrderDetails: async () => ({
        order_id: 'bog-db-fail',
        external_order_id: createOrder.mock.calls[0][0].merchantPaymentId,
        order_status: { key: 'created' },
        purchase_units: { request_amount: '99', refund_amount: '0', currency_code: 'GEL' },
      }),
    })
    expect(second.status).toBe(409)
    expect((await second.json()).code).toBe('payment_attempt_unresolved')
    expect(createOrder).toHaveBeenCalledTimes(2)
    expect(createOrder.mock.calls[0][0].idempotencyKey).toBe(createOrder.mock.calls[1][0].idempotencyKey)
    expect(complete).toHaveBeenCalled()
  })

  it('recovers after the retained lease expires following a crashed bank call', async () => {
    const ledger = createMemoryCheckoutLedger()
    const createOrder = vi.fn(async (_input: { idempotencyKey: string }) => {
      throw new Error('server crashed during BOG call')
    })
    const first = await initialize(ledger, requestIds[0], createOrder)
    expect(first.status).toBe(409)
    await new Promise((resolve) => setTimeout(resolve, 80))
    recoveryLeases.clear()
    const second = await initialize(ledger, requestIds[2], createOrder)
    expect((await second.json()).code).toBe('payment_attempt_unresolved')
    expect(createOrder).toHaveBeenCalledTimes(2)
    expect(createOrder.mock.calls[0][0].idempotencyKey).toBe(createOrder.mock.calls[1][0].idempotencyKey)
  })

  it('rejects a pending order without a checkout URL and ignores a new request id', async () => {
    const ledger = createMemoryCheckoutLedger()
    ledger.seed({
      user_id: 'user-1',
      payment_id: 'legacy-pending',
      merchant_payment_id: 'cr-legacy',
      amount: 99,
      currency: 'GEL',
      status: 'pending',
      metadata: { provider: 'bog', device_slots: 1, package_price: 99, client_request_ids: [requestIds[0]] },
    })
    const createOrder = vi.fn()
    const first = await initialize(ledger, requestIds[0], createOrder)
    const second = await initialize(ledger, requestIds[3], createOrder)
    expect(first.status).toBe(409)
    expect(second.status).toBe(409)
    expect((await first.json()).code).toBe('pending_checkout_unresumable')
    expect((await second.json()).code).toBe('pending_checkout_unresumable')
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('does not create another order for a completed payment retry', async () => {
    const ledger = createMemoryCheckoutLedger()
    ledger.seed({
      user_id: 'user-1',
      payment_id: 'bog-paid',
      merchant_payment_id: 'cr-paid',
      amount: 99,
      currency: 'GEL',
      status: 'success',
      created_at: new Date().toISOString(),
      metadata: {
        provider: 'bog',
        device_slots: 1,
        package_price: 99,
        checkout_url: 'https://payment.bog.ge/order/paid',
        client_request_ids: [requestIds[0]],
      },
    })
    const createOrder = vi.fn()
    const response = await initialize(ledger, requestIds[0], createOrder)
    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('payment_already_settled')
    expect(createOrder).not.toHaveBeenCalled()
  })

  it('recovers an expired claim that never reached the bank with one later call', async () => {
    const ledger = createMemoryCheckoutLedger()
    ledger.seed({
      user_id: 'user-1',
      payment_id: 'unissued:expired-claim',
      merchant_payment_id: 'cr-expired-claim',
      idempotency_key: '99999999-9999-4999-8999-999999999999',
      amount: 99,
      currency: 'GEL',
      status: 'pending',
      metadata: {
        provider: 'bog',
        device_slots: 1,
        package_price: 99,
        checkout_phase: 'claimed',
        claim_expires_at: new Date(Date.now() - 1_000).toISOString(),
        client_request_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
      },
    })
    const createOrder = bankOrder('bog-recovered')
    const responses = await Promise.all([
      initialize(ledger, requestIds[4], createOrder),
      initialize(ledger, requestIds[5], createOrder),
    ])
    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(createOrder).toHaveBeenCalledTimes(1)
  })
})
