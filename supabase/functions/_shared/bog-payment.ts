export const BOG_SANDBOX_TOKEN_URL =
  'https://oauth2-sandbox.bog.ge/auth/realms/bog/protocol/openid-connect/token'
export const BOG_SANDBOX_API_URL = 'https://api-sandbox.bog.ge'
export const BOG_SANDBOX_CHECKOUT_HOST = 'payment-sandbox.bog.ge'
const PRODUCTION_SUPABASE_PROJECT_REF = 'tuylbbdhvfcobxynwtnt'

export function isProductionSupabaseProject(url: string | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).hostname === `${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`
  } catch {
    return false
  }
}

export const BOG_SANDBOX_CALLBACK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqczfAuhtxw2iF68kS0Hy
bGSv0ZlDAjsXh6VC8avDl3Vxa9qCn6Pzl37Tl2Z21WodiISLeXdhCtOMTeLNUBeb
CYD31y2/MwnhLYqlCk2bOh29fyPc1iT5Eu/k/1IaNRrK9/UVZaTkhOMeEm+aL4y8
5XsE4UjqftEmwrAdbO2G4cCpuoMC9ZXG9gAdr2BFN6i2Vt9eCen5Poj7E1ik7s8T
GyzploVV0NflhwBGeWnvQANUQGr87gsP5k2JG1z5EwnMybJQ7i3XT726rJMaV6QW
sY5hP72Mtv1I1zL2d9FXm9FWOzbpcXCyxuEBXvqqOHzogri8C7KRRYKyk97Ri7D6
8wIDAQAB
-----END PUBLIC KEY-----`

export type BogCredentials = {
  clientKey: string
  secretKey: string
}

export type BogPaymentStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'refunded_partially'
  | 'unknown'

export type PersistedBogPaymentStatus = Exclude<BogPaymentStatus, 'unknown'>

export type BogOrderDetails = {
  order_id?: unknown
  external_order_id?: unknown
  order_status?: { key?: unknown }
  purchase_units?: {
    request_amount?: unknown
    refund_amount?: unknown
    currency_code?: unknown
  }
  payment_detail?: { transaction_id?: unknown }
}

export type ExpectedBogOrder = {
  orderId: string
  externalOrderId: string
  amount: number
  currency: string
}

export type VerifiedBogOrder = {
  status: BogPaymentStatus
  transactionId: string | null
  bankStatus: string
  amount: string
  refundAmount: string | null
  currency: string
  externalOrderId: string
}

export async function getBogAccessToken(
  credentials: BogCredentials,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(BOG_SANDBOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${credentials.clientKey}:${credentials.secretKey}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })

  if (!response.ok) {
    throw new Error(`BOG sandbox authentication failed (${response.status})`)
  }

  const result: { access_token?: unknown } = await response.json()
  if (typeof result.access_token !== 'string' || !result.access_token) {
    throw new Error('BOG sandbox returned no access token')
  }
  return result.access_token
}

export async function createBogIdempotencyKey(userId: string, requestId: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${userId}:${requestId}`),
  )).slice(0, 16)
  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function createBogOrder(
  input: {
    credentials: BogCredentials
    idempotencyKey: string
    merchantPaymentId: string
    deviceSlots: 1 | 2
    amount: 99 | 179
    callbackUrl: string
    successUrl: string
    failUrl: string
  },
  fetcher: typeof fetch = fetch,
): Promise<{ paymentId: string; paymentUrl: string }> {
  const accessToken = await getBogAccessToken(input.credentials, fetcher)
  const description = `CityRoute Premium — ${input.deviceSlots} მანქანა, 30 დღე`
  const response = await fetcher(`${BOG_SANDBOX_API_URL}/payments/v1/ecommerce/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'ka',
      'Idempotency-Key': input.idempotencyKey,
    },
    body: JSON.stringify({
      callback_url: input.callbackUrl,
      external_order_id: input.merchantPaymentId,
      purchase_units: {
        currency: 'GEL',
        total_amount: input.amount,
        basket: [{
          quantity: 1,
          unit_price: input.amount,
          product_id: `cityroute-premium-${input.deviceSlots}`,
          description,
          total_price: input.amount,
        }],
      },
      redirect_urls: {
        success: input.successUrl,
        fail: input.failUrl,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`BOG sandbox order creation failed (${response.status})`)
  }

  const result: {
    id?: unknown
    _links?: { redirect?: { href?: unknown } }
  } = await response.json()
  const paymentId = typeof result.id === 'string' ? result.id : ''
  const paymentUrl = typeof result._links?.redirect?.href === 'string'
    ? result._links.redirect.href
    : ''

  if (!paymentId || !isBogSandboxPaymentUrl(paymentUrl)) {
    throw new Error('BOG sandbox returned an invalid order or checkout URL')
  }
  return { paymentId, paymentUrl }
}

export async function getBogOrderDetails(
  credentials: BogCredentials,
  orderId: string,
  fetcher: typeof fetch = fetch,
): Promise<BogOrderDetails> {
  const accessToken = await getBogAccessToken(credentials, fetcher)
  const response = await fetcher(
    `${BOG_SANDBOX_API_URL}/payments/v1/receipt/${encodeURIComponent(orderId)}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
  )
  if (!response.ok) {
    throw new Error(`BOG sandbox order lookup failed (${response.status})`)
  }
  return await response.json()
}

export function isBogSandboxPaymentUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === BOG_SANDBOX_CHECKOUT_HOST
  } catch {
    return false
  }
}

export function verifyBogCallbackSignature(
  rawBody: string,
  signature: string | null,
  publicKeyPem = BOG_SANDBOX_CALLBACK_PUBLIC_KEY,
): Promise<boolean> {
  if (!signature) return Promise.resolve(false)
  return verifyRsaSha256(rawBody, signature, publicKeyPem)
}

async function verifyRsaSha256(
  rawBody: string,
  signature: string,
  publicKeyPem: string,
): Promise<boolean> {
  try {
    const keyBytes = decodeBase64(publicKeyPem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''))
    const signatureBytes = decodeBase64(signature)
    const key = await crypto.subtle.importKey(
      'spki',
      keyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    return await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      signatureBytes,
      new TextEncoder().encode(rawBody),
    )
  } catch {
    return false
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function verifyBogOrderDetails(
  order: BogOrderDetails,
  expected: ExpectedBogOrder,
): VerifiedBogOrder {
  if (order.order_id !== expected.orderId) {
    throw new Error('BOG order ID does not match the stored transaction')
  }
  if (order.external_order_id !== expected.externalOrderId) {
    throw new Error('BOG external order ID does not match the stored transaction')
  }

  const bankAmount = order.purchase_units?.request_amount
  const amount = typeof bankAmount === 'number' || typeof bankAmount === 'string'
    ? String(bankAmount)
    : ''
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) !== expected.amount) {
    throw new Error('BOG order amount does not match the stored transaction')
  }

  const currency = order.purchase_units?.currency_code
  if (currency !== expected.currency) {
    throw new Error('BOG order currency does not match the stored transaction')
  }

  const bankStatus = order.order_status?.key
  if (typeof bankStatus !== 'string') {
    throw new Error('BOG returned an invalid order status')
  }
  const status = mapBogPaymentStatus(bankStatus)
  if (status === 'unknown') {
    throw new Error('BOG returned an unsupported order status')
  }

  const bankRefundAmount = order.purchase_units?.refund_amount
  const refundAmount = typeof bankRefundAmount === 'number' || typeof bankRefundAmount === 'string'
    ? String(bankRefundAmount)
    : null
  if (refundAmount !== null && (!Number.isFinite(Number(refundAmount)) || Number(refundAmount) < 0)) {
    throw new Error('BOG returned an invalid refund amount')
  }
  if (bankStatus === 'refunded' && Number(refundAmount) !== expected.amount) {
    throw new Error('BOG full refund amount does not match the order amount')
  }
  if (
    bankStatus === 'refunded_partially' &&
    (refundAmount === null || Number(refundAmount) <= 0 || Number(refundAmount) >= expected.amount)
  ) {
    throw new Error('BOG partial refund amount is invalid')
  }

  return {
    status,
    transactionId: typeof order.payment_detail?.transaction_id === 'string'
      ? order.payment_detail.transaction_id
      : null,
    bankStatus,
    amount,
    refundAmount,
    currency,
    externalOrderId: expected.externalOrderId,
  }
}

export function mapBogPaymentStatus(status: string): BogPaymentStatus {
  switch (status) {
    case 'completed':
      return 'success'
    case 'rejected':
      return 'failed'
    case 'refunded':
      return 'refunded'
    case 'refunded_partially':
      return 'refunded_partially'
    case 'created':
      return 'pending'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    case 'processing':
    case 'auth_requested':
    case 'blocked':
    case 'partial_completed':
    case 'refund_requested':
      return 'processing'
    default:
      return 'unknown'
  }
}

export function toPersistedBogPaymentStatus(
  status: BogPaymentStatus,
): PersistedBogPaymentStatus {
  if (status === 'unknown') {
    throw new Error('Cannot persist an unsupported BOG payment status')
  }
  return status
}

export function canApplyBogPaymentStatus(
  currentStatus: string,
  nextStatus: PersistedBogPaymentStatus,
): boolean {
  if (![
    'pending',
    'processing',
    'success',
    'failed',
    'cancelled',
    'refunded',
    'refunded_partially',
  ].includes(currentStatus)) {
    throw new Error('Stored BOG payment status is invalid')
  }
  if (currentStatus === nextStatus) return currentStatus === 'refunded_partially'

  let allowed = false
  switch (currentStatus) {
    case 'pending':
      allowed = true
      break
    case 'processing':
      allowed = nextStatus !== 'pending' && nextStatus !== 'processing'
      break
    case 'success':
      allowed = nextStatus === 'refunded' || nextStatus === 'refunded_partially'
      break
    case 'refunded_partially':
      allowed = nextStatus === 'refunded'
      break
    case 'failed':
    case 'cancelled':
    case 'refunded':
      break
  }
  if (!allowed) {
    return false
  }
  return true
}
