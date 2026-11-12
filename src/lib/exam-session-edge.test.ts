import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSupabase } from '@/lib/supabase'
import {
  createRemoteExamSession,
  getRemoteExamSession,
  listRemoteExamSessions,
  releaseExamTabLease,
  revokeExamTab,
  RemoteExamSessionWriter,
  shouldUseRemoteExamSessionBackend,
  type ExamSessionTabIdentity,
} from './exam-session-edge'

type MockSession = Record<string, unknown> & {
  session_id: string
  capability_id: string
  status: string
  version: number
}

const h = vi.hoisted(() => ({
  sessions: new Map<string, MockSession>(),
  capabilities: new Map<string, string>(),
  leases: new Map<string, { pageInstanceId: string; lease: string; expiresAt: number }>(),
  recoveryTickets: new Map<string, string>(),
  recoveryAttempts: new Map<string, {
    attemptId: string
    pageInstanceId: string
    lease: string
  }>(),
  revokedCapabilities: new Set<string>(),
  expiredCapabilities: new Set<string>(),
  calls: [] as Array<{
    action: string
    body: Record<string, unknown>
    headers: Record<string, string>
  }>,
  activeDevices: new Map<string, string[]>(),
  packageLimits: new Map<string, number>(),
  overrides: new Map<string, number>(),
  nextId: 1,
}))

describe('Exam Session backend environment gate', () => {
  it('enables remote Exam Session requests only on Vercel Preview', () => {
    expect(shouldUseRemoteExamSessionBackend('preview')).toBe(true)
    expect(shouldUseRemoteExamSessionBackend('production')).toBe(false)
    expect(shouldUseRemoteExamSessionBackend('development')).toBe(false)
    expect(shouldUseRemoteExamSessionBackend(undefined)).toBe(false)
  })
})

function capabilityFor(userId: string, deviceId: string, tabId: string): string {
  return `${userId}:${deviceId}:${tabId}`
}

function verifyMockDeviceLimit(userId: string, deviceId: string): void {
  const devices = h.activeDevices.get(userId) ?? []
  const limit = h.overrides.get(userId) ?? h.packageLimits.get(userId) ?? 1
  const uniqueDevices = [...new Set(devices)]
  if (!uniqueDevices.includes(deviceId) || uniqueDevices.indexOf(deviceId) >= limit) {
    throw new Error('device_limit_exceeded')
  }
}

function verifyMockLease(body: Record<string, unknown>): string {
  const identity = body.identity as ExamSessionTabIdentity
  const cap = body.capability
  const lease = body.lease
  const pageInstanceId = body.pageInstanceId
  const capabilityId = capabilityFor(identity.userId, identity.deviceId, identity.tabId)
  const currentLease = typeof cap === 'string' ? h.leases.get(cap) : undefined
  if (
    typeof cap !== 'string' ||
    h.capabilities.get(capabilityId) !== cap ||
    typeof lease !== 'string' ||
    currentLease?.lease !== lease ||
    currentLease?.pageInstanceId !== pageInstanceId ||
    (currentLease?.expiresAt ?? 0) <= Date.now()
  ) {
    throw new Error('tab_lease_invalid')
  }
  verifyMockDeviceLimit(identity.userId, identity.deviceId)
  return cap
}

async function invokeLeaseAction(
  tab: ExamSessionTabIdentity,
  action: 'lease.acquire' | 'lease.renew' | 'lease.release' | 'tab.register' | 'tab.revoke',
  pageInstanceId: string,
  lease: string,
  capability = h.capabilities.get(capabilityFor(tab.userId, tab.deviceId, tab.tabId))!,
) {
  try {
    return await getSupabase().functions.invoke<unknown>('exam-session-api', {
      body: {
        action,
        identity: tab,
        pageInstanceId,
        capability,
        ...(action === 'tab.register' ? { recoveryTicket: 'r'.repeat(43) } : {}),
        ...(action === 'tab.revoke'
          ? { recoveryTicket: h.recoveryTickets.get(capability) }
          : {}),
        ...(action === 'tab.revoke' ? {} : { lease }),
      },
      headers: { 'x-cityroute-device-fingerprint': tab.deviceId },
    })
  } catch (error) {
    return { data: null, error }
  }
}

async function invokeRecovery(
  tab: ExamSessionTabIdentity,
  pageInstanceId: string,
  lease: string,
  recoveryTicket: string,
  nextRecoveryTicket: string,
  recoveryAttemptId: string,
  capability = h.capabilities.get(capabilityFor(tab.userId, tab.deviceId, tab.tabId))!,
) {
  return getSupabase().functions.invoke<unknown>('exam-session-api', {
    body: {
      action: 'lease.recover',
      identity: tab,
      pageInstanceId,
      capability,
      recoveryTicket,
      nextRecoveryTicket,
      recoveryAttemptId,
      lease,
    },
    headers: { 'x-cityroute-device-fingerprint': tab.deviceId },
  })
}

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: async () => {
      throw new Error('Browser must not call exam-session RPCs directly.')
    },
    functions: {
      invoke: async (_name: string, options: { body: unknown; headers?: Record<string, string> }) => {
        const body = options.body as Record<string, unknown>
        const identity = body.identity as ExamSessionTabIdentity
        const action = String(body.action)
        h.calls.push({ action, body, headers: options.headers ?? {} })

        if (action === 'tab.register') {
          verifyMockDeviceLimit(identity.userId, identity.deviceId)
          const cap = String(body.capability)
          const capKey = capabilityFor(identity.userId, identity.deviceId, identity.tabId)
          const priorCapability = h.capabilities.get(capKey)
          const currentLease = priorCapability ? h.leases.get(priorCapability) : undefined
          if (
            priorCapability &&
            !h.expiredCapabilities.has(priorCapability) &&
            !h.revokedCapabilities.has(priorCapability) &&
            (priorCapability !== cap ||
              h.recoveryTickets.get(priorCapability) !== body.recoveryTicket ||
              (currentLease &&
                (currentLease.pageInstanceId !== body.pageInstanceId ||
                  currentLease.lease !== body.lease)))
          ) {
            return { data: null, error: new Error('exam_tab_already_registered') }
          }
          if (h.revokedCapabilities.has(priorCapability ?? '') && priorCapability === cap) {
            return { data: null, error: new Error('capability_invalid') }
          }
          h.capabilities.set(capKey, cap)
          h.recoveryTickets.set(cap, String(body.recoveryTicket))
          h.revokedCapabilities.delete(cap)
          h.leases.set(cap, {
            pageInstanceId: String(body.pageInstanceId),
            lease: String(body.lease),
            expiresAt: Date.now() + 90_000,
          })
          return {
            data: {
              capability: cap,
              lease: body.lease,
              leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(),
            },
            error: null,
          }
        }

        if (action === 'lease.recover') {
          verifyMockDeviceLimit(identity.userId, identity.deviceId)
          const cap = String(body.capability)
          const capKey = capabilityFor(identity.userId, identity.deviceId, identity.tabId)
          if (
            h.capabilities.get(capKey) !== cap ||
            h.revokedCapabilities.has(cap)
          ) {
            return { data: null, error: new Error('capability_invalid') }
          }
          if (h.expiredCapabilities.has(cap)) {
            return {
              data: null,
              error: Object.assign(new Error('Exam session capability expired.'), {
                code: 'exam_capability_expired',
              }),
            }
          }
          const attempt = h.recoveryAttempts.get(cap)
          const currentLease = h.leases.get(cap)
          if (
            h.recoveryTickets.get(cap) === body.nextRecoveryTicket &&
            attempt?.attemptId === body.recoveryAttemptId &&
            attempt.pageInstanceId === body.pageInstanceId &&
            attempt.lease === body.lease &&
            currentLease?.pageInstanceId === body.pageInstanceId &&
            currentLease.lease === body.lease
          ) {
            currentLease.expiresAt = Date.now() + 90_000
            return {
              data: { leaseExpiresAt: new Date(currentLease.expiresAt).toISOString() },
              error: null,
            }
          }
          if (h.recoveryTickets.get(cap) !== body.recoveryTicket) {
            return { data: null, error: new Error('exam_recovery_ticket_invalid') }
          }
          h.recoveryTickets.set(cap, String(body.nextRecoveryTicket))
          h.recoveryAttempts.set(cap, {
            attemptId: String(body.recoveryAttemptId),
            pageInstanceId: String(body.pageInstanceId),
            lease: String(body.lease),
          })
          const expiresAt = Date.now() + 90_000
          h.leases.set(cap, {
            pageInstanceId: String(body.pageInstanceId),
            lease: String(body.lease),
            expiresAt,
          })
          return { data: { leaseExpiresAt: new Date(expiresAt).toISOString() }, error: null }
        }

        if (action === 'lease.acquire') {
          verifyMockDeviceLimit(identity.userId, identity.deviceId)
          const cap = String(body.capability)
          if (h.expiredCapabilities.has(cap)) {
            return {
              data: null,
              error: Object.assign(new Error('Exam session capability expired.'), {
                code: 'exam_capability_expired',
              }),
            }
          }
          if (h.capabilities.get(capabilityFor(identity.userId, identity.deviceId, identity.tabId)) !== cap) {
            return { data: null, error: new Error('capability_invalid') }
          }
          const currentLease = h.leases.get(cap)
          if (
            !currentLease ||
            currentLease.pageInstanceId !== body.pageInstanceId ||
            currentLease.lease !== body.lease
          ) {
            return { data: null, error: new Error('exam_recovery_ticket_required') }
          }
          h.leases.set(cap, {
            pageInstanceId: String(body.pageInstanceId),
            lease: String(body.lease),
            expiresAt: Date.now() + 90_000,
          })
          return {
            data: {
              capability: cap,
              lease: body.lease,
              leaseExpiresAt: new Date(Date.now() + 90_000).toISOString(),
            },
            error: null,
          }
        }

        if (action === 'lease.renew') {
          const cap = verifyMockLease(body)
          const lease = h.leases.get(cap)!
          lease.expiresAt = Date.now() + 90_000
          return {
            data: { leaseExpiresAt: new Date(lease.expiresAt).toISOString() },
            error: null,
          }
        }

        if (action === 'lease.release') {
          const cap = verifyMockLease(body)
          h.leases.delete(cap)
          return { data: { released: true }, error: null }
        }

        if (action === 'tab.revoke') {
          const cap = verifyMockLease(body)
          const capKey = capabilityFor(identity.userId, identity.deviceId, identity.tabId)
          if (
            h.capabilities.get(capKey) !== cap ||
            h.recoveryTickets.get(cap) !== body.recoveryTicket
          ) {
            return { data: null, error: new Error('exam_recovery_ticket_invalid') }
          }
          h.revokedCapabilities.add(cap)
          h.leases.delete(cap)
          return { data: { revoked: true }, error: null }
        }

        const cap = verifyMockLease(body)
        if (action === 'session.create') {
          const payload = body.payload as Record<string, unknown>
          const id = `exam-${h.nextId++}`
          const session: MockSession = {
            session_id: id,
            capability_id: cap,
            user_id: identity.userId,
            device_id: identity.deviceId,
            tab_id: identity.tabId,
            route_slug: payload.routeSlug,
            status: 'active',
            version: 1,
            progress: payload.progress,
            errors: payload.errors,
            elapsed_ms: payload.elapsedMs,
            summary: null,
            started_at: payload.startedAt,
            updated_at: new Date().toISOString(),
          }
          h.sessions.set(id, session)
          return { data: session, error: null }
        }

        if (action === 'session.list') {
          return {
            data: [...h.sessions.values()].filter(
              (session) =>
                session.user_id === identity.userId &&
                session.device_id === identity.deviceId &&
                session.tab_id === identity.tabId &&
                (session.status === 'active' || session.status === 'paused'),
            ),
            error: null,
          }
        }

        const sessionId = String(body.sessionId)
        const session = h.sessions.get(sessionId)
        if (
          !session ||
          session.user_id !== identity.userId ||
          session.device_id !== identity.deviceId ||
          session.tab_id !== identity.tabId
        ) {
          return { data: null, error: new Error('session_not_found') }
        }
        if (action === 'session.get') return { data: session, error: null }

        if (session.version !== body.expectedVersion) {
          return { data: null, error: { code: '40001', message: 'version_conflict' } }
        }
        if (session.status === 'completed' || session.status === 'abandoned') {
          return { data: null, error: new Error('terminal_session') }
        }

        const next: MockSession = { ...session, version: session.version + 1 }
        const payload = (body.payload ?? {}) as Record<string, unknown>
        if (action === 'session.update') Object.assign(next, payload)
        if (action === 'session.finish') Object.assign(next, payload, { status: 'completed' })
        if (action === 'session.abandon') Object.assign(next, { status: 'abandoned' })
        h.sessions.set(sessionId, next)
        return { data: next, error: null }
      },
    },
  }),
}))

function identity(userId: string, deviceId: string, tabId: string): ExamSessionTabIdentity {
  return { userId, deviceId, tabId }
}

async function createSession(
  tab: ExamSessionTabIdentity,
  migrationKey: string,
  routeSlug = 'route-1',
  handledPins: number[] = [],
) {
  return createRemoteExamSession({
    userId: tab.userId,
    routeSlug,
    deviceId: tab.deviceId,
    tabId: tab.tabId,
    progress: { route: routeSlug, handledPins },
    errors: {},
    elapsedMs: 1000,
    startedAt: new Date(1000).toISOString(),
    migrationKey,
  })
}

describe('Edge-only tab-scoped exam sessions', () => {
  beforeEach(() => {
    h.sessions.clear()
    h.capabilities.clear()
    h.leases.clear()
    h.recoveryTickets.clear()
    h.recoveryAttempts.clear()
    h.revokedCapabilities.clear()
    h.expiredCapabilities.clear()
    h.calls.length = 0
    h.activeDevices.clear()
    h.packageLimits.clear()
    h.overrides.clear()
    h.nextId = 1
    sessionStorage.clear()
  })

  it('isolates two devices and multiple same-route tabs through save, refresh, finish, and abandon', async () => {
    const userId = 'account-two-device-1'
    const deviceA = identity(userId, 'physical-device-A', 'tab-A1')
    const deviceASecondTab = identity(userId, 'physical-device-A', 'tab-A2')
    const deviceB = identity(userId, 'physical-device-B', 'tab-B1')
    const deviceBSecondTab = identity(userId, 'physical-device-B', 'tab-B2')
    h.activeDevices.set(userId, [deviceA.deviceId, deviceB.deviceId])
    h.packageLimits.set(userId, 2)

    const sessions = await Promise.all([
      createSession(deviceA, 'a1-start', 'route-1', [1]),
      createSession(deviceASecondTab, 'a2-start', 'route-1', [1, 2]),
      createSession(deviceB, 'b1-start', 'route-1', [3]),
      createSession(deviceBSecondTab, 'b2-start', 'route-1', [4]),
    ])
    expect(new Set(sessions.map((session) => session.session_id)).size).toBe(4)

    const writers = sessions.map(
      (session, index) => new RemoteExamSessionWriter(
        session.session_id,
        session.version,
        [deviceA, deviceASecondTab, deviceB, deviceBSecondTab][index]!,
      ),
    )
    await Promise.all([
      writers[0]!.save('active', { route: 'route-1', handledPins: [1, 2] }, {}, 2000),
      writers[1]!.save('active', { route: 'route-1', handledPins: [1, 2, 3] }, {}, 3000),
      writers[2]!.save('active', { route: 'route-1', handledPins: [3, 4] }, {}, 4000),
      writers[3]!.save('active', { route: 'route-1', handledPins: [4, 5] }, {}, 5000),
    ])

    const restoredA = await listRemoteExamSessions(deviceA)
    const restoredA2 = await listRemoteExamSessions(deviceASecondTab)
    const restoredB = await listRemoteExamSessions(deviceB)
    const restoredB2 = await listRemoteExamSessions(deviceBSecondTab)
    expect(restoredA.map((session) => session.session_id)).toEqual([sessions[0]!.session_id])
    expect(restoredA2.map((session) => session.session_id)).toEqual([sessions[1]!.session_id])
    expect(restoredB.map((session) => session.session_id)).toEqual([sessions[2]!.session_id])
    expect(restoredB2.map((session) => session.session_id)).toEqual([sessions[3]!.session_id])

    await writers[0]!.finish({ route: 'route-1', handledPins: [1, 2] }, {}, 2000, { passed: true })
    await writers[1]!.abandon()
    expect(h.sessions.get(sessions[0]!.session_id)?.status).toBe('completed')
    expect(h.sessions.get(sessions[1]!.session_id)?.status).toBe('abandoned')
    expect(h.sessions.get(sessions[2]!.session_id)?.status).toBe('active')
    expect(h.sessions.get(sessions[3]!.session_id)?.status).toBe('active')

    const directRpcCalls = h.calls.filter((call) => call.action.startsWith('rpc:'))
    expect(directRpcCalls).toHaveLength(0)
    expect(h.calls.every((call) => call.action.startsWith('tab.') ||
      call.action.startsWith('lease.') || call.action.startsWith('session.'))).toBe(true)
    expect(h.calls.every((call) =>
      call.headers['x-cityroute-device-fingerprint'] ===
        (call.body.identity as ExamSessionTabIdentity).deviceId,
    )).toBe(true)
  })

  it('blocks a third physical device at the active package limit', async () => {
    const userId = 'account-device-limit-2'
    const first = identity(userId, 'device-1', 'tab-1')
    const second = identity(userId, 'device-2', 'tab-2')
    const third = identity(userId, 'device-3', 'tab-3')
    h.activeDevices.set(userId, [first.deviceId, second.deviceId, third.deviceId])
    h.packageLimits.set(userId, 2)

    await createSession(first, 'first')
    await createSession(second, 'second')
    await expect(createSession(third, 'third')).rejects.toThrow('device_limit_exceeded')
    expect(h.sessions.size).toBe(2)
  })

  it('uses the dynamic package limit and admin override without counting tabs as devices', async () => {
    const userId = 'account-dynamic-limit'
    const deviceA = identity(userId, 'device-A', 'tab-A')
    const deviceA2 = identity(userId, 'device-A', 'tab-A2')
    const deviceB = identity(userId, 'device-B', 'tab-B')
    const deviceC = identity(userId, 'device-C', 'tab-C')
    h.activeDevices.set(userId, [deviceA.deviceId, deviceB.deviceId, deviceC.deviceId])
    h.packageLimits.set(userId, 1)

    await createSession(deviceA, 'a-one')
    await createSession(deviceA2, 'a-two')
    expect(h.sessions.size).toBe(2)
    await expect(createSession(deviceB, 'b-blocked')).rejects.toThrow('device_limit_exceeded')

    h.packageLimits.set(userId, 2)
    await createSession(deviceB, 'b-package-upgrade')
    h.overrides.set(userId, 3)
    await createSession(deviceC, 'c-admin-override')
    expect(h.sessions.size).toBe(4)
  })

  it('does not expose sessions to a different capability, even on the same device and route', async () => {
    const userId = 'account-same-device-different-tabs'
    const tabA = identity(userId, 'same-device-fingerprint', 'browser-tab-A')
    const tabB = identity(userId, 'same-device-fingerprint', 'browser-tab-B')
    h.activeDevices.set(userId, [tabA.deviceId])
    h.packageLimits.set(userId, 1)
    const sessionA = await createSession(tabA, 'tab-A', 'route-1', [1])
    const sessionB = await createSession(tabB, 'tab-B', 'route-1', [1, 2])

    expect((await listRemoteExamSessions(tabA)).map((item) => item.session_id)).toEqual([
      sessionA.session_id,
    ])
    expect((await listRemoteExamSessions(tabB)).map((item) => item.session_id)).toEqual([
      sessionB.session_id,
    ])
    await expect(getRemoteExamSession(sessionB.session_id, tabA)).rejects.toThrow('session_not_found')
  })

  it('rejects stale concurrent writes and recovers only an identical acknowledged snapshot', async () => {
    const userId = 'account-version-conflict'
    const tab = identity(userId, 'device-version', 'tab-version')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    const session = await createSession(tab, 'versioned')
    const writerA = new RemoteExamSessionWriter(session.session_id, session.version, tab)
    const writerB = new RemoteExamSessionWriter(session.session_id, session.version, tab)

    await writerB.save('active', { route: 'route-1', handledPins: [1, 2] }, {}, 2000)
    await expect(
      writerA.save('active', { route: 'route-1', handledPins: [1, 3] }, {}, 3000),
    ).rejects.toMatchObject({ code: '40001' })
    expect(h.sessions.get(session.session_id)?.progress).toEqual({
      route: 'route-1',
      handledPins: [1, 2],
    })
  })

  it('reacquires a page-instance lease from the tab-scoped capability after refresh', async () => {
    const userId = 'account-refresh-lease'
    const tab = identity(userId, 'device-refresh', 'tab-refresh')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    const created = await createSession(tab, 'refresh')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    const previousLease = { ...h.leases.get(capability)! }
    const previousTicket = h.recoveryTickets.get(capability)!
    const callsBeforeRefresh = h.calls.length

    vi.resetModules()
    const refreshedRemote = await import('./exam-session-edge')
    const resumed = await refreshedRemote.listRemoteExamSessions(tab)

    expect(resumed.map((session) => session.session_id)).toEqual([created.session_id])
    expect(h.calls.slice(callsBeforeRefresh).map((call) => call.action)).toEqual([
      'lease.recover',
      'session.list',
    ])
    expect(h.recoveryTickets.get(capability)).not.toBe(previousTicket)
    expect(h.leases.get(capability)?.pageInstanceId).not.toBe(previousLease.pageInstanceId)
    const staleRenewal = await invokeLeaseAction(
      tab,
      'lease.renew',
      previousLease.pageInstanceId,
      previousLease.lease,
    )
    expect(staleRenewal.error).toMatchObject({ message: 'tab_lease_invalid' })
    const replayedRecovery = await invokeRecovery(
      tab,
      'stale-recovery-page',
      'stale-recovery-lease',
      previousTicket,
      'replayed-ticket',
      'replayed-attempt',
    )
    expect(replayedRecovery.error).toMatchObject({
      message: 'exam_recovery_ticket_invalid',
    })
    const staleRevocation = await invokeLeaseAction(
      tab,
      'tab.revoke',
      previousLease.pageInstanceId,
      previousLease.lease,
    )
    expect(staleRevocation.error).toMatchObject({ message: 'tab_lease_invalid' })
  })

  it('lets exactly one concurrent refresh consume a recovery ticket', async () => {
    const userId = 'account-parallel-refresh-recovery'
    const tab = identity(userId, 'device-refresh-race', 'tab-refresh-race')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    await createSession(tab, 'parallel-refresh')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    const ticket = h.recoveryTickets.get(capability)!

    const results = await Promise.all([
      invokeRecovery(tab, 'page-instance-A', 'lease-A', ticket, 'next-ticket-A', 'attempt-A'),
      invokeRecovery(tab, 'page-instance-B', 'lease-B', ticket, 'next-ticket-B', 'attempt-B'),
    ])

    expect(results.filter((result) => !result.error)).toHaveLength(1)
    expect(results.filter((result) => result.error)).toHaveLength(1)
    const winner = h.leases.get(capability)!
    expect(['A', 'B']).toContain(winner.pageInstanceId.slice(-1))
    expect(winner.lease).toBe(`lease-${winner.pageInstanceId.slice(-1)}`)
    expect(h.recoveryTickets.get(capability)).toBe(`next-ticket-${winner.pageInstanceId.slice(-1)}`)
  })

  it('replays the same committed recovery attempt after a lost response', async () => {
    const userId = 'account-recovery-response-loss'
    const tab = identity(userId, 'device-response-loss', 'tab-response-loss')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    await createSession(tab, 'response-loss')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    const ticket = h.recoveryTickets.get(capability)!
    const request = [
      tab,
      'page-instance-stable-attempt',
      'lease-stable-attempt',
      ticket,
      'next-stable-attempt',
      'attempt-stable',
    ] as const

    const first = await invokeRecovery(...request)
    const retry = await invokeRecovery(...request)

    expect(first.error).toBeNull()
    expect(retry.error).toBeNull()
    expect(h.recoveryTickets.get(capability)).toBe('next-stable-attempt')
    expect(h.leases.get(capability)).toMatchObject({
      pageInstanceId: 'page-instance-stable-attempt',
      lease: 'lease-stable-attempt',
    })
  })

  it('does not allow a different authenticated user to use another tab recovery ticket', async () => {
    const userId = 'account-recovery-owner'
    const tab = identity(userId, 'device-recovery-owner', 'tab-recovery-owner')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    await createSession(tab, 'recovery-owner')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    const currentLease = { ...h.leases.get(capability)! }
    const otherUserTab = identity(
      'different-authenticated-user',
      tab.deviceId,
      tab.tabId,
    )
    h.activeDevices.set(otherUserTab.userId, [otherUserTab.deviceId])
    h.packageLimits.set(otherUserTab.userId, 1)

    const result = await invokeRecovery(
      otherUserTab,
      'page-instance-attacker',
      'lease-attacker',
      h.recoveryTickets.get(capability)!,
      'next-attacker-ticket',
      'attacker-attempt',
      capability,
    )

    expect(result.error).toMatchObject({ message: 'capability_invalid' })
    expect(h.leases.get(capability)).toEqual(currentLease)
  })

  it('recovers immediately after lease release or expiry without deleting tab sessions', async () => {
    const userId = 'account-closed-tab-recovery'
    const tab = identity(userId, 'device-closed-tab', 'tab-closed-tab')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    const created = await createSession(tab, 'closed-tab')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    await expect(releaseExamTabLease(tab)).resolves.toBe(true)
    expect(h.leases.has(capability)).toBe(false)
    vi.resetModules()
    const reopenedRemote = await import('./exam-session-edge')
    const resumedAfterClose = await reopenedRemote.listRemoteExamSessions(tab)
    expect(resumedAfterClose.map((session) => session.session_id)).toEqual([created.session_id])

    const currentLease = h.leases.get(capability)!
    currentLease.expiresAt = Date.now() - 1
    vi.resetModules()
    const expiredLeaseRemote = await import('./exam-session-edge')
    const resumedAfterExpiry = await expiredLeaseRemote.listRemoteExamSessions(tab)
    expect(resumedAfterExpiry.map((session) => session.session_id)).toEqual([created.session_id])
    expect(h.leases.get(capability)?.expiresAt).toBeGreaterThan(Date.now())
  })

  it('revokes only the tab capability and makes the old lease unusable', async () => {
    const userId = 'account-tab-revoke'
    const tab = identity(userId, 'device-tab-revoke', 'tab-tab-revoke')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    await createSession(tab, 'tab-revoke')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    await expect(revokeExamTab(tab)).resolves.toBe(true)
    expect(h.revokedCapabilities.has(capability)).toBe(true)
    expect(h.leases.has(capability)).toBe(false)
    expect(sessionStorage.getItem(
      `cityroute.exam.capability.v1:${encodeURIComponent(userId)}:${encodeURIComponent(tab.deviceId)}:${encodeURIComponent(tab.tabId)}`,
    )).toBeNull()
  })

  it('does not allow lease.acquire to take over an expired lease', async () => {
    const userId = 'account-parallel-lease-acquire'
    const tab = identity(userId, 'device-parallel-lease', 'tab-parallel-lease')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    await createSession(tab, 'parallel-lease')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    const originalLease = { ...h.leases.get(capability)!, expiresAt: Date.now() - 1 }
    h.leases.set(capability, originalLease)

    const results = await Promise.all([
      invokeLeaseAction(tab, 'lease.acquire', 'page-instance-A', 'lease-secret-A'),
      invokeLeaseAction(tab, 'lease.acquire', 'page-instance-B', 'lease-secret-B'),
    ])

    expect(results.every((result) =>
      result.error?.message === 'exam_recovery_ticket_required'
    )).toBe(true)
    expect(h.leases.get(capability)).toEqual(originalLease)
  })

  it('rejects concurrent takeovers of an active lease and preserves its owner', async () => {
    const userId = 'account-active-lease-takeover'
    const tab = identity(userId, 'device-active-lease', 'tab-active-lease')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    const session = await createSession(tab, 'active-lease')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    const originalLease = { ...h.leases.get(capability)! }

    const results = await Promise.all([
      invokeLeaseAction(tab, 'lease.acquire', 'page-instance-B', 'lease-secret-B'),
      invokeLeaseAction(tab, 'lease.acquire', 'page-instance-C', 'lease-secret-C'),
    ])

    expect(results.every((result) =>
      result.error?.message === 'exam_recovery_ticket_required'
    )).toBe(true)
    expect(h.leases.get(capability)).toEqual(originalLease)

    const writer = new RemoteExamSessionWriter(session.session_id, session.version, tab)
    await writer.save('active', { route: 'route-1', handledPins: [7] }, {}, 2000)
    expect(h.sessions.get(session.session_id)?.progress).toEqual({
      route: 'route-1',
      handledPins: [7],
    })
  })

  it('reclaims an expired lease and rejects writes from its stale owner', async () => {
    const userId = 'account-expired-lease-reclaim'
    const tab = identity(userId, 'device-expired-lease', 'tab-expired-lease')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    const session = await createSession(tab, 'expired-lease')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    h.leases.get(capability)!.expiresAt = Date.now() - 1

    const reclaimed = await invokeRecovery(
      tab,
      'page-instance-new',
      'lease-secret-new',
      h.recoveryTickets.get(capability)!,
      'new-recovery-ticket',
      'new-recovery-attempt',
    )

    expect(reclaimed.error).toBeNull()
    expect(h.leases.get(capability)).toMatchObject({
      pageInstanceId: 'page-instance-new',
      lease: 'lease-secret-new',
    })
    const staleWriter = new RemoteExamSessionWriter(session.session_id, session.version, tab)
    await expect(
      staleWriter.save('active', { route: 'route-1', handledPins: [99] }, {}, 2000),
    ).rejects.toThrow('tab_lease_invalid')
  })

  it('renews and releases only the current unexpired page-instance lease', async () => {
    const userId = 'account-lease-owner-operations'
    const tab = identity(userId, 'device-lease-operations', 'tab-lease-operations')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    const session = await createSession(tab, 'lease-operations')
    const capability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    const currentLease = h.leases.get(capability)!
    currentLease.expiresAt = Date.now() + 1_000
    const beforeRenewal = currentLease.expiresAt

    const renewed = await invokeLeaseAction(
      tab,
      'lease.renew',
      currentLease.pageInstanceId,
      currentLease.lease,
    )
    expect(renewed.error).toBeNull()
    expect(currentLease.expiresAt).toBeGreaterThan(beforeRenewal)

    const staleRenewal = await invokeLeaseAction(
      tab,
      'lease.renew',
      'page-instance-stale',
      'lease-secret-stale',
    )
    const staleRelease = await invokeLeaseAction(
      tab,
      'lease.release',
      'page-instance-stale',
      'lease-secret-stale',
    )
    expect(staleRenewal.error).toMatchObject({ message: 'tab_lease_invalid' })
    expect(staleRelease.error).toMatchObject({ message: 'tab_lease_invalid' })
    expect(h.leases.get(capability)).toBe(currentLease)

    const released = await invokeLeaseAction(
      tab,
      'lease.release',
      currentLease.pageInstanceId,
      currentLease.lease,
    )
    expect(released.error).toBeNull()
    expect(h.leases.has(capability)).toBe(false)

    const reacquired = await invokeRecovery(
      tab,
      'page-instance-after-release',
      'lease-secret-after-release',
      h.recoveryTickets.get(capability)!,
      'ticket-after-release',
      'attempt-after-release',
    )
    expect(reacquired.error).toBeNull()
    expect(h.leases.get(capability)).toMatchObject({
      pageInstanceId: 'page-instance-after-release',
      lease: 'lease-secret-after-release',
    })
    const staleWriter = new RemoteExamSessionWriter(session.session_id, session.version, tab)
    await expect(
      staleWriter.save('active', { route: 'route-1', handledPins: [88] }, {}, 2000),
    ).rejects.toThrow('tab_lease_invalid')
  })

  it('rotates only an expired capability and keeps that tab’s sessions restorable', async () => {
    const userId = 'account-expired-capability'
    const tab = identity(userId, 'device-expired', 'tab-expired')
    h.activeDevices.set(userId, [tab.deviceId])
    h.packageLimits.set(userId, 1)
    const created = await createSession(tab, 'expired-capability')
    const oldCapability = h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))!
    h.leases.get(oldCapability)!.expiresAt = Date.now() - 1
    h.expiredCapabilities.add(oldCapability)
    const callsBeforeRefresh = h.calls.length

    vi.resetModules()
    const refreshedRemote = await import('./exam-session-edge')
    const resumed = await refreshedRemote.listRemoteExamSessions(tab)

    expect(resumed.map((session) => session.session_id)).toEqual([created.session_id])
    expect(h.calls.slice(callsBeforeRefresh).map((call) => call.action)).toEqual([
      'lease.recover',
      'tab.register',
      'session.list',
    ])
    expect(h.capabilities.get(capabilityFor(userId, tab.deviceId, tab.tabId))).not.toBe(oldCapability)
  })
})
