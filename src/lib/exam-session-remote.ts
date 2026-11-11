import { getSupabase } from '@/lib/supabase'
import type { Json } from '@/types/database'

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
  routeSlug: string
  deviceId: string
  tabId: string
  progress: Json
  errors: Json
  elapsedMs: number
  startedAt: string
  migrationKey: string
}

export async function createRemoteExamSession(
  input: RemoteExamSessionInput,
): Promise<RemoteExamSession> {
  const { data, error } = await getSupabase().rpc('create_exam_session', {
    p_route_slug: input.routeSlug,
    p_device_id: input.deviceId,
    p_tab_id: input.tabId,
    p_progress: input.progress,
    p_errors: input.errors,
    p_elapsed_ms: input.elapsedMs,
    p_started_at: input.startedAt,
    p_migration_key: input.migrationKey,
    p_status: 'active',
  })
  if (error) throw error
  return parseRemoteExamSession(data)
}

export async function getRemoteExamSession(sessionId: string): Promise<RemoteExamSession | null> {
  const { data, error } = await getSupabase().rpc('get_exam_session', {
    p_session_id: sessionId,
  })
  if (error) throw error
  return data === null ? null : parseRemoteExamSession(data)
}

export async function listRemoteExamSessions(
  tabId?: string,
  options: { includeLegacyNullTab?: boolean } = {},
): Promise<RemoteExamSession[]> {
  const { data, error } = await getSupabase().rpc('list_active_exam_sessions')
  if (error) throw error
  const sessions = parseSessionList(data)
  return tabId
    ? sessions.filter(
        (session) =>
          session.tab_id === tabId ||
          (options.includeLegacyNullTab && session.tab_id === null),
      )
    : sessions
}

export async function updateRemoteExamSession(
  sessionId: string,
  expectedVersion: number,
  status: 'active' | 'paused',
  progress: Json,
  errors: Json,
  elapsedMs: number,
): Promise<RemoteExamSession> {
  const { data, error } = await getSupabase().rpc('update_exam_session', {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
    p_status: status,
    p_progress: progress,
    p_errors: errors,
    p_elapsed_ms: elapsedMs,
  })
  if (error) throw error
  return parseRemoteExamSession(data)
}

export async function finishRemoteExamSession(
  sessionId: string,
  expectedVersion: number,
  progress: Json,
  errors: Json,
  elapsedMs: number,
  summary: Json,
): Promise<RemoteExamSession> {
  const { data, error } = await getSupabase().rpc('finish_exam_session', {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
    p_progress: progress,
    p_errors: errors,
    p_elapsed_ms: elapsedMs,
    p_summary: summary,
  })
  if (error) throw error
  return parseRemoteExamSession(data)
}

export async function abandonRemoteExamSession(
  sessionId: string,
  expectedVersion: number,
): Promise<RemoteExamSession> {
  const { data, error } = await getSupabase().rpc('abandon_exam_session', {
    p_session_id: sessionId,
    p_expected_version: expectedVersion,
  })
  if (error) throw error
  return parseRemoteExamSession(data)
}

export class RemoteExamSessionWriter {
  private version: number
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly sessionId: string, version: number) {
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
          this.sessionId,
          this.version,
          status,
          progress,
          errors,
          elapsedMs,
        )
      } catch (error) {
        if (!isVersionConflict(error)) throw error
        const latest = await getRemoteExamSession(this.sessionId)
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
      const session = await abandonRemoteExamSession(this.sessionId, this.version)
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
