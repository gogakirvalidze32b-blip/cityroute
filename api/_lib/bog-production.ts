import { createClient } from '@supabase/supabase-js'
import {
  BOG_PRODUCTION_CALLBACK_PUBLIC_KEY,
  BOG_PRODUCTION_CONFIGURATION,
  canApplyBogPaymentStatus,
  createBogIdempotencyKey,
  createBogOrder,
  getBogOrderDetails,
  toPersistedBogPaymentStatus,
  verifyBogCallbackSignature,
  verifyBogOrderDetails,
  type BogCredentials,
  type BogOrderDetails,
  type PersistedBogPaymentStatus,
} from '../../supabase/functions/_shared/bog-payment.ts'

const PRODUCTION_HOSTS = new Set(['cityroute.ge', 'www.cityroute.ge'])
const DEVICE_SLOT_AMOUNTS = { 1: 99, 2: 179 } as const

type Environment = {
  VERCEL_ENV?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  BOG_CLIENT_KEY?: string
  BOG_SECRET_KEY?: string
  PRODUCTION_APP_URL?: string
}

type PaymentTransaction = {
  payment_id: string
  merchant_payment_id: string | null
  user_id: string
  amount: number | string
  currency: string
  status: string
}

type NewPaymentTransaction = {
  user_id: string
  provider: 'bog'
  payment_id: string
  merchant_payment_id: string
  idempotency_key: string
  amount: number
  currency: 'GEL'
  status: 'pending'
  metadata: { provider: 'bog'; device_slots: 1 | 2 }
}

type BogPaymentStatusUpdate = {
  paymentId: string
  status: PersistedBogPaymentStatus
  transactionId: string | null
  metadata: Record<string, string | null>
}

export function buildBogPaymentStatusRpcCall(input: BogPaymentStatusUpdate) {
  return {
    functionName: 'update_bog_payment_status' as const,
    args: {
      p_payment_id: input.paymentId,
      p_status: input.status,
      p_transaction_id: input.transactionId,
      p_metadata: input.metadata,
    },
  }
}

export type BogProductionDependencies = {
  environment: Environment
  authenticateUser(accessToken: string): Promise<{ id: string } | null>
  createOrder(input: {
    credentials: BogCredentials
    idempotencyKey: string
    merchantPaymentId: string
    deviceSlots: 1 | 2
    amount: 99 | 179
    callbackUrl: string
    successUrl: string
    failUrl: string
  }): Promise<{ paymentId: string; paymentUrl: string }>
  insertTransaction(transaction: NewPaymentTransaction): Promise<void>
  getTransactionById(
    paymentId: string,
    userId?: string,
  ): Promise<PaymentTransaction | null>
  getTransactionByMerchantId(
    merchantPaymentId: string,
    userId: string,
  ): Promise<PaymentTransaction | null>
  getOrderDetails(paymentId: string): Promise<BogOrderDetails>
  updatePaymentStatus(input: {
    paymentId: string
    status: PersistedBogPaymentStatus
    transactionId: string | null
    metadata: Record<string, string | null>
  }): Promise<void>
  verifyCallbackSignature(rawBody: string, signature: string | null): Promise<boolean>
}

function createDefaultDependencies(): BogProductionDependencies {
  const environment = process.env
  const supabaseUrl = environment.SUPABASE_URL ?? ''
  const anonKey = environment.SUPABASE_ANON_KEY ?? ''
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const clientKey = environment.BOG_CLIENT_KEY ?? ''
  const secretKey = environment.BOG_SECRET_KEY ?? ''
  const credentials = { clientKey, secretKey }
  const authClient = supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey) : null
  const admin = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null

  return {
    environment,
    async authenticateUser(accessToken) {
      if (!authClient) return null
      const { data, error } = await authClient.auth.getUser(accessToken)
      if (error || !data.user) return null
      return { id: data.user.id }
    },
    createOrder(input) {
      return createBogOrder(input, fetch, BOG_PRODUCTION_CONFIGURATION)
    },
    async insertTransaction(transaction) {
      if (!admin) throw new Error('Supabase service configuration is missing')
      const { error } = await admin.from('payment_transactions').insert(transaction)
      if (!error) return
      if (error.code !== '23505') throw error

      const { data: existing, error: lookupError } = await admin
        .from('payment_transactions')
        .select('payment_id, merchant_payment_id, user_id, amount, currency, status, metadata')
        .eq('provider', 'bog')
        .eq('user_id', transaction.user_id)
        .eq('idempotency_key', transaction.idempotency_key)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (
        !existing ||
        existing.payment_id !== transaction.payment_id ||
        existing.merchant_payment_id !== transaction.merchant_payment_id ||
        Number(existing.amount) !== transaction.amount ||
        existing.currency !== transaction.currency ||
        existing.metadata?.device_slots !== transaction.metadata.device_slots
      ) {
        throw new Error('Payment idempotency key conflicts with another order')
      }
    },
    async getTransactionById(paymentId, userId) {
      if (!admin) throw new Error('Supabase service configuration is missing')
      let query = admin.from('payment_transactions')
        .select('payment_id, merchant_payment_id, user_id, amount, currency, status')
        .eq('provider', 'bog')
        .eq('payment_id', paymentId)
      if (userId) query = query.eq('user_id', userId)
      const { data, error } = await query.maybeSingle()
      if (error) throw error
      return data
    },
    async getTransactionByMerchantId(merchantPaymentId, userId) {
      if (!admin) throw new Error('Supabase service configuration is missing')
      const { data, error } = await admin.from('payment_transactions')
        .select('payment_id, merchant_payment_id, user_id, amount, currency, status')
        .eq('provider', 'bog')
        .eq('merchant_payment_id', merchantPaymentId)
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      return data
    },
    async getOrderDetails(paymentId) {
      return getBogOrderDetails(credentials, paymentId, fetch, BOG_PRODUCTION_CONFIGURATION)
    },
    async updatePaymentStatus(input) {
      if (!admin) throw new Error('Supabase service configuration is missing')
      const rpcCall = buildBogPaymentStatusRpcCall(input)
      const { error } = await admin.rpc(rpcCall.functionName, rpcCall.args)
      if (error) throw error
    },
    verifyCallbackSignature(rawBody, signature) {
      return verifyBogCallbackSignature(rawBody, signature, BOG_PRODUCTION_CALLBACK_PUBLIC_KEY)
    },
  }
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function getProductionConfiguration(
  request: Request,
  dependencies: BogProductionDependencies,
  requireBrowserOrigin: boolean,
): { appUrl: URL; credentials: BogCredentials } | Response {
  const environment = dependencies.environment
  if (environment.VERCEL_ENV !== 'production') {
    return jsonResponse({ error: 'Live payments are available only in Production' }, 404)
  }
  if (
    !environment.SUPABASE_URL ||
    !environment.SUPABASE_ANON_KEY ||
    !environment.SUPABASE_SERVICE_ROLE_KEY ||
    !environment.BOG_CLIENT_KEY ||
    !environment.BOG_SECRET_KEY ||
    !environment.PRODUCTION_APP_URL
  ) {
    return jsonResponse({ error: 'Production BOG payments are not configured' }, 503)
  }

  try {
    const appUrl = new URL(environment.PRODUCTION_APP_URL)
    const supabaseUrl = new URL(environment.SUPABASE_URL)
    const origin = request.headers.get('origin')
    if (
      appUrl.protocol !== 'https:' ||
      supabaseUrl.protocol !== 'https:' ||
      !PRODUCTION_HOSTS.has(appUrl.hostname) ||
      (requireBrowserOrigin && origin !== appUrl.origin)
    ) {
      return jsonResponse({ error: 'Production payment origin is invalid' }, 403)
    }
    return {
      appUrl,
      credentials: {
        clientKey: environment.BOG_CLIENT_KEY,
        secretKey: environment.BOG_SECRET_KEY,
      },
    }
  } catch {
    return jsonResponse({ error: 'Production payment configuration is invalid' }, 503)
  }
}

async function authenticate(
  request: Request,
  dependencies: BogProductionDependencies,
): Promise<{ id: string } | Response> {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!match) return jsonResponse({ error: 'Authentication is required' }, 401)

  const user = await dependencies.authenticateUser(match[1])
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)
  return user
}

function isResponse(value: object): value is Response {
  return value instanceof Response
}

export async function handleBogProductionInitialize(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const configuration = getProductionConfiguration(request, dependencies, true)
  if (isResponse(configuration)) return configuration

  try {
    const user = await authenticate(request, dependencies)
    if (isResponse(user)) return user

    let body: { provider?: unknown; deviceSlots?: unknown; requestId?: unknown }
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body' }, 400)
    }
    if (
      body.provider !== 'bog' ||
      (body.deviceSlots !== 1 && body.deviceSlots !== 2) ||
      typeof body.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
    ) {
      return jsonResponse({ error: 'Invalid payment request' }, 400)
    }

    const deviceSlots = body.deviceSlots
    const amount = DEVICE_SLOT_AMOUNTS[deviceSlots]
    const idempotencyKey = await createBogIdempotencyKey(user.id, body.requestId)
    const merchantPaymentId = `cr-${idempotencyKey}`
    const successUrl = new URL('/payment/return', configuration.appUrl)
    successUrl.searchParams.set('provider', 'bog-production')
    successUrl.searchParams.set('merchantPaymentId', merchantPaymentId)
    const failUrl = new URL(successUrl)
    failUrl.searchParams.set('checkout', 'not-completed')

    const payment = await dependencies.createOrder({
      credentials: configuration.credentials,
      idempotencyKey,
      merchantPaymentId,
      deviceSlots,
      amount,
      callbackUrl: new URL('/api/payments/bog/callback', configuration.appUrl).toString(),
      successUrl: successUrl.toString(),
      failUrl: failUrl.toString(),
    })

    await dependencies.insertTransaction({
      user_id: user.id,
      provider: 'bog',
      payment_id: payment.paymentId,
      merchant_payment_id: merchantPaymentId,
      idempotency_key: idempotencyKey,
      amount,
      currency: 'GEL',
      status: 'pending',
      metadata: { provider: 'bog', device_slots: deviceSlots },
    })
    return jsonResponse({ success: true, paymentUrl: payment.paymentUrl, amount }, 200)
  } catch (error) {
    console.error('Production BOG initialization failed:', safeErrorMessage(error))
    return jsonResponse({ error: 'Payment could not be started; try again later' }, 500)
  }
}

export async function handleBogProductionVerify(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  const configuration = getProductionConfiguration(request, dependencies, false)
  if (isResponse(configuration)) return configuration

  try {
    const user = await authenticate(request, dependencies)
    if (isResponse(user)) return user

    const url = new URL(request.url)
    if (url.searchParams.get('provider') !== 'bog') {
      return jsonResponse({ error: 'Invalid payment provider' }, 400)
    }
    const paymentId = url.searchParams.get('paymentId')
    const merchantPaymentId = url.searchParams.get('merchantPaymentId')
    if ((!paymentId && !merchantPaymentId) || (paymentId && merchantPaymentId)) {
      return jsonResponse({ error: 'Exactly one payment identifier is required' }, 400)
    }

    const transaction = paymentId
      ? await dependencies.getTransactionById(paymentId, user.id)
      : await dependencies.getTransactionByMerchantId(merchantPaymentId!, user.id)
    if (!transaction?.merchant_payment_id) {
      return jsonResponse({ error: 'Payment transaction was not found' }, 404)
    }
    const verified = await verifyStoredOrder(transaction, dependencies)
    const status = toPersistedBogPaymentStatus(verified.status)
    const shouldApply = canApplyStatusTransition(transaction.status, status)
    let currentStatus = transaction.status
    if (shouldApply) {
      await dependencies.updatePaymentStatus({
        paymentId: transaction.payment_id,
        status,
        transactionId: verified.transactionId,
        metadata: verifiedMetadata(verified, 'verified_at'),
      })
      const updated = await dependencies.getTransactionById(transaction.payment_id, user.id)
      if (!updated) throw new Error('Payment transaction disappeared after verification')
      currentStatus = updated.status
    }
    return jsonResponse({
      status: currentStatus,
      sandbox: false,
      bankStatus: verified.bankStatus,
      transactionId: verified.transactionId,
    }, 200)
  } catch (error) {
    console.error('Production BOG verification failed:', safeErrorMessage(error))
    return jsonResponse({ error: 'Payment verification failed' }, 500)
  }
}

export async function handleBogProductionCallback(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const configuration = getProductionConfiguration(request, dependencies, false)
  if (isResponse(configuration)) return configuration

  try {
    const rawBody = await request.text()
    if (!await dependencies.verifyCallbackSignature(rawBody, request.headers.get('callback-signature'))) {
      return jsonResponse({ error: 'Invalid BOG callback signature' }, 401)
    }
    let callback: { event?: unknown; body?: { order_id?: unknown } }
    try {
      callback = JSON.parse(rawBody)
    } catch {
      return jsonResponse({ error: 'Invalid BOG callback body' }, 400)
    }
    if (callback.event !== 'order_payment' || typeof callback.body?.order_id !== 'string') {
      return jsonResponse({ error: 'Invalid BOG callback body' }, 400)
    }

    const transaction = await dependencies.getTransactionById(callback.body.order_id)
    if (!transaction?.merchant_payment_id) {
      return jsonResponse({ error: 'BOG payment transaction was not found' }, 404)
    }
    const verified = await verifyStoredOrder(transaction, dependencies)
    const status = toPersistedBogPaymentStatus(verified.status)
    if (!canApplyStatusTransition(transaction.status, status)) {
      return jsonResponse({ success: true, duplicateOrStale: true }, 200)
    }
    await dependencies.updatePaymentStatus({
      paymentId: transaction.payment_id,
      status,
      transactionId: verified.transactionId,
      metadata: verifiedMetadata(verified, 'callback_verified_at'),
    })
    return jsonResponse({ success: true }, 200)
  } catch (error) {
    console.error('Production BOG callback failed:', safeErrorMessage(error))
    return jsonResponse({ error: 'BOG callback could not be processed' }, 500)
  }
}

function canApplyStatusTransition(current: string, next: PersistedBogPaymentStatus): boolean {
  if (
    (current === 'pending' || current === 'processing') &&
    (next === 'refunded' || next === 'refunded_partially')
  ) {
    return false
  }
  try {
    return canApplyBogPaymentStatus(current, next)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Invalid BOG payment status transition:')
    ) {
      return false
    }
    throw error
  }
}

async function verifyStoredOrder(
  transaction: PaymentTransaction,
  dependencies: BogProductionDependencies,
) {
  const details = await dependencies.getOrderDetails(transaction.payment_id)
  return verifyBogOrderDetails(details, {
    orderId: transaction.payment_id,
    externalOrderId: transaction.merchant_payment_id!,
    amount: Number(transaction.amount),
    currency: transaction.currency,
  })
}

function verifiedMetadata(
  verified: ReturnType<typeof verifyBogOrderDetails>,
  verifiedAtKey: 'verified_at' | 'callback_verified_at',
) {
  return {
    bank_status: verified.bankStatus,
    bank_amount: verified.amount,
    bank_refund_amount: verified.refundAmount,
    bank_currency: verified.currency,
    bank_external_order_id: verified.externalOrderId,
    [verifiedAtKey]: new Date().toISOString(),
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
