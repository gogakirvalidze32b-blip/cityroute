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
  reject_reason?: unknown
  order_status?: { key?: unknown }
  purchase_units?: {
    request_amount?: unknown
    refund_amount?: unknown
    currency_code?: unknown
  }
  payment_detail?: {
    transaction_id?: unknown
    status?: unknown
    code?: unknown
    code_description?: unknown
    actions?: unknown
  }
  actions?: unknown
}

export type BogDiagnosticFields = {
  stage: string
  outcome?: string
  paymentId?: unknown
  merchantPaymentId?: unknown
  httpStatus?: unknown
  orderStatus?: unknown
  paymentStatus?: unknown
  errorCode?: unknown
  error?: unknown
  databaseOperation?: string
  databaseOutcome?: string
  configPresence?: Record<string, unknown>
  productionEnvironment?: unknown
  rejectReason?: unknown
  paymentDetailCode?: unknown
  paymentDetailCodeDescription?: unknown
  actions?: unknown
  receipt?: unknown
}

const SAFE_CONFIG_NAMES = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_BOG_CONFIRM_KEY',
  'BOG_CLIENT_KEY',
  'BOG_SECRET_KEY',
  'PRODUCTION_APP_URL',
] as const

const DIAGNOSTIC_STAGES = new Set([
  'bog.oauth_token',
  'bog.order_create',
  'bog.receipt',
  'db.package_catalog',
  'db.create_pending_payment',
  'db.checkout_lookup',
  'db.package_lookup',
  'db.transaction_lookup',
  'db.recovery_lease_acquire',
  'db.recovery_lease_release',
  'db.update_payment_status',
  'db.confirmer_readiness',
  'db.checkout_complete',
  'db.checkout_reserve',
  'checkout.recovery_lease_release',
  'checkout.recovery',
  'checkout.ready_settlement',
  'checkout.bank_call',
  'initialize.configuration',
  'initialize.authentication',
  'initialize.request',
  'initialize.confirmer_readiness',
  'initialize.handler',
  'verify.configuration',
  'verify.authentication',
  'verify.request',
  'verify.receipt_validation',
  'verify.handler',
  'callback.configuration',
  'callback.request',
  'callback.signature',
  'callback.payload',
  'callback.transaction_lookup',
  'callback.receipt_validation',
  'callback.handler',
])

const DIAGNOSTIC_OUTCOMES = new Set([
  'success',
  'failure',
  'rejected',
  'missing_token',
  'fallback',
  'not_found',
  'not_acquired',
  'not_released',
  'owner',
  'joined',
  'settled',
  'unchanged',
  'duplicate_or_stale',
  'invalid_method',
])

const DATABASE_OPERATIONS = new Set([
  'device_slot_packages',
  'create_bog_pending_payment',
  'payment_transactions.find_by_idempotency_key',
  'device_slot_packages.select',
  'payment_transactions.find_by_payment_id',
  'payment_transactions.find_by_merchant_payment_id',
  'acquire_bog_checkout_recovery_lease',
  'release_bog_checkout_recovery_lease',
  'update_bog_payment_status',
  'update_bog_payment_status.readiness_probe',
  'checkout_ledger.complete',
  'checkout_ledger.reserve',
])

const DATABASE_OUTCOMES = new Set([
  'success',
  'failure',
  'not_found',
  'fallback',
  'not_acquired',
  'not_released',
  'owner',
  'joined',
])

const BOG_STATUSES = new Set([
  'completed',
  'rejected',
  'cancelled',
  'canceled',
  'refunded',
  'refunded_partially',
  'created',
  'processing',
  'auth_requested',
  'blocked',
  'partial_completed',
  'refund_requested',
])

const PAYMENT_STATUSES = new Set([
  ...BOG_STATUSES,
  'pending',
  'success',
  'failed',
])

const DIAGNOSTIC_ERROR_CODES = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
  '42p01',
  'pgrst205',
  '23505',
  'p0001',
  '42501',
  'pgrst100',
  '42703',
])

const DIAGNOSTIC_PAYMENT_CODES = new Set(['12'])

function allowlistedValue(
  value: unknown,
  allowed: ReadonlySet<string>,
  placeholder: string,
): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' && typeof value !== 'number') return placeholder
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return placeholder
  const text = String(value)
  if (text.length > 64) return placeholder
  const normalized = text.trim().toLowerCase()
  return allowed.has(normalized) ? normalized : placeholder
}

function internalValue(
  value: unknown,
  allowed: ReadonlySet<string>,
): string {
  return typeof value === 'string' && allowed.has(value) ? value : 'unknown'
}

function safeCorrelationId(value: unknown, merchantId = false): string | undefined {
  if (typeof value !== 'string' || value.length > 64) return undefined
  const normalized = value.trim()
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  const pattern = merchantId ? new RegExp(`^cr-${uuid}$`, 'i') : new RegExp(`^${uuid}$`, 'i')
  return pattern.test(normalized) ? normalized : undefined
}

function diagnosticCategory(value: unknown): string | undefined {
  const text = value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : ''
  if (typeof text !== 'string' || !text) return undefined
  if (text.length > 512) return 'other'
  const normalized = text.toLowerCase()
  if (/insufficient.{0,30}fund|fund.{0,30}insufficient/.test(normalized)) return 'insufficient_funds'
  if (/servicing.{0,30}bank|issuer|issuing bank|acquirer/.test(normalized)) return 'servicing_bank_rejection'
  if (/authenticat|3ds|3-d secure/.test(normalized)) return 'authentication'
  if (/limit|restrict|exceed/.test(normalized)) return 'limit_or_restriction'
  if (/expir|timed out|timeout/.test(normalized)) return 'expiration_or_timeout'
  if (/technical|temporar/.test(normalized)) return 'technical'
  if (/unknown/.test(normalized)) return 'unknown'
  if (/receipt.{0,30}(mismatch|invalid)|order.{0,30}mismatch/.test(normalized)) {
    return 'receipt_validation_failure'
  }
  if (/order creation/.test(normalized)) return 'order_creation_failure'
  if (/receipt lookup/.test(normalized)) return 'receipt_lookup_failure'
  if (/permission|forbidden|unauthorized|role/.test(normalized)) return 'authorization_failure'
  if (/not found|does not exist|schema|column/.test(normalized)) return 'schema_or_record_failure'
  if (/oauth|access token/.test(normalized)) return 'oauth_failure'
  if (/configuration/.test(normalized)) return 'configuration_failure'
  return 'other'
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function diagnosticActions(value: unknown): Array<Record<string, string>> | undefined {
  if (value === undefined || value === null) return undefined
  const items = Array.isArray(value) ? value.slice(0, 8) : [value]
  return items.map((item) => {
    const action = objectRecord(item) ?? {}
    const description = diagnosticCategory(action.code_description)
    const result: Record<string, string> = {
      status: allowlistedValue(action.status, PAYMENT_STATUSES, 'UNKNOWN_STATUS') ?? 'UNKNOWN_STATUS',
      code: allowlistedValue(action.code, DIAGNOSTIC_PAYMENT_CODES, 'UNKNOWN_CODE') ?? 'UNKNOWN_CODE',
    }
    if (description) result.code_description = description
    return result
  })
}

export function logBogDiagnostic(fields: BogDiagnosticFields): void {
  try {
    const receipt = objectRecord(fields.receipt)
    const paymentDetail = objectRecord(receipt?.payment_detail)
    const orderStatusValue = fields.receipt === undefined
      ? fields.orderStatus
      : objectRecord(receipt?.order_status)?.key
    const paymentStatusValue = fields.receipt === undefined
      ? fields.paymentStatus
      : paymentDetail?.status
    const merchantPaymentIdValue = fields.receipt === undefined
      ? fields.merchantPaymentId
      : receipt?.external_order_id
    const rejectReasonValue = fields.receipt === undefined
      ? fields.rejectReason
      : receipt?.reject_reason
    const actionsValue = fields.receipt === undefined
      ? fields.actions
      : Array.isArray(receipt?.actions) && receipt.actions.length > 0
        ? receipt.actions
        : paymentDetail?.actions
    const record: Record<string, unknown> = {
      stage: internalValue(fields.stage, DIAGNOSTIC_STAGES),
    }
    const outcome = internalValue(fields.outcome, DIAGNOSTIC_OUTCOMES)
    const paymentId = safeCorrelationId(fields.paymentId)
    const merchantPaymentId = safeCorrelationId(merchantPaymentIdValue, true)
    const orderStatus = allowlistedValue(orderStatusValue, BOG_STATUSES, 'UNKNOWN_STATUS')
    const paymentStatus = allowlistedValue(paymentStatusValue, PAYMENT_STATUSES, 'UNKNOWN_STATUS')
    const errorCode = allowlistedValue(fields.errorCode, DIAGNOSTIC_ERROR_CODES, 'UNKNOWN_CODE')
    const databaseOperation = internalValue(fields.databaseOperation, DATABASE_OPERATIONS)
    const databaseOutcome = internalValue(fields.databaseOutcome, DATABASE_OUTCOMES)

    if (outcome !== 'unknown') record.outcome = outcome
    if (paymentId) record.payment_id = paymentId
    if (merchantPaymentId) record.merchant_payment_id = merchantPaymentId
    if (
      typeof fields.httpStatus === 'number' &&
      Number.isInteger(fields.httpStatus) &&
      fields.httpStatus >= 100 &&
      fields.httpStatus <= 599
    ) {
      record.http_status = fields.httpStatus
    }
    if (orderStatus) record.order_status = orderStatus
    if (paymentStatus) record.payment_status = paymentStatus
    if (errorCode) record.error_code = errorCode
    const error = diagnosticCategory(fields.error)
    if (error) record.error_message = error
    if (databaseOperation !== 'unknown') record.database_operation = databaseOperation
    if (databaseOutcome !== 'unknown') record.database_outcome = databaseOutcome
    if (typeof fields.productionEnvironment === 'boolean') {
      record.production_environment = fields.productionEnvironment
    }

    if (fields.configPresence) {
      const presence: Record<string, boolean> = {}
      for (const name of SAFE_CONFIG_NAMES) {
        if (typeof fields.configPresence[name] === 'boolean') {
          presence[name] = fields.configPresence[name] as boolean
        }
      }
      record.config_present = presence
    }

    const rejectReason = diagnosticCategory(rejectReasonValue)
    if (rejectReason) record.reject_reason = rejectReason
    const paymentDetailCodeValue = fields.receipt === undefined
      ? fields.paymentDetailCode
      : paymentDetail?.code
    const paymentDetailDescriptionValue = fields.receipt === undefined
      ? fields.paymentDetailCodeDescription
      : paymentDetail?.code_description
    const paymentDetailCode = allowlistedValue(
      paymentDetailCodeValue,
      DIAGNOSTIC_PAYMENT_CODES,
      'UNKNOWN_CODE',
    )
    const paymentDetailDescription = diagnosticCategory(paymentDetailDescriptionValue)
    if (paymentDetailCode || paymentDetailDescription) {
      record.payment_detail = {
        ...(paymentDetailCode ? { code: paymentDetailCode } : {}),
        ...(paymentDetailDescription ? { code_description: paymentDetailDescription } : {}),
      }
    }

    const actions = diagnosticActions(actionsValue)
    if (actions?.length) record.actions = actions

    console.info('[BOG_DIAGNOSTIC]', record)
  } catch {
    // Diagnostics are best-effort and must never affect payment processing.
  }
}

export function bogResponseErrorCode(payload: unknown): string | undefined {
  try {
    const body = objectRecord(payload)
    if (!body) return undefined
    for (const key of ['error_code', 'code', 'error']) {
      if (
        Object.prototype.hasOwnProperty.call(body, key) &&
        body[key] !== undefined &&
        body[key] !== null
      ) {
        return allowlistedValue(body[key], DIAGNOSTIC_ERROR_CODES, 'UNKNOWN_CODE')
      }
    }
  } catch {
    return 'UNKNOWN_CODE'
  }
  return undefined
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

async function getBogAccessToken(
  credentials: BogCredentials,
  context: Pick<BogDiagnosticFields, 'paymentId' | 'merchantPaymentId'> = {},
): Promise<string> {
  let response: Response
  try {
    response = await fetch(BOG_PRODUCTION_CONFIGURATION.tokenUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${credentials.clientKey}:${credentials.secretKey}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    })
  } catch (error) {
    logBogDiagnostic({
      stage: 'bog.oauth_token',
      outcome: 'failure',
      ...context,
      error,
    })
    throw error
  }
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
    logBogDiagnostic({
      stage: 'bog.oauth_token',
      outcome: 'failure',
      ...context,
      httpStatus: response.status,
      errorCode: code,
      error: descriptionCategory,
    })
    throw new Error(
      `BOG authentication failed (${response.status}; oauth_error=${code}; description=${descriptionCategory})`,
    )
  }
  let result: { access_token?: unknown }
  try {
    result = await response.json()
  } catch (error) {
    logBogDiagnostic({
      stage: 'bog.oauth_token',
      outcome: 'failure',
      ...context,
      httpStatus: response.status,
      error,
    })
    throw error
  }
  if (typeof result.access_token !== 'string' || !result.access_token) {
    logBogDiagnostic({
      stage: 'bog.oauth_token',
      outcome: 'failure',
      ...context,
      httpStatus: response.status,
      error: 'BOG returned no access token',
    })
    throw new Error('BOG returned no access token')
  }
  logBogDiagnostic({
    stage: 'bog.oauth_token',
    outcome: 'success',
    ...context,
    httpStatus: response.status,
  })
  return result.access_token
}

export async function createBogOrder(input: {
  credentials: BogCredentials
  idempotencyKey: string
  merchantPaymentId: string
  deviceSlots: number
  amount: number
  callbackUrl: string
  successUrl: string
  failUrl: string
}): Promise<{ paymentId: string; paymentUrl: string }> {
  const context = { merchantPaymentId: input.merchantPaymentId }
  const token = await getBogAccessToken(input.credentials, context)
  let response: Response
  try {
    response = await fetch(`${BOG_PRODUCTION_CONFIGURATION.apiUrl}/payments/v1/ecommerce/orders`, {
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
  } catch (error) {
    logBogDiagnostic({
      stage: 'bog.order_create',
      outcome: 'failure',
      ...context,
      error,
    })
    throw error
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    logBogDiagnostic({
      stage: 'bog.order_create',
      outcome: 'failure',
      ...context,
      httpStatus: response.status,
      errorCode: bogResponseErrorCode(payload),
      error: 'BOG order creation failed',
    })
    throw new Error(`BOG order creation failed (${response.status})`)
  }

  let result: { id?: unknown; _links?: { redirect?: { href?: unknown } } }
  try {
    result = await response.json()
  } catch (error) {
    logBogDiagnostic({
      stage: 'bog.order_create',
      outcome: 'failure',
      ...context,
      httpStatus: response.status,
      error,
    })
    throw error
  }
  const paymentId = typeof result.id === 'string' ? result.id : ''
  const paymentUrl = typeof result._links?.redirect?.href === 'string'
    ? result._links.redirect.href
    : ''
  if (!paymentId || !isBogPaymentUrl(paymentUrl)) {
    logBogDiagnostic({
      stage: 'bog.order_create',
      outcome: 'failure',
      ...context,
      httpStatus: response.status,
      error: 'BOG returned an invalid order or checkout URL',
    })
    throw new Error('BOG returned an invalid order or checkout URL')
  }
  logBogDiagnostic({
    stage: 'bog.order_create',
    outcome: 'success',
    paymentId,
    ...context,
    httpStatus: response.status,
  })
  return { paymentId, paymentUrl }
}

export async function getBogOrderDetails(
  credentials: BogCredentials,
  paymentId: string,
): Promise<BogOrderDetails> {
  const context = { paymentId }
  const token = await getBogAccessToken(credentials, context)
  let response: Response
  try {
    response = await fetch(
      `${BOG_PRODUCTION_CONFIGURATION.apiUrl}/payments/v1/receipt/${encodeURIComponent(paymentId)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    )
  } catch (error) {
    logBogDiagnostic({
      stage: 'bog.receipt',
      outcome: 'failure',
      ...context,
      error,
    })
    throw error
  }
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null)
    logBogDiagnostic({
      stage: 'bog.receipt',
      outcome: 'failure',
      ...context,
      httpStatus: response.status,
      errorCode: bogResponseErrorCode(payload),
      error: 'BOG receipt lookup failed',
    })
    throw new Error(`BOG receipt lookup failed (${response.status})`)
  }
  let order: BogOrderDetails
  try {
    order = await response.json()
  } catch (error) {
    logBogDiagnostic({
      stage: 'bog.receipt',
      outcome: 'failure',
      ...context,
      httpStatus: response.status,
      error,
    })
    throw error
  }
  logBogDiagnostic({
    stage: 'bog.receipt',
    outcome: 'success',
    ...context,
    httpStatus: response.status,
    receipt: order,
  })
  return order
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
