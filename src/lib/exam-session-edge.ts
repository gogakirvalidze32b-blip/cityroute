import { getSupabase } from '@/lib/supabase'
import type { Json } from '@/types/database'

export function shouldUseRemoteExamSessionBackend(vercelEnv?: string): boolean {
  return vercelEnv !== 'preview'
}

export const REMOTE_EXAM_SESSION_BACKEND_ENABLED =
  shouldUseRemoteExamSessionBackend(import.meta.env.VERCEL_ENV)

export type RemoteExamStatus = 'active' | 'paused' | 'completed' | 'abandoned'

export type RemoteExamSession = {
  session_id: string
  user_id: string
  device_id: string
  tab_id: string | null
  route_slug: string
  status: RemoteExamStatus
  version: number
  progress: Json
  errors: Json
  elapsed_ms: number
  summary: Json | null
  started_at: string
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) return true
  if (Array.isArray(value)) return value.every(isJson)
  return isRecord(value) && Object.values(value).every((item) => item === undefined || isJson(item))
}

function parseRemoteExamSession(value: unknown): RemoteExamSession {
  if (
    !isRecord(value) ||
    typeof value.session_id !== 'string' ||
    typeof value.user_id !== 'string' ||
    typeof value.device_id !== 'string' ||
    (value.tab_id !== null && typeof value.tab_id !== 'string') ||
    typeof value.route_slug !== 'string' ||
    (value.status !== 'active' &&
      value.status !== 'paused' &&
      value.status !== 'completed' &&
      value.status !== 'abandoned') ||
    typeof value.version !== 'number' ||
    !Number.isInteger(value.version) ||
    value.version < 1 ||
    !isJson(value.progress) ||
    !isJson(value.errors) ||
    typeof value.elapsed_ms !== 'number' ||
    !Number.isSafeInteger(value.elapsed_ms) ||
    value.elapsed_ms < 0 ||
    (value.summary !== null && !isJson(value.summary)) ||
    typeof value.started_at !== 'string' ||
    typeof value.updated_at !== 'string'
  ) {
    throw new Error('სერვერმა გამოცდის სესიაზე არასწორი მონაცემები დააბრუნა.')
  }
  return value as RemoteExamSession
}

function parseSessionList(value: unknown): RemoteExamSession[] {
  if (!Array.isArray(value)) {
    throw new Error('სერვერმა აქტიური გამოცდების სია არასწორ ფორმატში დააბრუნა.')
  }
  return value.map(parseRemoteExamSession)
}

function isVersionConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '40001'
  )
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function sameProgressSnapshot(remote: RemoteExamSession, progress: Json, errors: Json, elapsedMs: number): boolean {
  if (
    stableJson(remote.errors) !== stableJson(errors) ||
    remote.elapsed_ms !== elapsedMs ||
    !isRecord(remote.progress) ||
    !isRecord(progress)
  ) return false
  const localOnlyFields = new Set([
    'savedAt',
    'examSessionVersion',
    'examSessionRevision',
    'examSessionDirty',
  ])
  const withoutLocalMetadata = (value: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(value).filter(([key]) => !localOnlyFields.has(key)))
  return stableJson(withoutLocalMetadata(remote.progress)) ===
    stableJson(withoutLocalMetadata(progress))
}

export type RemoteExamSessionInput = {
  userId: string
  routeSlug: string
  deviceId: string
  tabId: string
  progress: Json
  errors: Json
  elapsedMs: number
  startedAt: string
  migrationKey: string
}

export type ExamSessionTabIdentity = {
  userId: string
  deviceId: string
  tabId: string
}

type TabCapability = {
  identity: ExamSessionTabIdentity
  capability: string
  recoveryTicket: string
  registration?: {
    pageInstanceId: string
    lease: string
  }
  pendingRecovery?: {
    recoveryTicket: string
    nextRecoveryTicket: string
    recoveryAttemptId: string
    pageInstanceId: string
    lease: string
  }
}

type TabLease = {
  capability: string
  recoveryTicket: string
  pageInstanceId: string
  lease: string
  expiresAt: number
}

type ExamSessionRequest = {
  action: string
  identity: ExamSessionTabIdentity
  pageInstanceId: string
  capability?: string
  recoveryTicket?: string
  nextRecoveryTicket?: string
  recoveryAttemptId?: string
  lease?: string
  sessionId?: string
  expectedVersion?: number
  payload?: Record<string, unknown>
}

const CAPABILITY_STORAGE_PREFIX = 'cityroute.exam.capability.v1:'
const PAGE_INSTANCE_ID = secureRandomToken()
const tabLeases = new Map<string, TabLease>()
const leaseInitialization = new Map<string, Promise<TabLease>>()
const leaseRelease = new Map<string, Promise<void>>()

function secureRandomToken(): string {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function identityKey(identity: ExamSessionTabIdentity): string {
  return [identity.userId, identity.deviceId, identity.tabId]
    .map((part) => encodeURIComponent(part))
    .join(':')
}

function capabilityStorageKey(identity: ExamSessionTabIdentity): string {
  return `${CAPABILITY_STORAGE_PREFIX}${identityKey(identity)}`
}

function readCapability(identity: ExamSessionTabIdentity): TabCapability | null {
  try {
    const stored = sessionStorage.getItem(capabilityStorageKey(identity))
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (
      !isRecord(parsed) ||
      parsed.userId !== identity.userId ||
      parsed.deviceId !== identity.deviceId ||
      parsed.tabId !== identity.tabId ||
      typeof parsed.capability !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(parsed.capability) ||
      typeof parsed.recoveryTicket !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(parsed.recoveryTicket)
    ) return null
    const registration = isRecord(parsed.registration) &&
        typeof parsed.registration.pageInstanceId === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(parsed.registration.pageInstanceId) &&
        typeof parsed.registration.lease === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(parsed.registration.lease)
      ? {
          pageInstanceId: parsed.registration.pageInstanceId,
          lease: parsed.registration.lease,
        }
      : undefined
    const pendingRecovery = isRecord(parsed.pendingRecovery) &&
        typeof parsed.pendingRecovery.recoveryTicket === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(parsed.pendingRecovery.recoveryTicket) &&
        typeof parsed.pendingRecovery.nextRecoveryTicket === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(parsed.pendingRecovery.nextRecoveryTicket) &&
        typeof parsed.pendingRecovery.recoveryAttemptId === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(parsed.pendingRecovery.recoveryAttemptId) &&
        typeof parsed.pendingRecovery.pageInstanceId === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(parsed.pendingRecovery.pageInstanceId) &&
        typeof parsed.pendingRecovery.lease === 'string' &&
        /^[A-Za-z0-9_-]{43}$/.test(parsed.pendingRecovery.lease)
      ? {
          recoveryTicket: parsed.pendingRecovery.recoveryTicket,
          nextRecoveryTicket: parsed.pendingRecovery.nextRecoveryTicket,
          recoveryAttemptId: parsed.pendingRecovery.recoveryAttemptId,
          pageInstanceId: parsed.pendingRecovery.pageInstanceId,
          lease: parsed.pendingRecovery.lease,
        }
      : undefined
    return {
      identity,
      capability: parsed.capability,
      recoveryTicket: parsed.recoveryTicket,
      ...(registration ? { registration } : {}),
      ...(pendingRecovery ? { pendingRecovery } : {}),
    }
  } catch (error) {
    throw new Error('გამოცდის უსაფრთხო tab-იდენტობის შენახვა ვერ მოხერხდა.', { cause: error })
  }
}

function storeCapability(value: TabCapability): void {
  try {
    const { identity, ...stored } = value
    sessionStorage.setItem(
      capabilityStorageKey(identity),
      JSON.stringify({ ...identity, ...stored }),
    )
  } catch (error) {
    throw new Error('გამოცდის უსაფრთხო tab-იდენტობის შენახვა ვერ მოხერხდა.', { cause: error })
  }
}

function removeCapability(identity: ExamSessionTabIdentity): void {
  try {
    sessionStorage.removeItem(capabilityStorageKey(identity))
  } catch (error) {
    throw new Error('ვადაგასული exam tab-ის capability-ის წაშლა ვერ მოხერხდა.', { cause: error })
  }
}

async function invokeExamSession(request: ExamSessionRequest): Promise<unknown> {
  if (!REMOTE_EXAM_SESSION_BACKEND_ENABLED) {
    throw new Error('Remote Exam Session backend is disabled on Vercel Preview.')
  }
  const { data, error } = await getSupabase().functions.invoke<unknown>('exam-session-api', {
    body: request,
    headers: {
      'x-cityroute-device-fingerprint': request.identity.deviceId,
    },
  })
  if (error) {
    const context = 'context' in error ? error.context : undefined
    if (context instanceof Response) {
      try {
        const detail: unknown = await context.clone().json()
        if (isRecord(detail) && typeof detail.message === 'string') {
          const failure = new Error(detail.message)
          if (typeof detail.code === 'string') {
            Object.assign(failure, { code: detail.code })
          }
          throw failure
        }
      } catch (parseError) {
        if (parseError instanceof Error && 'code' in parseError) throw parseError
      }
    }
    throw error
  }
  return data
}

async function initializeTabLease(
  identity: ExamSessionTabIdentity,
): Promise<TabLease> {
  let stored = readCapability(identity)
  if (!stored) {
    stored = {
      identity,
      capability: secureRandomToken(),
      recoveryTicket: secureRandomToken(),
      registration: { pageInstanceId: PAGE_INSTANCE_ID, lease: secureRandomToken() },
    }
    storeCapability(stored)
  }

  if (stored.registration) {
    const registrationPageInstanceId = stored.registration.pageInstanceId
    const data = await invokeExamSession({
      action: 'tab.register',
      identity,
      pageInstanceId: stored.registration.pageInstanceId,
      capability: stored.capability,
      recoveryTicket: stored.recoveryTicket,
      lease: stored.registration.lease,
    })
    if (
      !isRecord(data) ||
      data.capability !== stored.capability ||
      data.lease !== stored.registration.lease ||
      typeof data.leaseExpiresAt !== 'string' ||
      !Number.isFinite(Date.parse(data.leaseExpiresAt))
    ) {
      throw new Error('სერვერმა გამოცდის tab-ის lease არასწორ ფორმატში დააბრუნა.')
    }
    stored = { ...stored, registration: undefined }
    storeCapability(stored)
    if (registrationPageInstanceId === PAGE_INSTANCE_ID) {
      return {
        capability: stored.capability,
        recoveryTicket: stored.recoveryTicket,
        pageInstanceId: registrationPageInstanceId,
        lease: data.lease,
        expiresAt: Date.parse(data.leaseExpiresAt),
      }
    }
  }

  let pending = stored.pendingRecovery
  if (!pending) {
    pending = {
      recoveryTicket: stored.recoveryTicket,
      nextRecoveryTicket: secureRandomToken(),
      recoveryAttemptId: secureRandomToken(),
      pageInstanceId: PAGE_INSTANCE_ID,
      lease: secureRandomToken(),
    }
    stored = { ...stored, pendingRecovery: pending }
    storeCapability(stored)
  }

  let data: unknown
  try {
    data = await invokeExamSession({
      action: 'lease.recover',
      identity,
      pageInstanceId: pending.pageInstanceId,
      capability: stored.capability,
      recoveryTicket: pending.recoveryTicket,
      nextRecoveryTicket: pending.nextRecoveryTicket,
      recoveryAttemptId: pending.recoveryAttemptId,
      lease: pending.lease,
    })
  } catch (error) {
    if (!isRecord(error) || error.code !== 'exam_capability_expired') throw error
    removeCapability(identity)
    return initializeTabLease(identity)
  }
  if (
    !isRecord(data) ||
    typeof data.leaseExpiresAt !== 'string' ||
    !Number.isFinite(Date.parse(data.leaseExpiresAt))
  ) {
    throw new Error('სერვერმა გამოცდის tab-ის lease არასწორ ფორმატში დააბრუნა.')
  }
  const recovered = {
    ...stored,
    recoveryTicket: pending.nextRecoveryTicket,
    pendingRecovery: undefined,
  }
  storeCapability(recovered)
  return {
    capability: recovered.capability,
    recoveryTicket: recovered.recoveryTicket,
    pageInstanceId: pending.pageInstanceId,
    lease: pending.lease,
    expiresAt: Date.parse(data.leaseExpiresAt),
  }
}

async function ensureTabLease(identity: ExamSessionTabIdentity): Promise<TabLease> {
  const key = identityKey(identity)
  const existing = tabLeases.get(key)
  if (existing && existing.expiresAt > Date.now() + 30_000) return existing

  const pending = leaseInitialization.get(key)
  if (pending) return pending

  const initialization = (async () => {
    const current = tabLeases.get(key)
    if (current && current.expiresAt > Date.now()) {
      const data = await invokeExamSession({
        action: 'lease.renew',
        identity,
        pageInstanceId: current.pageInstanceId,
        capability: current.capability,
        lease: current.lease,
      })
      if (!isRecord(data) || typeof data.leaseExpiresAt !== 'string') {
        throw new Error('სერვერმა გამოცდის tab-ის lease ვერ განაახლა.')
      }
      const renewed = { ...current, expiresAt: Date.parse(data.leaseExpiresAt) }
      if (!Number.isFinite(renewed.expiresAt)) {
        throw new Error('სერვერმა გამოცდის tab-ის lease ვადა არასწორად დააბრუნა.')
      }
      tabLeases.set(key, renewed)
      return renewed
    }

    const initialized = await initializeTabLease(identity)
    tabLeases.set(key, initialized)
    return initialized
  })()
  leaseInitialization.set(key, initialization)
  try {
    return await initialization
  } finally {
    if (leaseInitialization.get(key) === initialization) {
      leaseInitialization.delete(key)
    }
  }
}

export async function releaseExamTabLease(
  identity: ExamSessionTabIdentity,
): Promise<boolean> {
  const key = identityKey(identity)
  const pending = leaseRelease.get(key)
  if (pending) {
    await pending
    return true
  }
  const current = tabLeases.get(key)
  if (!current) return false
  if (current.expiresAt <= Date.now()) {
    tabLeases.delete(key)
    return false
  }
  const release = invokeExamSession({
    action: 'lease.release',
    identity,
    pageInstanceId: current.pageInstanceId,
    capability: current.capability,
    lease: current.lease,
  }).then((data) => {
    if (!isRecord(data) || data.released !== true) {
      throw new Error('სერვერმა Exam tab-ის lease-ის გათავისუფლება ვერ დაადასტურა.')
    }
    if (tabLeases.get(key) === current) tabLeases.delete(key)
  }).finally(() => {
    if (leaseRelease.get(key) === release) leaseRelease.delete(key)
  })
  leaseRelease.set(key, release)
  await release
  return true
}

export async function revokeExamTab(
  identity: ExamSessionTabIdentity,
): Promise<boolean> {
  if (!REMOTE_EXAM_SESSION_BACKEND_ENABLED) return false
  let stored = readCapability(identity)
  if (!stored) return false
  const lease = await ensureTabLease(identity)
  stored = readCapability(identity)
  if (!stored) return false
  const data = await invokeExamSession({
    action: 'tab.revoke',
    identity,
    pageInstanceId: lease.pageInstanceId,
    capability: stored.capability,
    recoveryTicket: stored.recoveryTicket,
    lease: lease.lease,
  })
  if (!isRecord(data) || data.revoked !== true) {
    throw new Error('სერვერმა Exam tab-ის გაუქმება ვერ დაადასტურა.')
  }
  tabLeases.delete(identityKey(identity))
  removeCapability(identity)
  return true
}

async function invokeForTab(
  identity: ExamSessionTabIdentity,
  request: Omit<ExamSessionRequest, 'identity' | 'pageInstanceId' | 'capability' | 'lease'>,
): Promise<unknown> {
  const lease = await ensureTabLease(identity)
  return invokeExamSession({
    ...request,
    identity,
    pageInstanceId: lease.pageInstanceId,
    capability: lease.capability,
    lease: lease.lease,
  })
}

export async function createRemoteExamSession(
  input: RemoteExamSessionInput,
): Promise<RemoteExamSession> {
  const data = await invokeForTab(
    { userId: input.userId, deviceId: input.deviceId, tabId: input.tabId },
    {
      action: 'session.create',
      payload: {
        routeSlug: input.routeSlug,
        progress: input.progress,
        errors: input.errors,
        elapsedMs: input.elapsedMs,
        startedAt: input.startedAt,
        migrationKey: input.migrationKey,
      },
    },
  )
  return parseRemoteExamSession(data)
}

export async function getRemoteExamSession(
  sessionId: string,
  identity: ExamSessionTabIdentity,
): Promise<RemoteExamSession | null> {
  const data = await invokeForTab(identity, {
    action: 'session.get',
    sessionId,
  })
  return data === null ? null : parseRemoteExamSession(data)
}

export async function listRemoteExamSessions(
  identity: ExamSessionTabIdentity,
): Promise<RemoteExamSession[]> {
  const data = await invokeForTab(identity, { action: 'session.list' })
  return parseSessionList(data)
}

export async function updateRemoteExamSession(
  identity: ExamSessionTabIdentity,
  sessionId: string,
  expectedVersion: number,
  status: 'active' | 'paused',
  progress: Json,
  errors: Json,
  elapsedMs: number,
): Promise<RemoteExamSession> {
  const data = await invokeForTab(identity, {
    action: 'session.update',
    sessionId,
    expectedVersion,
    payload: { status, progress, errors, elapsedMs },
  })
  return parseRemoteExamSession(data)
}

export async function finishRemoteExamSession(
  identity: ExamSessionTabIdentity,
  sessionId: string,
  expectedVersion: number,
  progress: Json,
  errors: Json,
  elapsedMs: number,
  summary: Json,
): Promise<RemoteExamSession> {
  const data = await invokeForTab(identity, {
    action: 'session.finish',
    sessionId,
    expectedVersion,
    payload: { progress, errors, elapsedMs, summary },
  })
  return parseRemoteExamSession(data)
}

export async function abandonRemoteExamSession(
  identity: ExamSessionTabIdentity,
  sessionId: string,
  expectedVersion: number,
): Promise<RemoteExamSession> {
  const data = await invokeForTab(identity, {
    action: 'session.abandon',
    sessionId,
    expectedVersion,
  })
  return parseRemoteExamSession(data)
}

export class RemoteExamSessionWriter {
  private version: number
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly sessionId: string,
    version: number,
    private readonly identity: ExamSessionTabIdentity,
  ) {
    this.version = version
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  save(
    status: 'active' | 'paused',
    progress: Json,
    errors: Json,
    elapsedMs: number,
  ): Promise<RemoteExamSession> {
    return this.enqueue(async () => {
      let session: RemoteExamSession
      try {
        session = await updateRemoteExamSession(
          this.identity,
          this.sessionId,
          this.version,
          status,
          progress,
          errors,
          elapsedMs,
        )
      } catch (error) {
        if (!isVersionConflict(error)) throw error
        const latest = await getRemoteExamSession(this.sessionId, this.identity)
        if (
          !latest ||
          (latest.status !== 'active' && latest.status !== 'paused') ||
          !sameProgressSnapshot(latest, progress, errors, elapsedMs)
        ) throw error
        session = latest
      }
      this.version = session.version
      return session
    })
  }

  finish(
    progress: Json,
    errors: Json,
    elapsedMs: number,
    summary: Json,
  ): Promise<RemoteExamSession> {
    return this.enqueue(async () => {
      const session = await finishRemoteExamSession(
        this.identity,
        this.sessionId,
        this.version,
        progress,
        errors,
        elapsedMs,
        summary,
      )
      this.version = session.version
      return session
    })
  }

  abandon(): Promise<RemoteExamSession> {
    return this.enqueue(async () => {
      const session = await abandonRemoteExamSession(
        this.identity,
        this.sessionId,
        this.version,
      )
      this.version = session.version
      return session
    })
  }
}

export function newExamSessionMigrationKey(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('უსაფრთხო გამოცდის სესიის იდენტიფიკატორის შექმნა ვერ მოხერხდა.')
  }
  return globalThis.crypto.randomUUID()
}

export function toJson(value: unknown): Json {
  if (!isJson(value)) throw new Error('გამოცდის სესიის მონაცემები JSON ფორმატში ვერ გარდაიქმნა.')
  return value
}
