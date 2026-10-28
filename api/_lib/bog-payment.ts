export const BOG_PRODUCTION_CONFIGURATION = {
  tokenUrl: 'https://oauth2.bog.ge/auth/realms/bog/protocol/openid-connect/token',
  apiUrl: 'https://api.bog.ge',
  checkoutHost: 'payment.bog.ge',
} as const

export const BOG_PRODUCTION_CALLBACK_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4RUyAw3+CdkS3ZNILQh
zHI9Hemo+vKB9U2BSabppkKjzjjkf+0Sm76hSMiu/HFtYhqWOESryoCDJoqffY0Q
1VNt25aTxbj068QNUtnxQ7KQVLA+pG0smf+EBWlS1vBEAFbIas9d8c9b9sSEkTrr
TYQ90WIM8bGB6S/KLVoT1a7SnzabjoLc5Qf/SLDG5fu8dH8zckyeYKdRKSBJKvhx
tcBuHV4f7qsynQT+f2UYbESX/TLHwT5qFWZDHZ0YUOUIvb8n7JujVSGZO9/+ll/g
4ZIWhC1MlJgPObDwRkRd8NFOopgxMcMsDIZIoLbWKhHVq67hdbwpAq9K9WMmEhPn
PwIDAQAB
-----END PUBLIC KEY-----`

export type BogCredentials = {
  clientKey: string
  secretKey: string
}

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

export type BogStatus =
  | 'pending'
  | 'processing'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'refunded_partially'

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

async function getBogAccessToken(credentials: BogCredentials): Promise<string> {
  const response = await fetch(BOG_PRODUCTION_CONFIGURATION.tokenUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${credentials.clientKey}:${credentials.secretKey}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    const body =
      typeof payload === 'object' && payload !== null && !Array.isArray(payload)
        ? payload
        : null
    const knownCodes = new Set([
      'invalid_request',
      'invalid_client',
      'invalid_grant',
      'unauthorized_client',
      'unsupported_grant_type',
      'invalid_scope',
      'server_error',
      'temporarily_unavailable',
    ])
    const code =
      body && 'error' in body && typeof body.error === 'string' && knownCodes.has(body.error)
        ? body.error
        : 'unrecognized'
    const description =
      body && 'error_description' in body && typeof body.error_description === 'string'
        ? body.error_description
        : ''
    let descriptionCategory = 'unclassified'
    if (/invalid[_ -]?client|client.{0,40}(invalid|failed|rejected)/i.test(description)) {
      descriptionCategory = 'client authentication rejected'
    } else if (/unsupported[_ -]?grant[_ -]?type/i.test(description)) {
      descriptionCategory = 'grant type rejected'
    } else if (/invalid[_ -]?request|malformed|missing.{0,40}grant[_ -]?type/i.test(description)) {
      descriptionCategory = 'request format rejected'
    }
    throw new Error(
      `BOG authentication failed (${response.status}; oauth_error=${code}; description=${descriptionCategory})`,
    )
  }
  const result: { access_token?: unknown } = await response.json()
  if (typeof result.access_token !== 'string' || !result.access_token) {
    throw new Error('BOG returned no access token')
  }
  return result.access_token
}

export async function createBogOrder(input: {
  credentials: BogCredentials
  idempotencyKey: string
  merchantPaymentId: string
  deviceSlots: 1 | 2
  amount: 99 | 179
  callbackUrl: string
  successUrl: string
  failUrl: string
}): Promise<{ paymentId: string; paymentUrl: string }> {
  const token = await getBogAccessToken(input.credentials)
  const response = await fetch(`${BOG_PRODUCTION_CONFIGURATION.apiUrl}/payments/v1/ecommerce/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
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
          description: `CityRoute Premium ? ${input.deviceSlots} ???????, 30 ???`,
          total_price: input.amount,
        }],
      },
      redirect_urls: { success: input.successUrl, fail: input.failUrl },
    }),
  })
  if (!response.ok) throw new Error(`BOG order creation failed (${response.status})`)

  const result: { id?: unknown; _links?: { redirect?: { href?: unknown } } } = await response.json()
  const paymentId = typeof result.id === 'string' ? result.id : ''
  const paymentUrl = typeof result._links?.redirect?.href === 'string'
    ? result._links.redirect.href
    : ''
  if (!paymentId || !isBogPaymentUrl(paymentUrl)) {
    throw new Error('BOG returned an invalid order or checkout URL')
  }
  return { paymentId, paymentUrl }
}

export async function getBogOrderDetails(
  credentials: BogCredentials,
  paymentId: string,
): Promise<BogOrderDetails> {
  const token = await getBogAccessToken(credentials)
  const response = await fetch(
    `${BOG_PRODUCTION_CONFIGURATION.apiUrl}/payments/v1/receipt/${encodeURIComponent(paymentId)}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
  )
  if (!response.ok) throw new Error(`BOG receipt lookup failed (${response.status})`)
  return response.json()
}

export function isBogPaymentUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === BOG_PRODUCTION_CONFIGURATION.checkoutHost
  } catch {
    return false
  }
}

export async function verifyBogCallbackSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false
  try {
    const keyBytes = decodeBase64(
      BOG_PRODUCTION_CALLBACK_PUBLIC_KEY.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
    )
    const signatureBytes = decodeBase64(signature)
    const key = await crypto.subtle.importKey(
      'spki',
      keyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    return crypto.subtle.verify(
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
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

export function verifyBogOrderDetails(
  order: BogOrderDetails,
  expected: {
    paymentId: string
    merchantPaymentId: string
    amount: number
    currency: string
  },
) {
  if (order.order_id !== expected.paymentId) throw new Error('BOG order ID mismatch')
  if (order.external_order_id !== expected.merchantPaymentId) {
    throw new Error('BOG merchant order ID mismatch')
  }
  const amountValue = order.purchase_units?.request_amount
  const amount = typeof amountValue === 'number' || typeof amountValue === 'string'
    ? String(amountValue)
    : ''
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) !== expected.amount) {
    throw new Error('BOG receipt amount mismatch')
  }
  const currency = order.purchase_units?.currency_code
  if (currency !== expected.currency) throw new Error('BOG receipt currency mismatch')
  const bankStatus = order.order_status?.key
  if (typeof bankStatus !== 'string') throw new Error('BOG receipt status is missing')
  const status = mapBogStatus(bankStatus)
  if (!status) throw new Error('BOG returned an unsupported order status')

  const refundValue = order.purchase_units?.refund_amount
  const refundAmount = typeof refundValue === 'number' || typeof refundValue === 'string'
    ? String(refundValue)
    : null
  if (refundAmount !== null && (!Number.isFinite(Number(refundAmount)) || Number(refundAmount) < 0)) {
    throw new Error('BOG receipt refund amount is invalid')
  }
  if (bankStatus === 'refunded' && Number(refundAmount) !== expected.amount) {
    throw new Error('BOG full refund amount mismatch')
  }
  if (
    bankStatus === 'refunded_partially' &&
    (refundAmount === null || Number(refundAmount) <= 0 || Number(refundAmount) >= expected.amount)
  ) {
    throw new Error('BOG partial refund amount is invalid')
  }
  return {
    status,
    bankStatus,
    amount,
    currency,
    refundAmount,
    externalOrderId: expected.merchantPaymentId,
    transactionId: typeof order.payment_detail?.transaction_id === 'string'
      ? order.payment_detail.transaction_id
      : null,
  }
}

export function mapBogStatus(status: string): BogStatus | null {
  switch (status) {
    case 'completed': return 'success'
    case 'rejected': return 'failed'
    case 'cancelled':
    case 'canceled': return 'cancelled'
    case 'refunded': return 'refunded'
    case 'refunded_partially': return 'refunded_partially'
    case 'created': return 'pending'
    case 'processing':
    case 'auth_requested':
    case 'blocked':
    case 'partial_completed':
    case 'refund_requested': return 'processing'
    default: return null
  }
}

export function canApplyBogStatus(current: string, next: BogStatus): boolean {
  if (current === next) return next === 'refunded_partially'
  if (current === 'pending') return ['processing', 'success', 'failed', 'cancelled'].includes(next)
  if (current === 'processing') return ['success', 'failed', 'cancelled'].includes(next)
  if (current === 'success') return ['refunded', 'refunded_partially'].includes(next)
  if (current === 'refunded_partially') return next === 'refunded'
  if (['failed', 'cancelled', 'refunded'].includes(current)) return false
  throw new Error('Stored BOG payment status is invalid')
}
