import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  BOG_PRODUCTION_CONFIGURATION,
  bogResponseErrorCode,
  canApplyBogStatus,
  createBogIdempotencyKey,
  createBogOrder,
  getBogOrderDetails,
  isBogPaymentUrl,
  logBogDiagnostic,
  verifyBogCallbackSignature,
  verifyBogOrderDetails,
  type BogCredentials,
  type BogStatus,
} from './bog-payment.ts'

const PRODUCTION_HOSTS = new Set(['cityroute.ge', 'www.cityroute.ge'])
const DEVICE_SLOT_PACKAGES_TABLE = 'device_slot_packages'
// Prices that were live before migration 029; used only while its table does not exist yet.
const LEGACY_DEVICE_SLOT_PRICES: Readonly<Record<number, number>> = { 1: 99, 2: 179 }

type DeviceSlotPackage = { deviceSlots: number; priceAmount: number }

type DeviceSlotPackageQueryResult = {
  data: { device_slots: number; price_amount: number } | null
  error: { code?: string; message?: string } | null
}

function isMissingDeviceSlotPackagesTable(error: { code?: string; message?: string }): boolean {
  // 42P01 = PostgreSQL undefined_table; PGRST205 = PostgREST reports the table absent from its schema.
  return (error.code === '42P01' || error.code === 'PGRST205') &&
    typeof error.message === 'string' &&
    error.message.includes(DEVICE_SLOT_PACKAGES_TABLE)
}

export function resolveDeviceSlotPackage(
  deviceSlots: number,
  result: DeviceSlotPackageQueryResult,
  warn: (_message: string, details: Record<string, unknown>) => void = (_message, details) => {
    logBogDiagnostic({
      stage: 'db.package_catalog',
      outcome: 'fallback',
      databaseOperation: 'device_slot_packages',
      databaseOutcome: 'fallback',
      errorCode: details.errorCode,
    })
  },
): DeviceSlotPackage | null {
  if (result.error) {
    if (!isMissingDeviceSlotPackagesTable(result.error)) throw result.error
    const legacyPrice = LEGACY_DEVICE_SLOT_PRICES[deviceSlots]
    warn('[BOG] device_slot_packages table is missing; using legacy device package price', {
      deviceSlots,
      priceAmount: legacyPrice ?? null,
      errorCode: result.error.code,
    })
    return legacyPrice === undefined ? null : { deviceSlots, priceAmount: legacyPrice }
  }
  return result.data
    ? { deviceSlots: result.data.device_slots, priceAmount: result.data.price_amount }
    : null
}

function storedInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^[1-9][0-9]{0,2}$/.test(value)) return Number(value)
  return null
}

function storedAmount(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(value)
      ? Number(value)
      : null
  if (numeric === null || !Number.isInteger(numeric) || numeric < 1) return null
  return numeric
}

export function decideBogCheckoutRetry(
  existing: StoredBogCheckout | null,
  trusted: { deviceSlots: number; priceAmount: number },
  expectedMerchantPaymentId: string,
): BogCheckoutDecision {
  if (!existing) return { action: 'create' }
  const storedDeviceSlots = storedInteger(existing.metadata?.device_slots)
  const storedPrice = storedAmount(existing.amount)
  const recordedPackagePrice = existing.metadata?.package_price
  const packagePrice = recordedPackagePrice == null ? null : storedAmount(recordedPackagePrice)
  const checkoutUrl = existing.metadata?.checkout_url
  const legacyPrice = LEGACY_DEVICE_SLOT_PRICES[trusted.deviceSlots]
  const amountAgrees = storedPrice === trusted.priceAmount &&
    storedDeviceSlots === trusted.deviceSlots &&
    existing.currency === 'GEL' &&
    existing.merchant_payment_id === expectedMerchantPaymentId &&
    (packagePrice === null
      ? legacyPrice === trusted.priceAmount
      : packagePrice === trusted.priceAmount)
  if (!amountAgrees || existing.status !== 'pending') {
    return {
      action: 'reject',
      code: existing.status === 'pending' ? 'pending_checkout_mismatch' : 'payment_already_settled',
      message: 'The stored payment order does not match the selected package',
    }
  }
  if (typeof checkoutUrl !== 'string' || !isBogPaymentUrl(checkoutUrl)) {
    return {
      action: 'reject',
      code: 'pending_checkout_unresumable',
      message: 'The pending payment cannot be resumed without creating another bank order',
    }
  }
  return { action: 'reuse', paymentUrl: checkoutUrl, amount: trusted.priceAmount }
}

type Environment = {
  VERCEL_ENV?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  /**
   * JWT for DB role cityroute_bog_confirmer only. Must not equal the service_role key.
   * Sent only as Authorization Bearer; apikey uses SUPABASE_ANON_KEY.
   */
  SUPABASE_BOG_CONFIRM_KEY?: string
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
  metadata: { provider: 'bog'; device_slots: number; package_price: number; checkout_url: string }
}

type PendingPaymentInsert = {
  user_id: string
  payment_id: string
  merchant_payment_id: string
  idempotency_key: string
  amount: number
  device_slots: number
  metadata: object
}

async function createPendingBogPayment(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string,
  payment: PendingPaymentInsert,
): Promise<void> {
  if (!accessToken) throw new Error('Authenticated checkout token is missing')
  const checkoutClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  })
  const { error } = await checkoutClient.rpc('create_bog_pending_payment', {
    p_user_id: payment.user_id,
    p_payment_id: payment.payment_id,
    p_merchant_payment_id: payment.merchant_payment_id,
    p_idempotency_key: payment.idempotency_key,
    p_amount: payment.amount,
    p_device_slots: payment.device_slots,
    p_metadata: payment.metadata,
  })
  if (error) {
    logBogDiagnostic({
      stage: 'db.create_pending_payment',
      outcome: 'failure',
      paymentId: payment.payment_id,
      merchantPaymentId: payment.merchant_payment_id,
      databaseOperation: 'create_bog_pending_payment',
      databaseOutcome: 'failure',
      errorCode: error.code,
      error,
    })
    throw error
  }
  logBogDiagnostic({
    stage: 'db.create_pending_payment',
    outcome: 'success',
    paymentId: payment.payment_id,
    merchantPaymentId: payment.merchant_payment_id,
    databaseOperation: 'create_bog_pending_payment',
    databaseOutcome: 'success',
  })
}

export type StoredBogCheckout = {
  user_id?: string
  payment_id: string
  merchant_payment_id: string | null
  idempotency_key?: string
  amount: number | string
  currency: string
  status: string
  created_at?: string
  metadata: {
    provider?: unknown
    device_slots?: unknown
    package_price?: unknown
    checkout_url?: unknown
    checkout_phase?: unknown
    claim_expires_at?: unknown
    bank_call_started_at?: unknown
    claim_payment_id?: unknown
    bank_payment_id?: unknown
    client_request_ids?: unknown
  } | null
}

export type BogCheckoutDecision =
  | { action: 'create' }
  | { action: 'reuse'; paymentUrl: string; amount: number }
  | { action: 'reject'; code: string; message: string }

const OPEN_CHECKOUT_STATUSES = new Set(['pending', 'processing'])
const TERMINAL_CHECKOUT_STATUSES = new Set([
  'success', 'failed', 'cancelled', 'refunded', 'refunded_partially',
])
const DEFAULT_CLAIM_LEASE_MS = 20_000
const DEFAULT_BANK_CALL_TIMEOUT_MS = 25_000

export type HeldCheckoutVerdict =
  | { kind: 'reuse'; paymentUrl: string; amount: number }
  | { kind: 'wait' }
  | { kind: 'takeover' }
  | { kind: 'reject'; code: string; message: string }

const CHECKOUT_MESSAGES = {
  pending_checkout_unresumable: 'გადახდის შედეგი უცნობია. ახალი საბანკო შეკვეთა არ შეიქმნება.',
  payment_attempt_unresolved: 'წინა გადახდის შედეგი ჯერ დადასტურებული არ არის. ახალი საბანკო შეკვეთა არ შეიქმნება.',
  payment_already_settled: 'ეს გადახდა უკვე დასრულებულია. ახალი საბანკო შეკვეთა არ შეიქმნება.',
  pending_checkout_mismatch: 'შენახული შეკვეთა არჩეულ პაკეტს არ ემთხვევა. ახალი საბანკო შეკვეთა არ შეიქმნება.',
  too_many_active_checkouts: 'ძალიან ბევრი აქტიური გადახდის მცდელობაა. მოგვიანებით სცადეთ ხელახლა.',
} as const

function requestIdsOf(row: StoredBogCheckout): string[] {
  const value = row.metadata?.client_request_ids
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

function phaseOf(row: StoredBogCheckout): 'claimed' | 'bank_call' | 'ready' | 'legacy' {
  const phase = row.metadata?.checkout_phase
  if (phase === 'claimed' || phase === 'bank_call' || phase === 'ready') return phase
  return 'legacy'
}

function epochOf(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function samePackage(row: StoredBogCheckout, deviceSlots: number, priceAmount: number): boolean {
  return storedInteger(row.metadata?.device_slots) === deviceSlots &&
    storedAmount(row.amount) === priceAmount &&
    row.currency === 'GEL' &&
    (row.metadata?.package_price == null || storedAmount(row.metadata.package_price) === priceAmount)
}

export function classifyHeldCheckout(
  row: StoredBogCheckout,
  trusted: { deviceSlots: number; priceAmount: number },
  now: number,
  bankCallTimeoutMs = DEFAULT_BANK_CALL_TIMEOUT_MS,
): HeldCheckoutVerdict {
  if (!samePackage(row, trusted.deviceSlots, trusted.priceAmount)) {
    return { kind: 'reject', code: 'pending_checkout_mismatch', message: CHECKOUT_MESSAGES.pending_checkout_mismatch }
  }
  if (TERMINAL_CHECKOUT_STATUSES.has(row.status)) {
    return { kind: 'reject', code: 'payment_already_settled', message: CHECKOUT_MESSAGES.payment_already_settled }
  }
  if (!OPEN_CHECKOUT_STATUSES.has(row.status)) {
    return { kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved }
  }
  const phase = phaseOf(row)
  const checkoutUrl = row.metadata?.checkout_url
  if ((phase === 'ready' || phase === 'legacy') && typeof checkoutUrl === 'string' && isBogPaymentUrl(checkoutUrl)) {
    return { kind: 'reuse', paymentUrl: checkoutUrl, amount: trusted.priceAmount }
  }
  if (phase === 'legacy') {
    return { kind: 'reject', code: 'pending_checkout_unresumable', message: CHECKOUT_MESSAGES.pending_checkout_unresumable }
  }
  if (phase === 'bank_call') {
    const started = epochOf(row.metadata?.bank_call_started_at)
    if (started !== null && now < started + bankCallTimeoutMs) return { kind: 'wait' }
    return { kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved }
  }
  const expires = epochOf(row.metadata?.claim_expires_at)
  if (expires !== null && now < expires) return { kind: 'wait' }
  return { kind: 'takeover' }
}

export function findHeldCheckout(
  rows: readonly StoredBogCheckout[],
  userId: string,
  deviceSlots: number,
  clientRequestId: string,
): StoredBogCheckout | null {
  const mine = rows.filter((row) => row.user_id === userId)
  const byRequest = mine.find((row) => requestIdsOf(row).includes(clientRequestId))
  if (byRequest) return byRequest
  return mine.find((row) =>
    OPEN_CHECKOUT_STATUSES.has(row.status) &&
    storedInteger(row.metadata?.device_slots) === deviceSlots
  ) ?? null
}

export function checkoutAnchor(rows: readonly StoredBogCheckout[], userId: string, deviceSlots: number): string {
  const terminals = rows.filter((row) =>
    row.user_id === userId &&
    TERMINAL_CHECKOUT_STATUSES.has(row.status) &&
    storedInteger(row.metadata?.device_slots) === deviceSlots
  )
  terminals.sort((left, right) => (epochOf(right.created_at) ?? 0) - (epochOf(left.created_at) ?? 0))
  return terminals[0]?.payment_id ?? 'none'
}

export async function logicalCheckoutIdentity(userId: string, deviceSlots: number, anchor: string) {
  const idempotencyKey = await createBogIdempotencyKey(userId, `device-slots:${deviceSlots}:after:${anchor}`)
  return {
    idempotencyKey,
    merchantPaymentId: `cr-${idempotencyKey}`,
    paymentId: `unissued:${idempotencyKey}`,
  }
}

function checkoutMetadata(
  row: StoredBogCheckout,
  patch: Record<string, unknown>,
): NonNullable<StoredBogCheckout['metadata']> {
  return { ...(row.metadata ?? {}), ...patch }
}

export type CheckoutReserveInput = {
  userId: string
  accessToken: string
  deviceSlots: number
  priceAmount: number
  clientRequestId: string
  now: number
  leaseMs: number
}

export type CheckoutLedger = {
  reserve(input: CheckoutReserveInput): Promise<{ outcome: 'owner' | 'joined'; checkout: StoredBogCheckout }>
  beginBankCall(paymentId: string, now: number): Promise<boolean>
  takeover(paymentId: string, now: number, leaseMs: number): Promise<StoredBogCheckout | null>
  complete(paymentId: string, payment: { paymentId: string; paymentUrl: string }): Promise<void>
  read(paymentId: string): Promise<StoredBogCheckout | null>
}

export function createMemoryCheckoutLedger(): CheckoutLedger & {
  seed(row: StoredBogCheckout): void
} {
  const rows: StoredBogCheckout[] = []
  let tail = Promise.resolve()
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
  const clone = (row: StoredBogCheckout): StoredBogCheckout => structuredClone(row)
  const remember = (row: StoredBogCheckout, clientRequestId: string) => {
    const ids = requestIdsOf(row)
    if (!ids.includes(clientRequestId)) {
      row.metadata = checkoutMetadata(row, { client_request_ids: [...ids, clientRequestId] })
    }
  }

  return {
    seed(row) {
      rows.push(clone(row))
    },
    reserve(input) {
      return exclusive(async () => {
        const held = findHeldCheckout(rows, input.userId, input.deviceSlots, input.clientRequestId)
        if (held) {
          remember(held, input.clientRequestId)
          return { outcome: 'joined' as const, checkout: clone(held) }
        }
        const identity = await logicalCheckoutIdentity(
          input.userId,
          input.deviceSlots,
          checkoutAnchor(rows, input.userId, input.deviceSlots),
        )
        const duplicate = rows.find((row) => row.user_id === input.userId && row.idempotency_key === identity.idempotencyKey)
        if (duplicate) {
          remember(duplicate, input.clientRequestId)
          return { outcome: 'joined' as const, checkout: clone(duplicate) }
        }
        const created: StoredBogCheckout = {
          user_id: input.userId,
          payment_id: identity.paymentId,
          merchant_payment_id: identity.merchantPaymentId,
          idempotency_key: identity.idempotencyKey,
          amount: input.priceAmount,
          currency: 'GEL',
          status: 'pending',
          created_at: new Date(input.now).toISOString(),
          metadata: {
            provider: 'bog',
            device_slots: input.deviceSlots,
            package_price: input.priceAmount,
            checkout_phase: 'claimed',
            claim_expires_at: new Date(input.now + input.leaseMs).toISOString(),
            client_request_ids: [input.clientRequestId],
          },
        }
        rows.push(created)
        return { outcome: 'owner' as const, checkout: clone(created) }
      })
    },
    beginBankCall(paymentId, now) {
      return exclusive(async () => {
        const row = rows.find((item) => item.payment_id === paymentId)
        if (!row || phaseOf(row) !== 'claimed') return false
        const expires = epochOf(row.metadata?.claim_expires_at)
        if (expires === null || now >= expires) return false
        row.metadata = checkoutMetadata(row, {
          checkout_phase: 'bank_call',
          bank_call_started_at: new Date(now).toISOString(),
        })
        return true
      })
    },
    takeover(paymentId, now, leaseMs) {
      return exclusive(async () => {
        const row = rows.find((item) => item.payment_id === paymentId)
        if (!row || phaseOf(row) !== 'claimed') return null
        const expires = epochOf(row.metadata?.claim_expires_at)
        if (expires !== null && now < expires) return null
        row.metadata = checkoutMetadata(row, {
          checkout_phase: 'claimed',
          claim_expires_at: new Date(now + leaseMs).toISOString(),
        })
        return clone(row)
      })
    },
    complete(paymentId, payment) {
      return exclusive(async () => {
        const row = rows.find((item) =>
          item.payment_id === paymentId || item.metadata?.claim_payment_id === paymentId
        )
        if (
          row &&
          phaseOf(row) === 'ready' &&
          row.metadata?.claim_payment_id === paymentId &&
          row.payment_id === payment.paymentId &&
          row.metadata.bank_payment_id === payment.paymentId &&
          row.metadata.checkout_url === payment.paymentUrl
        ) {
          return
        }
        if (!row || phaseOf(row) !== 'bank_call') {
          throw new Error('Checkout result cannot be saved')
        }
        if (!isBogPaymentUrl(payment.paymentUrl)) throw new Error('Checkout result cannot be saved')
        row.metadata = checkoutMetadata(row, {
          checkout_phase: 'ready',
          checkout_url: payment.paymentUrl,
          claim_payment_id: row.payment_id,
          bank_payment_id: payment.paymentId,
        })
        row.payment_id = payment.paymentId
      })
    },
    read(paymentId) {
      return exclusive(async () => {
        const row = rows.find((item) =>
          item.payment_id === paymentId || item.metadata?.claim_payment_id === paymentId
        )
        return row ? clone(row) : null
      })
    },
  }
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
    deviceSlots: number
    amount: number
    callbackUrl: string
    successUrl: string
    failUrl: string
  }): Promise<{ paymentId: string; paymentUrl: string }>
  getDeviceSlotPackage(deviceSlots: number): Promise<{ deviceSlots: number; priceAmount: number } | null>
  findTransactionByIdempotencyKey?(userId: string, idempotencyKey: string): Promise<StoredBogCheckout | null>
  checkoutLedger?: CheckoutLedger
  now?: () => number
  claimLeaseMs?: number
  bankCallTimeoutMs?: number
  waitTimeoutMs?: number
  pollIntervalMs?: number
  insertTransaction?(transaction: NewPaymentTransaction, accessToken: string): Promise<void>
  assertConfirmerReady?(): Promise<void>
  acquireBogRecoveryLease(claimPaymentId: string, leaseSeconds: number): Promise<string | null>
  releaseBogRecoveryLease(claimPaymentId: string, leaseToken: string): Promise<boolean>
  getTransactionById(paymentId: string, userId?: string): Promise<PaymentTransaction | null>
  getTransactionByMerchantId(merchantPaymentId: string, userId: string): Promise<PaymentTransaction | null>
  getOrderDetails(paymentId: string): ReturnType<typeof getBogOrderDetails>
  updatePaymentStatus(input: StatusUpdate): Promise<void>
  verifyCallbackSignature(rawBody: string, signature: string | null): Promise<boolean>
}

const CHECKOUT_ROW_COLUMNS = 'user_id, payment_id, merchant_payment_id, idempotency_key, amount, currency, status, created_at, metadata'

function createDatabaseCheckoutLedger(
  admin: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
): CheckoutLedger {
  async function loadUser(userId: string): Promise<StoredBogCheckout[]> {
    const { data, error } = await admin.from('payment_transactions')
      .select(CHECKOUT_ROW_COLUMNS)
      .eq('provider', 'bog')
      .eq('user_id', userId)
    if (error) throw error
    return (data ?? []) as StoredBogCheckout[]
  }

  async function loadOne(paymentId: string): Promise<StoredBogCheckout | null> {
    const direct = await admin.from('payment_transactions')
      .select(CHECKOUT_ROW_COLUMNS)
      .eq('provider', 'bog')
      .eq('payment_id', paymentId)
      .maybeSingle()
    if (direct.error) throw direct.error
    if (direct.data) return direct.data as StoredBogCheckout
    const claimed = await admin.from('payment_transactions')
      .select(CHECKOUT_ROW_COLUMNS)
      .eq('provider', 'bog')
      .filter('metadata->>claim_payment_id', 'eq', paymentId)
      .maybeSingle()
    if (claimed.error) throw claimed.error
    return (claimed.data ?? null) as StoredBogCheckout | null
  }

  return {
    async reserve(input) {
      const rows = await loadUser(input.userId)
      const held = findHeldCheckout(rows, input.userId, input.deviceSlots, input.clientRequestId)
      if (held) {
        const ids = requestIdsOf(held)
        if (!ids.includes(input.clientRequestId)) {
          const { error } = await admin.from('payment_transactions').update({
            metadata: checkoutMetadata(held, { client_request_ids: [...ids, input.clientRequestId] }),
          }).eq('provider', 'bog').eq('user_id', input.userId).eq('payment_id', held.payment_id)
          if (error) throw error
        }
        return { outcome: 'joined', checkout: held }
      }
      const identity = await logicalCheckoutIdentity(
        input.userId,
        input.deviceSlots,
        checkoutAnchor(rows, input.userId, input.deviceSlots),
      )
      const checkout: StoredBogCheckout = {
        user_id: input.userId,
        payment_id: identity.paymentId,
        merchant_payment_id: identity.merchantPaymentId,
        idempotency_key: identity.idempotencyKey,
        amount: input.priceAmount,
        currency: 'GEL',
        status: 'pending',
        created_at: new Date(input.now).toISOString(),
        metadata: {
          provider: 'bog',
          device_slots: input.deviceSlots,
          package_price: input.priceAmount,
          checkout_phase: 'claimed',
          claim_expires_at: new Date(input.now + input.leaseMs).toISOString(),
          client_request_ids: [input.clientRequestId],
        },
      }
      let insertConflict = false
      try {
        await createPendingBogPayment(supabaseUrl, anonKey, input.accessToken, {
          user_id: checkout.user_id,
          payment_id: checkout.payment_id,
          merchant_payment_id: checkout.merchant_payment_id,
          idempotency_key: checkout.idempotency_key,
          amount: input.priceAmount,
          device_slots: input.deviceSlots,
          metadata: checkout.metadata,
        })
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== '23505'
        ) {
          throw error
        }
        insertConflict = true
      }
      if (!insertConflict) return { outcome: 'owner', checkout }

      const { data: winner, error: lookupError } = await admin.from('payment_transactions')
        .select(CHECKOUT_ROW_COLUMNS)
        .eq('provider', 'bog')
        .eq('user_id', input.userId)
        .eq('idempotency_key', identity.idempotencyKey)
        .maybeSingle()
      if (lookupError) throw lookupError
      if (!winner) throw new Error('Pending BOG checkout claim conflict has no matching row')
      return { outcome: 'joined', checkout: winner as StoredBogCheckout }
    },
    async beginBankCall(paymentId, now) {
      const current = await loadOne(paymentId)
      const expires = epochOf(current?.metadata?.claim_expires_at)
      if (!current || phaseOf(current) !== 'claimed' || expires === null || now >= expires) return false
      const { data, error } = await admin.from('payment_transactions').update({
        metadata: checkoutMetadata(current, {
          checkout_phase: 'bank_call',
          bank_call_started_at: new Date(now).toISOString(),
        }),
      }).eq('provider', 'bog').eq('payment_id', current.payment_id)
        .filter('metadata->>checkout_phase', 'eq', 'claimed')
        .select('payment_id')
      if (error) throw error
      return Array.isArray(data) && data.length === 1
    },
    async takeover(paymentId, now, leaseMs) {
      const current = await loadOne(paymentId)
      const expires = epochOf(current?.metadata?.claim_expires_at)
      if (!current || phaseOf(current) !== 'claimed' || (expires !== null && now < expires)) return null
      const previousExpiry = current.metadata?.claim_expires_at
      let update = admin.from('payment_transactions').update({
        metadata: checkoutMetadata(current, {
          checkout_phase: 'claimed',
          claim_expires_at: new Date(now + leaseMs).toISOString(),
        }),
      }).eq('provider', 'bog').eq('payment_id', current.payment_id)
        .filter('metadata->>checkout_phase', 'eq', 'claimed')
      if (typeof previousExpiry === 'string') {
        update = update.filter('metadata->>claim_expires_at', 'eq', previousExpiry)
      }
      const { data, error } = await update.select(CHECKOUT_ROW_COLUMNS)
      if (error) throw error
      return Array.isArray(data) && data.length === 1 ? data[0] as StoredBogCheckout : null
    },
    async complete(paymentId, payment) {
      const current = await loadOne(paymentId)
      if (
        current &&
        phaseOf(current) === 'ready' &&
        current.metadata?.claim_payment_id === paymentId &&
        current.payment_id === payment.paymentId &&
        current.metadata.bank_payment_id === payment.paymentId &&
        current.metadata.checkout_url === payment.paymentUrl
      ) {
        return
      }
      if (!current || phaseOf(current) !== 'bank_call' || !isBogPaymentUrl(payment.paymentUrl)) {
        throw new Error('Checkout result cannot be saved')
      }
      const { data, error } = await admin.from('payment_transactions').update({
        payment_id: payment.paymentId,
        metadata: checkoutMetadata(current, {
          checkout_phase: 'ready',
          checkout_url: payment.paymentUrl,
          claim_payment_id: current.payment_id,
          bank_payment_id: payment.paymentId,
        }),
      }).eq('provider', 'bog').eq('payment_id', current.payment_id)
        .filter('metadata->>checkout_phase', 'eq', 'bank_call')
        .select('payment_id')
      if (error) throw error
      if (!Array.isArray(data) || data.length !== 1) {
        const latest = await loadOne(paymentId)
        if (
          latest &&
          phaseOf(latest) === 'ready' &&
          latest.metadata?.claim_payment_id === paymentId &&
          latest.payment_id === payment.paymentId &&
          latest.metadata.bank_payment_id === payment.paymentId &&
          latest.metadata.checkout_url === payment.paymentUrl
        ) {
          return
        }
        throw new Error('Checkout result cannot be saved')
      }
    },
    read: loadOne,
  }
}

export function bogConfirmKeyIsIsolated(
  serviceRoleKey: string | undefined,
  confirmKey: string | undefined,
): boolean {
  return Boolean(confirmKey) && confirmKey !== serviceRoleKey
}

/**
 * Confirmer RPC client: gateway-accepted anon/publishable apikey + confirmer JWT as Bearer.
 * Never pass the confirmer JWT as the createClient key (apikey) — Supabase rejects it as Invalid API key.
 * Never use service_role here.
 */
export function createBogConfirmerClient(
  supabaseUrl: string,
  anonKey: string,
  confirmKey: string,
) {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${confirmKey}` } },
  })
}

function createDefaultDependencies(): Dependencies {
  const environment = process.env
  const supabaseUrl = environment.SUPABASE_URL ?? ''
  const anonKey = environment.SUPABASE_ANON_KEY ?? ''
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const confirmKey = environment.SUPABASE_BOG_CONFIRM_KEY ?? ''
  const credentials = {
    clientKey: environment.BOG_CLIENT_KEY ?? '',
    secretKey: environment.BOG_SECRET_KEY ?? '',
  }
  const authClient = supabaseUrl && anonKey ? createClient(supabaseUrl, anonKey) : null
  const admin = supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
    : null
  const confirmer = supabaseUrl && anonKey && bogConfirmKeyIsIsolated(serviceRoleKey, confirmKey)
    ? createBogConfirmerClient(supabaseUrl, anonKey, confirmKey)
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
    async findTransactionByIdempotencyKey(userId, idempotencyKey) {
      try {
        if (!admin) throw new Error('Supabase service configuration is missing')
        const { data, error } = await admin.from('payment_transactions')
          .select('payment_id, merchant_payment_id, amount, currency, status, metadata')
          .eq('provider', 'bog')
          .eq('user_id', userId)
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle()
        if (error) throw error
        logBogDiagnostic({
          stage: 'db.checkout_lookup',
          outcome: data ? 'success' : 'not_found',
          databaseOperation: 'payment_transactions.find_by_idempotency_key',
          databaseOutcome: data ? 'success' : 'not_found',
        })
        return data
      } catch (error) {
        logBogDiagnostic({
          stage: 'db.checkout_lookup',
          outcome: 'failure',
          databaseOperation: 'payment_transactions.find_by_idempotency_key',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
        throw error
      }
    },
    async getDeviceSlotPackage(deviceSlots) {
      try {
        if (!admin) throw new Error('Supabase service configuration is missing')
        const result = await admin.from(DEVICE_SLOT_PACKAGES_TABLE)
          .select('device_slots, price_amount')
          .eq('subscription_plan', 'premium')
          .eq('device_slots', deviceSlots)
          .eq('active', true)
          .maybeSingle()
        const selected = resolveDeviceSlotPackage(deviceSlots, result)
        logBogDiagnostic({
          stage: 'db.package_lookup',
          outcome: selected ? 'success' : 'not_found',
          databaseOperation: 'device_slot_packages.select',
          databaseOutcome: selected ? 'success' : 'not_found',
          errorCode: result.error?.code,
        })
        return selected
      } catch (error) {
        logBogDiagnostic({
          stage: 'db.package_lookup',
          outcome: 'failure',
          databaseOperation: 'device_slot_packages.select',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
        throw error
      }
    },
    async getTransactionById(paymentId, userId) {
      try {
        if (!admin) throw new Error('Supabase service configuration is missing')
        let query = admin.from('payment_transactions')
          .select('payment_id, merchant_payment_id, user_id, amount, currency, status')
          .eq('provider', 'bog')
          .eq('payment_id', paymentId)
        if (userId) query = query.eq('user_id', userId)
        const { data, error } = await query.maybeSingle()
        if (error) throw error
        logBogDiagnostic({
          stage: 'db.transaction_lookup',
          outcome: data ? 'success' : 'not_found',
          paymentId,
          databaseOperation: 'payment_transactions.find_by_payment_id',
          databaseOutcome: data ? 'success' : 'not_found',
        })
        return data
      } catch (error) {
        logBogDiagnostic({
          stage: 'db.transaction_lookup',
          outcome: 'failure',
          paymentId,
          databaseOperation: 'payment_transactions.find_by_payment_id',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
        throw error
      }
    },
    async getTransactionByMerchantId(merchantPaymentId, userId) {
      try {
        if (!admin) throw new Error('Supabase service configuration is missing')
        const { data, error } = await admin.from('payment_transactions')
          .select('payment_id, merchant_payment_id, user_id, amount, currency, status')
          .eq('provider', 'bog')
          .eq('merchant_payment_id', merchantPaymentId)
          .eq('user_id', userId)
          .maybeSingle()
        if (error) throw error
        logBogDiagnostic({
          stage: 'db.transaction_lookup',
          outcome: data ? 'success' : 'not_found',
          merchantPaymentId,
          databaseOperation: 'payment_transactions.find_by_merchant_payment_id',
          databaseOutcome: data ? 'success' : 'not_found',
        })
        return data
      } catch (error) {
        logBogDiagnostic({
          stage: 'db.transaction_lookup',
          outcome: 'failure',
          merchantPaymentId,
          databaseOperation: 'payment_transactions.find_by_merchant_payment_id',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
        throw error
      }
    },
    async acquireBogRecoveryLease(claimPaymentId, leaseSeconds) {
      try {
        if (!admin) throw new Error('Supabase service configuration is missing')
        const { data, error } = await admin.rpc('acquire_bog_checkout_recovery_lease', {
          p_claim_payment_id: claimPaymentId,
          p_lease_seconds: leaseSeconds,
        })
        if (error) throw error
        logBogDiagnostic({
          stage: 'db.recovery_lease_acquire',
          outcome: typeof data === 'string' ? 'success' : 'not_acquired',
          paymentId: claimPaymentId,
          databaseOperation: 'acquire_bog_checkout_recovery_lease',
          databaseOutcome: typeof data === 'string' ? 'success' : 'not_acquired',
        })
        return typeof data === 'string' ? data : null
      } catch (error) {
        logBogDiagnostic({
          stage: 'db.recovery_lease_acquire',
          outcome: 'failure',
          paymentId: claimPaymentId,
          databaseOperation: 'acquire_bog_checkout_recovery_lease',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
        throw error
      }
    },
    async releaseBogRecoveryLease(claimPaymentId, leaseToken) {
      try {
        if (!admin) throw new Error('Supabase service configuration is missing')
        const { data, error } = await admin.rpc('release_bog_checkout_recovery_lease', {
          p_claim_payment_id: claimPaymentId,
          p_lease_token: leaseToken,
        })
        if (error) throw error
        if (typeof data !== 'boolean') throw new Error('BOG recovery lease release returned an invalid result')
        logBogDiagnostic({
          stage: 'db.recovery_lease_release',
          outcome: data ? 'success' : 'not_released',
          paymentId: claimPaymentId,
          databaseOperation: 'release_bog_checkout_recovery_lease',
          databaseOutcome: data ? 'success' : 'not_released',
        })
        return data
      } catch (error) {
        logBogDiagnostic({
          stage: 'db.recovery_lease_release',
          outcome: 'failure',
          paymentId: claimPaymentId,
          databaseOperation: 'release_bog_checkout_recovery_lease',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
        throw error
      }
    },
    getOrderDetails: (paymentId) => getBogOrderDetails(credentials, paymentId),
    async updatePaymentStatus(input) {
      try {
        if (!confirmer) {
          throw new Error('BOG confirmer configuration is missing or reuses the service_role key')
        }
        const { error } = await confirmer.rpc('update_bog_payment_status', {
          p_payment_id: input.paymentId,
          p_status: input.status,
          p_transaction_id: input.transactionId,
          p_metadata: input.metadata,
        })
        if (error) throw error
        logBogDiagnostic({
          stage: 'db.update_payment_status',
          outcome: 'success',
          paymentId: input.paymentId,
          orderStatus: input.metadata.bank_status,
          paymentStatus: input.status,
          databaseOperation: 'update_bog_payment_status',
          databaseOutcome: 'success',
        })
      } catch (error) {
        logBogDiagnostic({
          stage: 'db.update_payment_status',
          outcome: 'failure',
          paymentId: input.paymentId,
          orderStatus: input.metadata.bank_status,
          paymentStatus: input.status,
          databaseOperation: 'update_bog_payment_status',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
        throw error
      }
    },
    async assertConfirmerReady() {
      if (!confirmer) {
        throw new Error('BOG confirmer configuration is missing or reuses the service_role key')
      }
      const { error } = await confirmer.rpc('update_bog_payment_status', {
        p_payment_id: '',
        p_status: '',
        p_transaction_id: null,
        p_metadata: {},
      })
      if (error?.message === 'Invalid BOG payment status update') {
        logBogDiagnostic({
          stage: 'db.confirmer_readiness',
          outcome: 'success',
          databaseOperation: 'update_bog_payment_status.readiness_probe',
          databaseOutcome: 'success',
        })
        return
      }
      if (error) {
        logBogDiagnostic({
          stage: 'db.confirmer_readiness',
          outcome: 'failure',
          databaseOperation: 'update_bog_payment_status.readiness_probe',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
        const detail = typeof error.message === 'string' && error.message
          ? error.message
          : 'unknown RPC error'
        // Surface non-sensitive PostgREST/gateway message for ops (never includes JWT/secrets).
        throw new Error(`BOG confirmer authorization check failed: ${detail}`)
      }
      logBogDiagnostic({
        stage: 'db.confirmer_readiness',
        outcome: 'failure',
        databaseOperation: 'update_bog_payment_status.readiness_probe',
        databaseOutcome: 'failure',
        error: 'BOG confirmer authorization check was unexpectedly accepted',
      })
      throw new Error('BOG confirmer authorization check was unexpectedly accepted')
    },
    verifyCallbackSignature: verifyBogCallbackSignature,
    checkoutLedger: admin ? createDatabaseCheckoutLedger(admin, supabaseUrl, anonKey) : undefined,
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
  stage: 'initialize' | 'verify' | 'callback',
): { appUrl: URL; credentials: BogCredentials } | Response {
  const env = dependencies.environment
  const configPresence = {
    SUPABASE_URL: Boolean(env.SUPABASE_URL),
    SUPABASE_ANON_KEY: Boolean(env.SUPABASE_ANON_KEY),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_BOG_CONFIRM_KEY: Boolean(env.SUPABASE_BOG_CONFIRM_KEY),
    BOG_CLIENT_KEY: Boolean(env.BOG_CLIENT_KEY),
    BOG_SECRET_KEY: Boolean(env.BOG_SECRET_KEY),
    PRODUCTION_APP_URL: Boolean(env.PRODUCTION_APP_URL),
  }
  const logConfiguration = (outcome: string, error?: unknown) => logBogDiagnostic({
    stage: `${stage}.configuration`,
    outcome,
    configPresence,
    productionEnvironment: env.VERCEL_ENV === 'production',
    error,
  })
  if (env.VERCEL_ENV !== 'production') {
    logConfiguration('rejected', 'Production environment is required')
    return jsonResponse({ error: 'BOG Live payments are available only in Production' }, 404)
  }
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !bogConfirmKeyIsIsolated(env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_BOG_CONFIRM_KEY) ||
    !env.BOG_CLIENT_KEY ||
    !env.BOG_SECRET_KEY ||
    !env.PRODUCTION_APP_URL
  ) {
    logConfiguration('failure', 'Required payment configuration is missing')
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
      logConfiguration('rejected', 'Production payment origin is invalid')
      return jsonResponse({ error: 'Production payment origin is invalid' }, 403)
    }
    logConfiguration('success')
    return {
      appUrl,
      credentials: { clientKey: env.BOG_CLIENT_KEY, secretKey: env.BOG_SECRET_KEY },
    }
  } catch {
    logConfiguration('failure', 'Production payment configuration is invalid')
    return jsonResponse({ error: 'Production payment configuration is invalid' }, 503)
  }
}

function response(value: object): value is Response {
  return value instanceof Response
}

async function authenticate(
  request: Request,
  dependencies: Dependencies,
  stage: 'initialize' | 'verify' | 'callback',
): Promise<{ id: string } | Response> {
  const token = accessTokenOf(request)
  if (!token) {
    logBogDiagnostic({ stage: `${stage}.authentication`, outcome: 'missing_token' })
    return jsonResponse({ error: 'Authentication is required' }, 401)
  }
  try {
    const user = await dependencies.authenticateUser(token)
    logBogDiagnostic({
      stage: `${stage}.authentication`,
      outcome: user ? 'success' : 'rejected',
    })
    return user ?? jsonResponse({ error: 'Unauthorized' }, 401)
  } catch (error) {
    logBogDiagnostic({
      stage: `${stage}.authentication`,
      outcome: 'failure',
      errorCode: errorCodeOf(error),
      error,
    })
    throw error
  }
}

function accessTokenOf(request: Request): string | null {
  const match = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('BOG_CALL_TIMEOUT')), timeoutMs)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runClaimedCheckout(input: {
  userId: string
  accessToken: string
  deviceSlots: number
  amount: number
  clientRequestId: string
  appUrl: URL
  credentials: BogCredentials
  dependencies: Dependencies
}): Promise<Response> {
  const ledger = input.dependencies.checkoutLedger
  if (!ledger) return jsonResponse({ error: 'Payment could not be started; try again later' }, 500)
  const now = () => input.dependencies.now?.() ?? Date.now()
  const leaseMs = input.dependencies.claimLeaseMs ?? DEFAULT_CLAIM_LEASE_MS
  const bankTimeoutMs = input.dependencies.bankCallTimeoutMs ?? DEFAULT_BANK_CALL_TIMEOUT_MS
  const waitTimeoutMs = input.dependencies.waitTimeoutMs ?? DEFAULT_BANK_CALL_TIMEOUT_MS
  const pollMs = input.dependencies.pollIntervalMs ?? 50
  const trusted = { deviceSlots: input.deviceSlots, priceAmount: input.amount }
  const recoveryLeaseSeconds = 180

  const respond = (verdict: HeldCheckoutVerdict): Response => {
    if (verdict.kind === 'reuse') {
      return jsonResponse({ success: true, paymentUrl: verdict.paymentUrl, amount: verdict.amount }, 200)
    }
    if (verdict.kind === 'reject') return jsonResponse({ error: verdict.message, code: verdict.code }, 409)
    return jsonResponse({
      error: CHECKOUT_MESSAGES.payment_attempt_unresolved,
      code: 'payment_attempt_unresolved',
    }, 409)
  }

  const saveLater = (paymentId: string, payment: Promise<{ paymentId: string; paymentUrl: string }>) => {
    void payment.then(async (created) => {
      try {
        await ledger.complete(paymentId, created)
      } catch (error) {
        logBogDiagnostic({
          stage: 'db.checkout_complete',
          outcome: 'failure',
          paymentId,
          databaseOperation: 'checkout_ledger.complete',
          databaseOutcome: 'failure',
          errorCode: errorCodeOf(error),
          error,
        })
      }
    }, () => undefined)
  }

  const createBankOrder = (checkout: StoredBogCheckout) => {
    const merchantPaymentId = checkout.merchant_payment_id
    const idempotencyKey = checkout.idempotency_key
    if (!merchantPaymentId || !idempotencyKey) {
      throw new Error('Pending BOG checkout identity is incomplete')
    }
    const returnUrl = new URL('/payment/return', input.appUrl)
    returnUrl.searchParams.set('provider', 'bog-production')
    returnUrl.searchParams.set('merchantPaymentId', merchantPaymentId)
    const failUrl = new URL(returnUrl)
    failUrl.searchParams.set('checkout', 'not-completed')
    return input.dependencies.createOrder({
      credentials: input.credentials,
      idempotencyKey,
      merchantPaymentId,
      deviceSlots: input.deviceSlots,
      amount: input.amount,
      callbackUrl: new URL('/api/payments/bog/callback', input.appUrl).toString(),
      successUrl: returnUrl.toString(),
      failUrl: failUrl.toString(),
    })
  }

  const withRecoveryLease = async (
    claimPaymentId: string,
    operation: (preserveLeaseUntilExpiry: () => void) => Promise<Response>,
  ): Promise<Response> => {
    const leaseToken = await input.dependencies.acquireBogRecoveryLease(
      claimPaymentId,
      recoveryLeaseSeconds,
    )
    if (!leaseToken) {
      return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
    }

    let preserveLease = false
    try {
      return await operation(() => { preserveLease = true })
    } finally {
      if (!preserveLease) {
        try {
          const released = await input.dependencies.releaseBogRecoveryLease(claimPaymentId, leaseToken)
          if (!released) {
            logBogDiagnostic({
              stage: 'checkout.recovery_lease_release',
              outcome: 'not_released',
              paymentId: claimPaymentId,
            })
          }
        } catch (error) {
          logBogDiagnostic({
            stage: 'checkout.recovery_lease_release',
            outcome: 'failure',
            paymentId: claimPaymentId,
            errorCode: errorCodeOf(error),
            error,
          })
        }
      }
    }
  }

  const settleVerifiedReceipt = async (
    paymentId: string,
    verified: ReturnType<typeof verifyBogOrderDetails>,
  ) => {
    await withTimeout(
      input.dependencies.updatePaymentStatus({
        paymentId,
        status: verified.status,
        transactionId: verified.transactionId,
        metadata: {
          bank_status: verified.bankStatus,
          bank_amount: verified.amount,
          bank_refund_amount: verified.refundAmount,
          bank_currency: verified.currency,
          bank_external_order_id: verified.externalOrderId,
          verified_at: new Date(now()).toISOString(),
        },
      }),
      bankTimeoutMs,
    )
    return verified
  }

  const recoverBankCall = async (checkout: StoredBogCheckout): Promise<Response> => withRecoveryLease(
    checkout.payment_id,
    async (preserveLeaseUntilExpiry) => {
      try {
        const merchantPaymentId = checkout.merchant_payment_id
        if (!merchantPaymentId) throw new Error('Pending BOG checkout merchant ID is missing')
        let payment: Awaited<ReturnType<typeof createBankOrder>>
        try {
          payment = await withTimeout(createBankOrder(checkout), bankTimeoutMs)
        } catch (error) {
          preserveLeaseUntilExpiry()
          throw error
        }
        const receipt = await withTimeout(
          input.dependencies.getOrderDetails(payment.paymentId),
          bankTimeoutMs,
        )
        const verified = verifyBogOrderDetails(receipt, {
          paymentId: payment.paymentId,
          merchantPaymentId,
          amount: input.amount,
          currency: 'GEL',
        })
        try {
          await withTimeout(ledger.complete(checkout.payment_id, payment), bankTimeoutMs)
          logBogDiagnostic({
            stage: 'db.checkout_complete',
            outcome: 'success',
            paymentId: checkout.payment_id,
            merchantPaymentId,
            databaseOperation: 'checkout_ledger.complete',
            databaseOutcome: 'success',
          })
        } catch (error) {
          preserveLeaseUntilExpiry()
          logBogDiagnostic({
            stage: 'db.checkout_complete',
            outcome: 'failure',
            paymentId: checkout.payment_id,
            merchantPaymentId,
            databaseOperation: 'checkout_ledger.complete',
            databaseOutcome: 'failure',
            errorCode: errorCodeOf(error),
            error,
          })
          saveLater(checkout.payment_id, Promise.resolve(payment))
          return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
        }
        await settleVerifiedReceipt(payment.paymentId, verified)
        return jsonResponse({
          success: true,
          paymentUrl: payment.paymentUrl,
          amount: input.amount,
        }, 200)
      } catch (error) {
        preserveLeaseUntilExpiry()
        logBogDiagnostic({
          stage: 'checkout.recovery',
          outcome: 'failure',
          paymentId: checkout.payment_id,
          merchantPaymentId: checkout.merchant_payment_id,
          errorCode: errorCodeOf(error),
          error,
        })
        return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
      }
    },
  )

  const reconcileReadyCheckout = async (checkout: StoredBogCheckout): Promise<Response> => {
    const claimPaymentId = checkout.metadata?.claim_payment_id
    const paymentId = checkout.payment_id
    const merchantPaymentId = checkout.merchant_payment_id
    if (
      typeof claimPaymentId !== 'string' ||
      !claimPaymentId ||
      !paymentId ||
      paymentId.startsWith('unissued:') ||
      !merchantPaymentId
    ) {
      return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
    }

    return withRecoveryLease(claimPaymentId, async (preserveLeaseUntilExpiry) => {
      try {
        const latest = await withTimeout(ledger.read(claimPaymentId), bankTimeoutMs)
        if (
          !latest ||
          phaseOf(latest) !== 'ready' ||
          !latest.payment_id ||
          latest.payment_id.startsWith('unissued:') ||
          latest.payment_id !== paymentId ||
          latest.merchant_payment_id !== merchantPaymentId ||
          typeof latest.metadata?.checkout_url !== 'string'
        ) {
          throw new Error('BOG ready checkout changed while acquiring its recovery lease')
        }
        const receipt = await withTimeout(input.dependencies.getOrderDetails(paymentId), bankTimeoutMs)
        if (!receipt) throw new Error('BOG order receipt is missing')
        const verified = verifyBogOrderDetails(receipt, {
          paymentId,
          merchantPaymentId,
          amount: input.amount,
          currency: 'GEL',
        })
        await settleVerifiedReceipt(paymentId, verified)
        if (['failed', 'cancelled', 'refunded', 'refunded_partially'].includes(verified.status)) {
          return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
        }
        return respond({
          kind: 'reuse',
          paymentUrl: latest.metadata.checkout_url,
          amount: input.amount,
        })
      } catch (error) {
        preserveLeaseUntilExpiry()
        logBogDiagnostic({
          stage: 'checkout.ready_settlement',
          outcome: 'failure',
          paymentId,
          merchantPaymentId,
          errorCode: errorCodeOf(error),
          error,
        })
        return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
      }
    })
  }

  const isRecoverableBankCall = (checkout: StoredBogCheckout) => {
    const started = epochOf(checkout.metadata?.bank_call_started_at)
    return checkout.status === 'pending'
      && phaseOf(checkout) === 'bank_call'
      && started !== null
      && now() >= started + bankTimeoutMs
  }

  const startOwnedCheckout = async (checkout: StoredBogCheckout): Promise<Response> => {
    const started = await ledger.beginBankCall(checkout.payment_id, now())
    if (!started) {
      const latest = await ledger.read(checkout.payment_id)
      return latest ? waitForCheckout(latest) : respond({ kind: 'wait' })
    }
    if (!checkout.merchant_payment_id || !checkout.idempotency_key) {
      return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
    }
    return withRecoveryLease(checkout.payment_id, async (preserveLeaseUntilExpiry) => {
      const bankCall = createBankOrder(checkout)
      try {
        const payment = await withTimeout(bankCall, bankTimeoutMs)
        try {
          await withTimeout(ledger.complete(checkout.payment_id, payment), bankTimeoutMs)
          logBogDiagnostic({
            stage: 'db.checkout_complete',
            outcome: 'success',
            paymentId: checkout.payment_id,
            merchantPaymentId: checkout.merchant_payment_id,
            databaseOperation: 'checkout_ledger.complete',
            databaseOutcome: 'success',
          })
        } catch (error) {
          preserveLeaseUntilExpiry()
          logBogDiagnostic({
            stage: 'db.checkout_complete',
            outcome: 'failure',
            paymentId: checkout.payment_id,
            merchantPaymentId: checkout.merchant_payment_id,
            databaseOperation: 'checkout_ledger.complete',
            databaseOutcome: 'failure',
            errorCode: errorCodeOf(error),
            error,
          })
          saveLater(checkout.payment_id, Promise.resolve(payment))
          return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
        }
        return jsonResponse({ success: true, paymentUrl: payment.paymentUrl, amount: input.amount }, 200)
      } catch (error) {
        preserveLeaseUntilExpiry()
        if (error instanceof Error && error.message === 'BOG_CALL_TIMEOUT') saveLater(checkout.payment_id, bankCall)
        logBogDiagnostic({
          stage: 'checkout.bank_call',
          outcome: 'failure',
          paymentId: checkout.payment_id,
          merchantPaymentId: checkout.merchant_payment_id,
          errorCode: errorCodeOf(error),
          error,
        })
        return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
      }
    })
  }

  const waitForCheckout = async (checkout: StoredBogCheckout): Promise<Response> => {
    const startedWall = Date.now()
    let current = checkout
    for (;;) {
      const verdict = classifyHeldCheckout(current, trusted, now(), bankTimeoutMs)
      if (verdict.kind === 'reuse') {
        if (phaseOf(current) === 'ready') return reconcileReadyCheckout(current)
        return respond(verdict)
      }
      if (verdict.kind === 'reject') {
        if (isRecoverableBankCall(current)) return recoverBankCall(current)
        return respond(verdict)
      }
      if (verdict.kind === 'takeover') {
        const claimed = await ledger.takeover(current.payment_id, now(), leaseMs)
        if (claimed) return startOwnedCheckout(claimed)
      }
      if (Date.now() - startedWall >= waitTimeoutMs) {
        return respond({ kind: 'reject', code: 'payment_attempt_unresolved', message: CHECKOUT_MESSAGES.payment_attempt_unresolved })
      }
      await sleep(pollMs)
      current = await ledger.read(current.payment_id) ?? current
    }
  }

  const reservation = await ledger.reserve({
    userId: input.userId,
    accessToken: input.accessToken,
    deviceSlots: input.deviceSlots,
    priceAmount: input.amount,
    clientRequestId: input.clientRequestId,
    now: now(),
    leaseMs,
  })
  logBogDiagnostic({
    stage: 'db.checkout_reserve',
    outcome: reservation.outcome,
    paymentId: reservation.checkout.payment_id,
    merchantPaymentId: reservation.checkout.merchant_payment_id,
    databaseOperation: 'checkout_ledger.reserve',
    databaseOutcome: reservation.outcome,
  })
  if (reservation.outcome === 'owner') return startOwnedCheckout(reservation.checkout)
  return waitForCheckout(reservation.checkout)
}

export async function handleBogInitialize(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'POST') {
    logBogDiagnostic({ stage: 'initialize.request', outcome: 'invalid_method' })
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  const config = configuration(request, dependencies, true, 'initialize')
  if (response(config)) return config

  let diagnosticMerchantPaymentId: string | undefined
  try {
    const user = await authenticate(request, dependencies, 'initialize')
    if (response(user)) return user
    const accessToken = accessTokenOf(request)
    if (!accessToken) return jsonResponse({ error: 'Authentication is required' }, 401)
    let body: { provider?: unknown; deviceSlots?: unknown; requestId?: unknown }
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid JSON request body' }, 400)
    }
    if (
      body.provider !== 'bog' ||
      typeof body.deviceSlots !== 'number' ||
      !Number.isInteger(body.deviceSlots) ||
      body.deviceSlots < 1 ||
      body.deviceSlots > 100 ||
      typeof body.requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)
    ) {
      return jsonResponse({ error: 'Invalid payment request' }, 400)
    }
    try {
      await dependencies.assertConfirmerReady?.()
    } catch (error) {
      logBogDiagnostic({
        stage: 'initialize.confirmer_readiness',
        outcome: 'failure',
        errorCode: errorCodeOf(error),
        error,
      })
      return jsonResponse({ error: 'BOG settlement is unavailable' }, 503)
    }

    const deviceSlots = body.deviceSlots
    const selectedPackage = await dependencies.getDeviceSlotPackage(deviceSlots)
    if (
      !selectedPackage ||
      selectedPackage.deviceSlots !== deviceSlots ||
      !Number.isInteger(selectedPackage.priceAmount) ||
      selectedPackage.priceAmount < 1
    ) {
      return jsonResponse({ error: 'Selected device package is unavailable' }, 400)
    }
    const amount = selectedPackage.priceAmount
    if (dependencies.checkoutLedger) {
      return await runClaimedCheckout({
        userId: user.id,
        accessToken,
        deviceSlots,
        amount,
        clientRequestId: body.requestId,
        appUrl: config.appUrl,
        credentials: config.credentials,
        dependencies,
      })
    }
    const idempotencyKey = await createBogIdempotencyKey(user.id, body.requestId)
    const merchantPaymentId = `cr-${idempotencyKey}`
    diagnosticMerchantPaymentId = merchantPaymentId
    const existingOrder = dependencies.findTransactionByIdempotencyKey
      ? await dependencies.findTransactionByIdempotencyKey(user.id, idempotencyKey)
      : null
    const checkoutDecision = decideBogCheckoutRetry(
      existingOrder,
      { deviceSlots, priceAmount: amount },
      merchantPaymentId,
    )
    if (checkoutDecision.action === 'reject') {
      return jsonResponse({
        error: checkoutDecision.message,
        code: checkoutDecision.code,
      }, 409)
    }
    if (checkoutDecision.action === 'reuse') {
      return jsonResponse({
        success: true,
        paymentUrl: checkoutDecision.paymentUrl,
        amount: checkoutDecision.amount,
      }, 200)
    }
    return jsonResponse({ error: 'Atomic checkout ledger is unavailable' }, 503)
  } catch (error) {
    if (isActiveBogCheckoutLimitError(error)) {
      return jsonResponse({
        error: CHECKOUT_MESSAGES.too_many_active_checkouts,
        code: 'too_many_active_checkouts',
      }, 429)
    }
    logBogDiagnostic({
      stage: 'initialize.handler',
      outcome: 'failure',
      merchantPaymentId: diagnosticMerchantPaymentId,
      errorCode: errorCodeOf(error),
      error,
    })
    return jsonResponse({ error: 'Payment could not be started; try again later' }, 500)
  }
}

export async function handleBogVerify(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'GET') {
    logBogDiagnostic({ stage: 'verify.request', outcome: 'invalid_method' })
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  const config = configuration(request, dependencies, false, 'verify')
  if (response(config)) return config
  let diagnosticPaymentId: string | undefined
  let diagnosticMerchantPaymentId: string | undefined
  try {
    const user = await authenticate(request, dependencies, 'verify')
    if (response(user)) return user
    const url = new URL(request.url)
    if (url.searchParams.get('provider') !== 'bog') {
      return jsonResponse({ error: 'Invalid payment provider' }, 400)
    }
    const paymentId = url.searchParams.get('paymentId')
    const merchantPaymentId = url.searchParams.get('merchantPaymentId')
    diagnosticPaymentId = paymentId ?? undefined
    diagnosticMerchantPaymentId = merchantPaymentId ?? undefined
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
    logBogDiagnostic({
      stage: 'verify.receipt_validation',
      outcome: 'success',
      paymentId: transaction.payment_id,
      merchantPaymentId: transaction.merchant_payment_id,
      orderStatus: verified.bankStatus,
      paymentStatus: verified.status,
    })
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
    logBogDiagnostic({
      stage: 'verify.handler',
      outcome: shouldApply ? 'settled' : 'unchanged',
      paymentId: transaction.payment_id,
      merchantPaymentId: transaction.merchant_payment_id,
      orderStatus: verified.bankStatus,
      paymentStatus: currentStatus,
    })
    return jsonResponse({
      status: currentStatus,
      bankStatus: verified.bankStatus,
      transactionId: verified.transactionId,
    }, 200)
  } catch (error) {
    logBogDiagnostic({
      stage: 'verify.handler',
      outcome: 'failure',
      paymentId: diagnosticPaymentId,
      merchantPaymentId: diagnosticMerchantPaymentId,
      errorCode: errorCodeOf(error),
      error,
    })
    return jsonResponse({ error: 'Payment verification failed' }, 500)
  }
}

export async function handleBogCallback(
  request: Request,
  dependencies = createDefaultDependencies(),
): Promise<Response> {
  if (request.method !== 'POST') {
    logBogDiagnostic({ stage: 'callback.request', outcome: 'invalid_method' })
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }
  const config = configuration(request, dependencies, false, 'callback')
  if (response(config)) return config
  let diagnosticPaymentId: string | undefined
  let diagnosticMerchantPaymentId: string | undefined
  try {
    const rawBody = await request.text()
    if (!await dependencies.verifyCallbackSignature(rawBody, request.headers.get('callback-signature'))) {
      logBogDiagnostic({ stage: 'callback.signature', outcome: 'rejected' })
      return jsonResponse({ error: 'Invalid BOG callback signature' }, 401)
    }
    let callback: { event?: unknown; body?: { order_id?: unknown } }
    try {
      callback = JSON.parse(rawBody)
    } catch {
      return jsonResponse({ error: 'Invalid BOG callback body' }, 400)
    }
    if (callback.event !== 'order_payment' || typeof callback.body?.order_id !== 'string') {
      logBogDiagnostic({ stage: 'callback.payload', outcome: 'rejected' })
      return jsonResponse({ error: 'Invalid BOG callback body' }, 400)
    }
    diagnosticPaymentId = callback.body.order_id
    const transaction = await dependencies.getTransactionById(callback.body.order_id)
    if (!transaction?.merchant_payment_id) {
      logBogDiagnostic({
        stage: 'callback.transaction_lookup',
        outcome: 'not_found',
        paymentId: diagnosticPaymentId,
      })
      return jsonResponse({ error: 'BOG payment transaction was not found' }, 404)
    }
    diagnosticMerchantPaymentId = transaction.merchant_payment_id
    const verified = await verifyStoredOrder(transaction, dependencies)
    logBogDiagnostic({
      stage: 'callback.receipt_validation',
      outcome: 'success',
      paymentId: transaction.payment_id,
      merchantPaymentId: transaction.merchant_payment_id,
      orderStatus: verified.bankStatus,
      paymentStatus: verified.status,
    })
    if (!canApplyBogStatus(transaction.status, verified.status)) {
      logBogDiagnostic({
        stage: 'callback.handler',
        outcome: 'duplicate_or_stale',
        paymentId: transaction.payment_id,
        merchantPaymentId: transaction.merchant_payment_id,
        orderStatus: verified.bankStatus,
        paymentStatus: transaction.status,
      })
      return jsonResponse({ success: true, duplicateOrStale: true }, 200)
    }
    await dependencies.updatePaymentStatus({
      paymentId: transaction.payment_id,
      status: verified.status,
      transactionId: verified.transactionId,
      metadata: verifiedMetadata(verified),
    })
    logBogDiagnostic({
      stage: 'callback.handler',
      outcome: 'settled',
      paymentId: transaction.payment_id,
      merchantPaymentId: transaction.merchant_payment_id,
      orderStatus: verified.bankStatus,
      paymentStatus: verified.status,
    })
    return jsonResponse({ success: true }, 200)
  } catch (error) {
    logBogDiagnostic({
      stage: 'callback.handler',
      outcome: 'failure',
      paymentId: diagnosticPaymentId,
      merchantPaymentId: diagnosticMerchantPaymentId,
      errorCode: errorCodeOf(error),
      error,
    })
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

function errorCodeOf(error: unknown): unknown {
  try {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
    return error.code
  } catch {
    return undefined
  }
}

function isActiveBogCheckoutLimitError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'P0001'
    && 'message' in error
    && error.message === 'Too many active BOG checkout attempts'
}
