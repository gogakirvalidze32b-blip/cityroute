import { handleExamSessionRequest } from './handler.ts'

const userId = '11111111-1111-4111-8111-111111111111'
const otherUserId = '33333333-3333-4333-8333-333333333333'
const sessionId = '22222222-2222-4222-8222-222222222222'
const deviceId = 'device-12345678'
const tabId = 'tab-12345678'
const pageToken = 'a'.repeat(43)
const capabilityToken = 'b'.repeat(43)
const leaseToken = 'c'.repeat(43)
const recoveryTicketToken = 'd'.repeat(43)
const nextRecoveryTicketToken = 'e'.repeat(43)
const recoveryAttemptToken = 'f'.repeat(43)
const serviceRoleKey = 'test-service-role-key'
const supabaseUrl = 'https://example.test'

function encode(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
}

function jwtFor(sub: string, authSessionId: string): string {
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub, session_id: authSessionId })}.signature`
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    action: 'session.get',
    identity: { userId, deviceId, tabId },
    pageInstanceId: pageToken,
    capability: capabilityToken,
    lease: leaseToken,
    ...overrides,
  }
}

function post(
  body: unknown,
  options: { authorization?: string | null; device?: string | null } = {},
): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.authorization !== null) {
    headers.set('authorization', options.authorization ?? `Bearer ${jwtFor(userId, sessionId)}`)
  }
  if (options.device !== null) {
    headers.set('x-cityroute-device-fingerprint', options.device ?? deviceId)
  }
  return new Request('https://example.test/functions/v1/exam-session-api', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

function envFrom(values: Record<string, string | undefined>) {
  return { get: (name: string) => values[name] }
}

const configuredEnv = envFrom({
  SUPABASE_URL: supabaseUrl,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
})

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null }

function mockClient(options: {
  userId?: string
  authError?: { message?: string } | null
  rpcResult?: RpcResult
  throwOn?: 'create' | 'getUser' | 'rpc'
} = {}) {
  let created = 0
  const seenJwts: string[] = []
  const seenRpcs: string[] = []
  const createServiceClient = (url: string, key: string) => {
    created += 1
    if (url !== supabaseUrl || key !== serviceRoleKey) {
      throw new Error('service client was not created with the server environment')
    }
    if (options.throwOn === 'create') throw new Error(`create failed ${serviceRoleKey}`)
    return {
      auth: {
        getUser: (jwt: string) => {
          seenJwts.push(jwt)
          if (options.throwOn === 'getUser') throw new Error(`getUser failed ${serviceRoleKey}`)
          return Promise.resolve({
            data: { user: options.authError ? null : { id: options.userId ?? userId } },
            error: options.authError ?? null,
          })
        },
      },
      rpc: (name: string, _args: Record<string, unknown>) => {
        seenRpcs.push(name)
        if (options.throwOn === 'rpc') throw new Error(`rpc failed ${serviceRoleKey}`)
        return Promise.resolve(options.rpcResult ?? { data: { ok: true }, error: null })
      },
    }
  }
  return {
    createServiceClient,
    created: () => created,
    jwts: () => seenJwts,
    rpcs: () => seenRpcs,
  }
}

function assertExactBearer(client: { jwts(): string[] }, authorization: string) {
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
  const seen = client.jwts()
  if (!bearer || seen.length !== 1 || seen[0] !== bearer) {
    throw new Error('getUser did not receive the exact request bearer token')
  }
}

function assertDispatchName(client: { rpcs(): string[] }) {
  const seen = client.rpcs()
  if (seen.length !== 1 || seen[0] !== 'exam_edge_dispatch') {
    throw new Error('RPC was not called as exam_edge_dispatch')
  }
}

function assertStatus(response: Response, status: number) {
  if (response.status !== status) {
    throw new Error(`expected status ${status} but got ${response.status}`)
  }
}

function assertTextHidden(text: string, logs: string[]) {
  if (text.includes(serviceRoleKey) || logs.some((entry) => entry.includes(serviceRoleKey))) {
    throw new Error('service role key appeared in handler output')
  }
}

Deno.test('missing Authorization header is rejected before a service client exists', async () => {
  const client = mockClient()
  const response = await handleExamSessionRequest(post(validBody(), { authorization: null }), {
    env: configuredEnv,
    createServiceClient: client.createServiceClient,
  })
  assertStatus(response, 401)
  const body = await response.json()
  if (body.message !== 'Authentication required.') throw new Error('unexpected authentication message')
  if (client.created() !== 0) throw new Error('service client was created without authorization')
})

Deno.test('invalid JWT is rejected', async () => {
  const bearer = 'not-a-jwt'
  const client = mockClient({ authError: { message: `bad signature ${serviceRoleKey}` } })
  const response = await handleExamSessionRequest(post(validBody(), {
    authorization: `Bearer ${bearer}`,
  }), {
    env: configuredEnv,
    createServiceClient: client.createServiceClient,
  })
  assertStatus(response, 401)
  assertExactBearer(client, `Bearer ${bearer}`)
  const body = await response.json()
  if (body.message !== 'Authentication is invalid.') throw new Error('unexpected invalid JWT message')
  if (JSON.stringify(body).includes(serviceRoleKey)) throw new Error('service role key appeared in handler output')
})

Deno.test('a verified token without a session claim is rejected', async () => {
  const token = `${encode({ alg: 'none' })}.${encode({ sub: userId })}.signature`
  const client = mockClient()
  const response = await handleExamSessionRequest(post(validBody(), {
    authorization: `Bearer ${token}`,
  }), {
    env: configuredEnv,
    createServiceClient: client.createServiceClient,
  })
  assertStatus(response, 401)
  assertExactBearer(client, `Bearer ${token}`)
  const body = await response.json()
  if (body.message !== 'Authentication session is invalid.') throw new Error('unexpected session message')
})

Deno.test('missing environment variables do not create a service client', async () => {
  const client = mockClient()
  const missingUrl = await handleExamSessionRequest(post(validBody()), {
    env: envFrom({ SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey }),
    createServiceClient: client.createServiceClient,
  })
  const missingKey = await handleExamSessionRequest(post(validBody()), {
    env: envFrom({ SUPABASE_URL: supabaseUrl }),
    createServiceClient: client.createServiceClient,
  })
  assertStatus(missingUrl, 503)
  assertStatus(missingKey, 503)
  if (client.created() !== 0) throw new Error('service client was created without configuration')
  assertTextHidden(await missingUrl.text(), [])
  assertTextHidden(await missingKey.text(), [])
})

Deno.test('valid authenticated request dispatches only the verified user, device, and tab', async () => {
  const token = jwtFor(userId, sessionId)
  let seenJwt = ''
  let rpcName = ''
  let rpcArgs: Record<string, unknown> | null = null
  const response = await handleExamSessionRequest(post(validBody(), {
    authorization: `Bearer ${token}`,
  }), {
    env: configuredEnv,
    createServiceClient: () => ({
      auth: {
        getUser: (jwt: string) => {
          seenJwt = jwt
          return Promise.resolve({ data: { user: { id: userId } }, error: null })
        },
      },
      rpc: (name: string, args: Record<string, unknown>) => {
        rpcName = name
        rpcArgs = args
        return Promise.resolve({ data: { session_id: sessionId, status: 'active' }, error: null })
      },
    }),
  })
  assertStatus(response, 200)
  if (seenJwt !== token) throw new Error('getUser did not receive the exact request bearer token')
  if (rpcName !== 'exam_edge_dispatch') throw new Error('RPC was not called as exam_edge_dispatch')
  const body = await response.json()
  if (body.session_id !== sessionId || body.status !== 'active') throw new Error('unexpected session response')
  if (!rpcArgs) throw new Error('exam dispatch was not called')
  const args = rpcArgs as Record<string, unknown>
  if (args.p_user_id !== userId || args.p_device_id !== deviceId || args.p_tab_id !== tabId) {
    throw new Error('dispatch identity did not match the authenticated request')
  }
  if (args.p_auth_session_id !== sessionId) throw new Error('dispatch did not use the token session')
  if (
    args.p_capability_hash !== await sha256Hex(capabilityToken) ||
    args.p_page_instance_hash !== await sha256Hex(pageToken) ||
    args.p_lease_hash !== await sha256Hex(leaseToken)
  ) {
    throw new Error(
      'raw tab security tokens were not replaced with their SHA-256 verifiers',
    )
  }
  const serializedArgs = JSON.stringify(args)
  if (
    [capabilityToken, pageToken, leaseToken].some((token) =>
      serializedArgs.includes(token)
    )
  ) {
    throw new Error('raw tab security token reached the database RPC')
  }
  assertTextHidden(JSON.stringify(body), [])
})

Deno.test('unknown actions are rejected without dispatching an RPC', async () => {
  const client = mockClient()
  const response = await handleExamSessionRequest(
    post(validBody({ action: 'session.delete' })),
    {
      env: configuredEnv,
      createServiceClient: client.createServiceClient,
    },
  )
  assertStatus(response, 400)
  const body = await response.json()
  if (body.message !== 'Unknown exam session operation.') {
    throw new Error('unexpected unknown-action response')
  }
  if (client.rpcs().length !== 0) {
    throw new Error('unknown action reached the database RPC')
  }
})

Deno.test('recovery tokens are hashed before dispatch and are never echoed', async () => {
  const token = jwtFor(userId, sessionId)
  let rpcArgs: Record<string, unknown> | null = null
  const response = await handleExamSessionRequest(post(validBody({
    action: 'lease.recover',
    recoveryTicket: recoveryTicketToken,
    nextRecoveryTicket: nextRecoveryTicketToken,
    recoveryAttemptId: recoveryAttemptToken,
  }), {
    authorization: `Bearer ${token}`,
  }), {
    env: configuredEnv,
    createServiceClient: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: userId } }, error: null }),
      },
      rpc: (_name: string, args: Record<string, unknown>) => {
        rpcArgs = args
        return Promise.resolve({
          data: { lease_expires_at: new Date(Date.now() + 90_000).toISOString() },
          error: null,
        })
      },
    }),
  })

  assertStatus(response, 200)
  const body = await response.json()
  if (typeof body.leaseExpiresAt !== 'string') throw new Error('recovery response is missing its lease expiry')
  if (!rpcArgs) throw new Error('recovery did not dispatch')
  const args = rpcArgs as Record<string, unknown>
  if (
    args.p_recovery_ticket_hash !== await sha256Hex(recoveryTicketToken) ||
    args.p_next_recovery_ticket_hash !== await sha256Hex(nextRecoveryTicketToken) ||
    args.p_recovery_attempt_hash !== await sha256Hex(recoveryAttemptToken)
  ) {
    throw new Error('recovery proof was not replaced by its SHA-256 verifier')
  }
  const serialized = JSON.stringify({ args, body })
  if (
    [recoveryTicketToken, nextRecoveryTicketToken, recoveryAttemptToken]
      .some((value) => serialized.includes(value))
  ) {
    throw new Error('raw recovery proof reached the RPC arguments or response')
  }
})

Deno.test('recovery requests require all three single-use proofs', async () => {
  const client = mockClient()
  const response = await handleExamSessionRequest(post(validBody({
    action: 'lease.recover',
    recoveryTicket: recoveryTicketToken,
  })), {
    env: configuredEnv,
    createServiceClient: client.createServiceClient,
  })
  assertStatus(response, 400)
  if (client.rpcs().length !== 0) throw new Error('incomplete recovery reached the RPC')
})

Deno.test('tab revocation hashes its recovery ticket and current lease', async () => {
  const token = jwtFor(userId, sessionId)
  let rpcArgs: Record<string, unknown> | null = null
  const response = await handleExamSessionRequest(post(validBody({
    action: 'tab.revoke',
    recoveryTicket: recoveryTicketToken,
  }), {
    authorization: `Bearer ${token}`,
  }), {
    env: configuredEnv,
    createServiceClient: () => ({
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: userId } }, error: null }),
      },
      rpc: (_name: string, args: Record<string, unknown>) => {
        rpcArgs = args
        return Promise.resolve({ data: { revoked: true }, error: null })
      },
    }),
  })

  assertStatus(response, 200)
  if (!rpcArgs) throw new Error('tab revocation did not dispatch')
  const args = rpcArgs as Record<string, unknown>
  if (args.p_lease_hash !== await sha256Hex(leaseToken)) {
    throw new Error('tab revocation did not hash its current lease')
  }
  if (args.p_recovery_ticket_hash !== await sha256Hex(recoveryTicketToken)) {
    throw new Error('tab revocation did not hash its recovery ticket')
  }
})

Deno.test('user and device mismatches are rejected', async () => {
  const client = mockClient()
  const userMismatch = await handleExamSessionRequest(post(validBody({
    identity: { userId: otherUserId, deviceId, tabId },
  })), {
    env: configuredEnv,
    createServiceClient: client.createServiceClient,
  })
  const deviceMismatch = await handleExamSessionRequest(post(validBody(), {
    device: 'other-device-1234',
  }), {
    env: configuredEnv,
    createServiceClient: client.createServiceClient,
  })
  assertStatus(userMismatch, 403)
  assertStatus(deviceMismatch, 403)
  const userBody = await userMismatch.json()
  const deviceBody = await deviceMismatch.json()
  if (userBody.message !== 'Exam session owner does not match the authenticated user.') {
    throw new Error('unexpected user mismatch message')
  }
  if (deviceBody.message !== 'Exam session device identity does not match.') {
    throw new Error('unexpected device mismatch message')
  }
})

Deno.test('missing or invalid tab identity is rejected', async () => {
  const client = mockClient()
  const missingTab = await handleExamSessionRequest(post(validBody({
    identity: { userId, deviceId },
  })), {
    env: configuredEnv,
    createServiceClient: client.createServiceClient,
  })
  const shortTab = await handleExamSessionRequest(post(validBody({
    identity: { userId, deviceId, tabId: 'short' },
  })), {
    env: configuredEnv,
    createServiceClient: client.createServiceClient,
  })
  assertStatus(missingTab, 400)
  assertStatus(shortTab, 400)
  const missingBody = await missingTab.json()
  const shortBody = await shortTab.json()
  if (missingBody.message !== 'Invalid exam session request.' || shortBody.message !== 'Invalid exam session request.') {
    throw new Error('unexpected tab validation message')
  }
})

Deno.test('Supabase RPC errors use safe status codes and do not echo the service role key', async () => {
  const conflict = mockClient({
    rpcResult: { data: null, error: { code: '40001', message: serviceRoleKey } },
  })
  const expired = mockClient({
    rpcResult: { data: null, error: { code: 'P0001', message: 'exam_capability_expired' } },
  })
  const rejected = mockClient({
    rpcResult: { data: null, error: { code: '42501', message: `denied ${serviceRoleKey}` } },
  })
  const dependencies = { env: configuredEnv }
  const conflictResponse = await handleExamSessionRequest(post(validBody()), {
    ...dependencies,
    createServiceClient: conflict.createServiceClient,
  })
  const expiredResponse = await handleExamSessionRequest(post(validBody()), {
    ...dependencies,
    createServiceClient: expired.createServiceClient,
  })
  const rejectedResponse = await handleExamSessionRequest(post(validBody()), {
    ...dependencies,
    createServiceClient: rejected.createServiceClient,
  })
  assertStatus(conflictResponse, 409)
  assertStatus(expiredResponse, 401)
  assertStatus(rejectedResponse, 403)
  const conflictBody = await conflictResponse.json()
  const expiredBody = await expiredResponse.json()
  const rejectedBody = await rejectedResponse.json()
  if (conflictBody.code !== '40001' || conflictBody.message !== 'Exam session version conflict.') {
    throw new Error('unexpected conflict response')
  }
  if (expiredBody.code !== 'exam_capability_expired') throw new Error('unexpected expiry response')
  if (rejectedBody.code !== 'exam_session_request_rejected') throw new Error('unexpected rejection response')
  assertDispatchName(conflict)
  assertDispatchName(expired)
  assertDispatchName(rejected)
  assertTextHidden(JSON.stringify(conflictBody), [])
  assertTextHidden(JSON.stringify(expiredBody), [])
  assertTextHidden(JSON.stringify(rejectedBody), [])
})

Deno.test('a successful RPC response does not add the service role key to the HTTP response', async () => {
  const token = jwtFor(userId, sessionId)
  const rpcData = { session_id: sessionId, status: 'active', detail: 'checkout accepted' }
  let seenJwt = ''
  let rpcName = ''
  const response = await handleExamSessionRequest(post(validBody(), {
    authorization: `Bearer ${token}`,
  }), {
    env: configuredEnv,
    createServiceClient: (_url: string, key: string) => {
      if (key !== serviceRoleKey) throw new Error('service client was not created with the server environment')
      return {
        auth: {
          getUser: (jwt: string) => {
            seenJwt = jwt
            return Promise.resolve({ data: { user: { id: userId } }, error: null })
          },
        },
        rpc: (name: string) => {
          rpcName = name
          return Promise.resolve({ data: rpcData, error: null })
        },
      }
    },
  })
  assertStatus(response, 200)
  if (seenJwt !== token) throw new Error('getUser did not receive the exact request bearer token')
  if (rpcName !== 'exam_edge_dispatch') throw new Error('RPC was not called as exam_edge_dispatch')
  const text = await response.text()
  if (text !== JSON.stringify(rpcData)) throw new Error('HTTP response did not match the successful RPC data')
  assertTextHidden(text, [])
})

Deno.test('unexpected internal errors return a generic response and a safe log', async () => {
  const logs: string[] = []
  const response = await handleExamSessionRequest(post(validBody()), {
    env: configuredEnv,
    createServiceClient: () => {
      throw new Error(`database connection failed ${serviceRoleKey}`)
    },
    logError: (message) => logs.push(message),
  })
  assertStatus(response, 500)
  const body = await response.json()
  if (body.message !== 'Exam session request could not be processed.') {
    throw new Error('unexpected internal error message')
  }
  if (logs.length !== 1 || logs[0] !== 'Exam session request failed.') {
    throw new Error('internal error log was not the safe message')
  }
  assertTextHidden(JSON.stringify(body), logs)
})
