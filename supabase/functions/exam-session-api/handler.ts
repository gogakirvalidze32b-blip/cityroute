import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cityroute-device-fingerprint',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}

type JsonRecord = Record<string, unknown>

type Identity = {
  userId: string
  deviceId: string
  tabId: string
}

type RequestBody = {
  action: string
  identity: Identity
  pageInstanceId: string
  capability?: string
  recoveryTicket?: string
  nextRecoveryTicket?: string
  recoveryAttemptId?: string
  lease?: string
  sessionId?: string
  expectedVersion?: number
  payload?: JsonRecord
}

type ServiceRoleClient = {
  auth: {
    getUser(jwt: string): PromiseLike<{
      data: { user: { id: string } | null }
      error: { message?: string } | null
    }>
  }
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export type ExamSessionApiDependencies = {
  env?: { get(name: string): string | undefined }
  createServiceClient?: (url: string, serviceRoleKey: string) => ServiceRoleClient
  logError?: (message: string) => void
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const tokenPattern = /^[A-Za-z0-9_-]{43}$/
const hashPattern = /^[a-f0-9]{64}$/
const leaseTtlSeconds = 90
const capabilityTtlSeconds = 30 * 24 * 60 * 60
const maxRequestBytes = 2 * 1024 * 1024

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeVerifiedClaims(accessToken: string): JsonRecord | null {
  const payload = accessToken.split('.')[1]
  if (!payload) return null
  try {
    const base64 = payload.replaceAll('-', '+').replaceAll('_', '/')
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
    const parsed: unknown = JSON.parse(decoded)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function validateBody(value: unknown): RequestBody | null {
  if (!isRecord(value) || !isRecord(value.identity)) return null
  const identity = value.identity
  if (
    typeof value.action !== 'string' ||
    typeof value.pageInstanceId !== 'string' ||
    !tokenPattern.test(value.pageInstanceId) ||
    typeof identity.userId !== 'string' ||
    !uuidPattern.test(identity.userId) ||
    typeof identity.deviceId !== 'string' ||
    identity.deviceId.trim().length < 8 ||
    identity.deviceId.length > 256 ||
    typeof identity.tabId !== 'string' ||
    identity.tabId.trim().length < 8 ||
    identity.tabId.length > 256
  ) return null
  if (value.capability !== undefined &&
      (typeof value.capability !== 'string' || !tokenPattern.test(value.capability))) return null
  if (value.lease !== undefined &&
      (typeof value.lease !== 'string' || !tokenPattern.test(value.lease))) return null
  if (value.recoveryTicket !== undefined &&
      (typeof value.recoveryTicket !== 'string' || !tokenPattern.test(value.recoveryTicket))) return null
  if (value.nextRecoveryTicket !== undefined &&
      (typeof value.nextRecoveryTicket !== 'string' || !tokenPattern.test(value.nextRecoveryTicket))) return null
  if (value.recoveryAttemptId !== undefined &&
      (typeof value.recoveryAttemptId !== 'string' || !tokenPattern.test(value.recoveryAttemptId))) return null
  if (value.sessionId !== undefined &&
      (typeof value.sessionId !== 'string' || !uuidPattern.test(value.sessionId))) return null
  if (value.expectedVersion !== undefined &&
      (typeof value.expectedVersion !== 'number' ||
       !Number.isSafeInteger(value.expectedVersion) ||
       value.expectedVersion < 1)) return null
  if (value.payload !== undefined && !isRecord(value.payload)) return null

  return {
    action: value.action,
    identity: {
      userId: identity.userId,
      deviceId: identity.deviceId,
      tabId: identity.tabId,
    },
    pageInstanceId: value.pageInstanceId,
    ...(typeof value.capability === 'string' ? { capability: value.capability } : {}),
    ...(typeof value.recoveryTicket === 'string' ? { recoveryTicket: value.recoveryTicket } : {}),
    ...(typeof value.nextRecoveryTicket === 'string'
      ? { nextRecoveryTicket: value.nextRecoveryTicket }
      : {}),
    ...(typeof value.recoveryAttemptId === 'string'
      ? { recoveryAttemptId: value.recoveryAttemptId }
      : {}),
    ...(typeof value.lease === 'string' ? { lease: value.lease } : {}),
    ...(typeof value.sessionId === 'string' ? { sessionId: value.sessionId } : {}),
    ...(typeof value.expectedVersion === 'number' ? { expectedVersion: value.expectedVersion } : {}),
    ...(isRecord(value.payload) ? { payload: value.payload } : {}),
  }
}

function safeRpcFailure(error: { code?: string; message?: string } | null): Response {
  if (error?.code === '40001') {
    return response(409, { code: '40001', message: 'Exam session version conflict.' })
  }
  if (error?.code === 'P0001' && error.message === 'exam_capability_expired') {
    return response(401, {
      code: 'exam_capability_expired',
      message: 'Exam session capability expired.',
    })
  }
  return response(403, { code: 'exam_session_request_rejected', message: 'Exam session request was rejected.' })
}

function defaultCreateServiceClient(url: string, serviceRoleKey: string): ServiceRoleClient {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function dispatchExamSessionRequest(
  request: Request,
  env: { get(name: string): string | undefined },
  createServiceClient: (url: string, serviceRoleKey: string) => ServiceRoleClient,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return response(405, { message: 'Method not allowed.' })
  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > maxRequestBytes) {
    return response(413, { message: 'Exam session request is too large.' })
  }

  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  if (!match) return response(401, { message: 'Authentication required.' })

  const supabaseUrl = env.get('SUPABASE_URL')
  const serviceRoleKey = env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return response(503, { message: 'Exam session service is not configured.' })
  }

  const serviceClient = createServiceClient(supabaseUrl, serviceRoleKey)
  const { data: userData, error: authError } = await serviceClient.auth.getUser(match[1])
  if (authError || !userData.user) return response(401, { message: 'Authentication is invalid.' })

  const claims = decodeVerifiedClaims(match[1])
  const sessionId = claims?.session_id
  if (
    claims?.sub !== userData.user.id ||
    typeof sessionId !== 'string' ||
    !uuidPattern.test(sessionId)
  ) {
    return response(401, { message: 'Authentication session is invalid.' })
  }

  let body: RequestBody | null
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > maxRequestBytes) {
      return response(413, { message: 'Exam session request is too large.' })
    }
    body = validateBody(JSON.parse(raw) as unknown)
  } catch {
    return response(400, { message: 'Invalid request body.' })
  }
  if (!body) return response(400, { message: 'Invalid exam session request.' })
  if (body.identity.userId !== userData.user.id) {
    return response(403, { message: 'Exam session owner does not match the authenticated user.' })
  }
  if (request.headers.get('x-cityroute-device-fingerprint') !== body.identity.deviceId) {
    return response(403, { message: 'Exam session device identity does not match.' })
  }

  const register = body.action === 'tab.register'
  const acquireLease = body.action === 'lease.acquire'
  const renewLease = body.action === 'lease.renew'
  const recoverLease = body.action === 'lease.recover'
  const allowedActions = new Set([
    'tab.register',
    'tab.revoke',
    'lease.acquire',
    'lease.recover',
    'lease.renew',
    'lease.release',
    'session.create',
    'session.get',
    'session.list',
    'session.update',
    'session.finish',
    'session.abandon',
  ])
  if (!allowedActions.has(body.action)) return response(400, { message: 'Unknown exam session operation.' })
  if (!body.capability) {
    return response(400, { message: 'Exam session capability is required.' })
  }
  if (!body.lease) {
    return response(400, { message: 'Exam session lease is required.' })
  }
  if (
    (register && !body.recoveryTicket) ||
    (recoverLease &&
      (!body.recoveryTicket || !body.nextRecoveryTicket || !body.recoveryAttemptId)) ||
    (!register && !recoverLease && body.action !== 'tab.revoke' &&
      (body.recoveryTicket || body.nextRecoveryTicket || body.recoveryAttemptId)) ||
    (body.action === 'tab.revoke' && (!body.recoveryTicket ||
      body.nextRecoveryTicket || body.recoveryAttemptId))
  ) {
    return response(400, { message: 'Exam session recovery proof is invalid.' })
  }

  const capability = body.capability
  const lease = body.lease
  const [capabilityHash, pageInstanceHash, leaseHash, recoveryTicketHash,
    nextRecoveryTicketHash, recoveryAttemptHash] = await Promise.all([
    sha256Hex(capability),
    sha256Hex(body.pageInstanceId),
    lease ? sha256Hex(lease) : Promise.resolve(null),
    body.recoveryTicket ? sha256Hex(body.recoveryTicket) : Promise.resolve(null),
    body.nextRecoveryTicket ? sha256Hex(body.nextRecoveryTicket) : Promise.resolve(null),
    body.recoveryAttemptId ? sha256Hex(body.recoveryAttemptId) : Promise.resolve(null),
  ])
  if (
    !hashPattern.test(capabilityHash) ||
    !hashPattern.test(pageInstanceHash) ||
    (leaseHash !== null && !hashPattern.test(leaseHash)) ||
    (recoveryTicketHash !== null && !hashPattern.test(recoveryTicketHash)) ||
    (nextRecoveryTicketHash !== null && !hashPattern.test(nextRecoveryTicketHash)) ||
    (recoveryAttemptHash !== null && !hashPattern.test(recoveryAttemptHash))
  ) {
    return response(500, { message: 'Unable to establish the exam session security context.' })
  }

  const { data, error } = await serviceClient.rpc('exam_edge_dispatch', {
    p_action: body.action,
    p_user_id: userData.user.id,
    p_auth_session_id: sessionId,
    p_device_id: body.identity.deviceId,
    p_tab_id: body.identity.tabId,
    p_capability_hash: capabilityHash,
    p_page_instance_hash: pageInstanceHash,
    p_lease_hash: leaseHash,
    p_session_id: body.sessionId ?? null,
    p_expected_version: body.expectedVersion ?? null,
    p_payload: body.payload ?? {},
    p_lease_ttl_seconds: leaseTtlSeconds,
    p_capability_ttl_seconds: capabilityTtlSeconds,
    p_recovery_ticket_hash: recoveryTicketHash,
    p_next_recovery_ticket_hash: nextRecoveryTicketHash,
    p_recovery_attempt_hash: recoveryAttemptHash,
  })
  if (error) return safeRpcFailure(error)

  if (register || acquireLease) {
    const leaseExpiresAt = isRecord(data) ? data.lease_expires_at : undefined
    if (typeof leaseExpiresAt !== 'string') {
      return response(500, { message: 'Exam session lease response is invalid.' })
    }
    return response(200, {
      capability,
      lease,
      leaseExpiresAt,
    })
  }

  if (renewLease || recoverLease) {
    const leaseExpiresAt = isRecord(data) ? data.lease_expires_at : undefined
    if (typeof leaseExpiresAt !== 'string') {
      return response(500, { message: 'Exam session lease response is invalid.' })
    }
    return response(200, { leaseExpiresAt })
  }

  return response(200, data)
}

export function handleExamSessionRequest(
  request: Request,
  dependencies: ExamSessionApiDependencies = {},
): Promise<Response> {
  const env = dependencies.env ?? Deno.env
  const createServiceClient = dependencies.createServiceClient ?? defaultCreateServiceClient
  const logError = dependencies.logError ?? ((message: string) => console.error(message))
  return dispatchExamSessionRequest(request, env, createServiceClient).catch(() => {
    logError('Exam session request failed.')
    return response(500, { message: 'Exam session request could not be processed.' })
  })
}
