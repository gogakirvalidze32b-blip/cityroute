import { createClient } from '@supabase/supabase-js'
import {
  BOG_PRODUCTION_CONFIGURATION,
  canApplyBogStatus,
  createBogIdempotencyKey,
  createBogOrder,
  getBogOrderDetails,
  verifyBogCallbackSignature,
  verifyBogOrderDetails,
  type BogCredentials,
  type BogStatus,
} from './bog-payment.ts'

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

type StatusUpdate = {
  paymentId: string
  status: BogStatus
  transactionId: string | null
  metadata: Record<string, string | null>
}

type Dependencies = {
  environment: Environment
  authenticateUser(token: string): Promise<{ id: string } | null>
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
  getTransactionById(paymentId: string, userId?: string): Promise<PaymentTransaction | null>
  getTransactionByMerchantId(merchantPaymentId: string, userId: string): Promise<PaymentTransaction | null>
  getOrderDetails(paymentId: string): ReturnType<typeof getBogOrderDetails>
  updatePaymentStatus(input: StatusUpdate): Promise<void>
  verifyCallbackSignature(rawBody: string, signature: string | null): Promise<boolean>
}

function createDefaultDependencies(): Dependencies {
  const environment = process.env
  const supabaseUrl = environment.SUPABASE_URL ?? ''
  const anonKey = environment.SUPABASE_ANON_KEY ?? ''
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const credentials = {
    clientKey: environment.BOG_CLIENT_KEY ?? '',
    secretKey: environment.BOG_SECRET_KEY ?? '',
  }
  const authClient = supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey) : null
  const admin = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    : null

  return {
    environment,
    async authenticateUser(token) {
      if (!authClient) return null
      const { data, error } = await authClient.auth.getUser(token)
      if (error || !data.user) return null
      return { id: data.user.id }
    },
    createOrder: (input) => createBogOrder(input),
    async insertTransaction(transaction) {
      if (!admin) throw new Error('Supabase service configuration is missing')
      const { error } = await admin.from('payment_transactions').insert(transaction)
      if (!error) return
      if (error.code !== '23505') throw error

      const { data: existing, error: lookupError } = await admin
        .from('payment_transactions')
        .select('payment_id, merchant_payment_id, amount, currency, metadata')
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
    getOrderDetails: (paymentId) => getBogOrderDetails(credentials, paymentId),
    async updatePaymentStatus(input) {
      if (!admin) throw new Error('Supabase service configuration is missing')
      const { error } = await admin.rpc('update_bog_payment_status', {
        p_payment_id: input.paymentId,
        p_status: input.status,
        p_transaction_id: input.transactionId,
        p_metadata: input.metadata,
      })
      if (error) throw error
    },
    verifyCallbackSignature: verifyBogCallbackSignature,
  }
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

function configuration(
  request: Request,
  dependencies: Dependencies,
  requireOrigin: boolean,
): { appUrl: URL; credentials: BogCredentials } | Response {
  const env = dependencies.environment
  if (env.VERCEL_ENV !== 'production') {
    return jsonResponse({ error: 'BOG Live payments are available only in Production' }, 404)
  }
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.BOG_CLIENT_KEY ||
    !env.BOG_SECRET_KEY ||
    !env.PRODUCTION_APP_URL
  ) {
    return jsonResponse({ error: 'Production BOG payments are not configured' }, 503)
  }
  try {
    const appUrl = new URL(env.PRODUCTION_APP_URL)
    const supabaseUrl = new URL(env.SUPABASE_URL)
    const origin = request.headers.get('origin')
    if (
      appUrl.protocol !== 'https:' ||
      supabaseUrl.protocol !== 'https:' ||
      !PRODUCTION_HOSTS.has(appUrl.hostname) ||
      (requireOrigin && origin !== appUrl.origin)
    ) {
      return jsonResponse({ error: 'Production payment origin is invalid' }, 403)
    }
    return {
      appUrl,
      credentials: { clientKey: env.BOG_CLIENT_KEY, secretKey: env.BOG_SECRET_KEY },
    }
  } catch {
    return jsonResponse({ error: 'Production payment configuration is invalid' }, 503)
  }
}

function response(value: object): value is Response {
  return value instanceof Response
}

async function authenticate(
  request: Request,
  dependencies: Dependencies,
): Promise<{ id: string } | Response> {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  if (!match) return jsonResponse({ error: 'Authentication is required' }, 401)
  const user = await dependencies.authenticateUser(match[1])
  return user ?? jsonResponse({ error: 'Unauthorized' }, 401)
}

export async function handleBogInitialize(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const config = configuration(request, dependencies, true)
  if (response(config)) return config

  try {
    const user = await authenticate(request, dependencies)
    if (response(user)) return user
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
    const returnUrl = new URL('/payment/return', config.appUrl)
    returnUrl.searchParams.set('provider', 'bog-production')
    returnUrl.searchParams.set('merchantPaymentId', merchantPaymentId)
    const failUrl = new URL(returnUrl)
    failUrl.searchParams.set('checkout', 'not-completed')
    const payment = await dependencies.createOrder({
      credentials: config.credentials,
      idempotencyKey,
      merchantPaymentId,
      deviceSlots,
      amount,
      callbackUrl: new URL('/api/payments/bog/callback', config.appUrl).toString(),
      successUrl: returnUrl.toString(),
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

export async function handleBogVerify(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  const config = configuration(request, dependencies, false)
  if (response(config)) return config
  try {
    const user = await authenticate(request, dependencies)
    if (response(user)) return user
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
    const shouldApply = canApplyBogStatus(transaction.status, verified.status)
    let currentStatus = transaction.status
    if (shouldApply) {
      await dependencies.updatePaymentStatus({
        paymentId: transaction.payment_id,
        status: verified.status,
        transactionId: verified.transactionId,
        metadata: verifiedMetadata(verified),
      })
      const updated = await dependencies.getTransactionById(transaction.payment_id, user.id)
      if (!updated) throw new Error('Payment transaction disappeared after verification')
      currentStatus = updated.status
    }
    return jsonResponse({
      status: currentStatus,
      bankStatus: verified.bankStatus,
      transactionId: verified.transactionId,
    }, 200)
  } catch (error) {
    console.error('Production BOG verification failed:', safeErrorMessage(error))
    return jsonResponse({ error: 'Payment verification failed' }, 500)
  }
}

export async function handleBogCallback(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const config = configuration(request, dependencies, false)
  if (response(config)) return config
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
    if (!canApplyBogStatus(transaction.status, verified.status)) {
      return jsonResponse({ success: true, duplicateOrStale: true }, 200)
    }
    await dependencies.updatePaymentStatus({
      paymentId: transaction.payment_id,
      status: verified.status,
      transactionId: verified.transactionId,
      metadata: verifiedMetadata(verified),
    })
    return jsonResponse({ success: true }, 200)
  } catch (error) {
    console.error('Production BOG callback failed:', safeErrorMessage(error))
    return jsonResponse({ error: 'BOG callback could not be processed' }, 500)
  }
}

async function verifyStoredOrder(
  transaction: PaymentTransaction,
  dependencies: Dependencies,
) {
  const order = await dependencies.getOrderDetails(transaction.payment_id)
  return verifyBogOrderDetails(order, {
    paymentId: transaction.payment_id,
    merchantPaymentId: transaction.merchant_payment_id!,
    amount: Number(transaction.amount),
    currency: transaction.currency,
  })
}

function verifiedMetadata(verified: Awaited<ReturnType<typeof verifyStoredOrder>>) {
  return {
    bank_status: verified.bankStatus,
    bank_amount: verified.amount,
    bank_refund_amount: verified.refundAmount,
    bank_currency: verified.currency,
    bank_external_order_id: verified.externalOrderId,
    verified_at: new Date().toISOString(),
  }
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}
