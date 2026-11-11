import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRemoteExamSession,
  getRemoteExamSession,
  listRemoteExamSessions,
  RemoteExamSessionWriter,
} from './exam-session-remote'

const h = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  migrationKeys: new Map<string, string>(),
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  nextId: 1,
}))

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: async (name: string, rawArgs: unknown) => {
      const args = rawArgs && typeof rawArgs === 'object'
        ? rawArgs as Record<string, unknown>
        : {}
      h.calls.push({ name, args })

      if (name === 'create_exam_session') {
        const key = `${String(args.p_device_id)}:${String(args.p_migration_key)}`
        const existingId = h.migrationKeys.get(key)
        if (existingId) return { data: h.sessions.get(existingId), error: null }

        const id = `exam-${h.nextId++}`
        const created = {
          session_id: id,
          user_id: 'same-account',
          device_id: args.p_device_id,
          tab_id: args.p_tab_id,
          route_slug: args.p_route_slug,
          status: args.p_status,
          version: 1,
          progress: args.p_progress,
          errors: args.p_errors,
          elapsed_ms: args.p_elapsed_ms,
          summary: null,
          started_at: args.p_started_at,
          updated_at: new Date().toISOString(),
        }
        h.sessions.set(id, created)
        h.migrationKeys.set(key, id)
        return { data: created, error: null }
      }

      if (name === 'list_active_exam_sessions') {
        return {
          data: [...h.sessions.values()].filter(
            (session) => session.status === 'active' || session.status === 'paused',
          ),
          error: null,
        }
      }

      const id = String(args.p_session_id)
      const session = h.sessions.get(id)
      if (!session) return { data: null, error: null }
      if (name === 'get_exam_session') return { data: session, error: null }

      if (Number(session.version) !== args.p_expected_version) {
        return { data: null, error: { code: '40001', message: 'version conflict' } }
      }
      const updated = {
        ...session,
        version: Number(session.version) + 1,
        updated_at: new Date().toISOString(),
      }
      if (name === 'update_exam_session') {
        Object.assign(updated, {
          status: args.p_status,
          progress: args.p_progress,
          errors: args.p_errors,
          elapsed_ms: args.p_elapsed_ms,
        })
      } else if (name === 'finish_exam_session') {
        Object.assign(updated, {
          status: 'completed',
          progress: args.p_progress,
          errors: args.p_errors,
          elapsed_ms: args.p_elapsed_ms,
          summary: args.p_summary,
        })
      } else if (name === 'abandon_exam_session') {
        Object.assign(updated, { status: 'abandoned' })
      }
      h.sessions.set(id, updated)
      return { data: updated, error: null }
    },
  }),
}))

describe('device-scoped exam session persistence', () => {
  beforeEach(() => {
    h.sessions.clear()
    h.migrationKeys.clear()
    h.calls.length = 0
    h.nextId = 1
  })

  it('keeps parallel device autosaves, refresh lookup, finish and abandon isolated', async () => {
    const [deviceA, deviceB] = await Promise.all([
      createRemoteExamSession({
        routeSlug: 'route-1',
        deviceId: 'device-A-fingerprint',
        tabId: 'tab-A',
        progress: { route: 'route-1', handledPins: [1] },
        errors: { minor: 0 },
        elapsedMs: 1000,
        startedAt: new Date(1_000).toISOString(),
        migrationKey: 'create-A',
      }),
      createRemoteExamSession({
        routeSlug: 'route-2',
        deviceId: 'device-B-fingerprint',
        tabId: 'tab-B',
        progress: { route: 'route-2', handledPins: [1, 2] },
        errors: { minor: 1 },
        elapsedMs: 2000,
        startedAt: new Date(2_000).toISOString(),
        migrationKey: 'create-B',
      }),
    ])
    const writerA = new RemoteExamSessionWriter(deviceA.session_id, deviceA.version)
    const writerB = new RemoteExamSessionWriter(deviceB.session_id, deviceB.version)

    await Promise.all([
      writerA.save('active', { route: 'route-1', handledPins: [1, 2] }, { minor: 0 }, 3000),
      writerA.save('active', { route: 'route-1', handledPins: [1, 2, 3] }, { minor: 0 }, 4000),
      writerB.save('active', { route: 'route-2', handledPins: [1, 2, 3] }, { minor: 1 }, 5000),
    ])

    const refreshedSessions = await listRemoteExamSessions('tab-A')
    const refreshedA = await getRemoteExamSession(deviceA.session_id)
    expect(refreshedSessions.map((session) => session.session_id)).toEqual([
      deviceA.session_id,
    ])
    expect(refreshedA?.progress).toEqual({ route: 'route-1', handledPins: [1, 2, 3] })
    expect(h.sessions.get(deviceB.session_id)?.progress).toEqual({
      route: 'route-2',
      handledPins: [1, 2, 3],
    })
    expect((await listRemoteExamSessions('tab-B')).map((session) => session.session_id)).toEqual([
      deviceB.session_id,
    ])

    await writerA.finish(
      { route: 'route-1', handledPins: [1, 2, 3] },
      { minor: 0 },
      4000,
      { passed: true },
    )
    await writerB.abandon()

    expect(h.sessions.get(deviceA.session_id)?.status).toBe('completed')
    expect(h.sessions.get(deviceB.session_id)?.status).toBe('abandoned')
    expect(h.sessions.get(deviceB.session_id)?.summary).toBeNull()
    expect(h.calls.filter((call) => call.name === 'update_exam_session')).toHaveLength(3)
    const updates = h.calls.filter((call) => call.name === 'update_exam_session')
    expect(
      updates
        .filter((call) => call.args.p_session_id === deviceA.session_id)
        .map((call) => call.args.p_expected_version),
    ).toEqual([1, 2])
    expect(
      updates
        .filter((call) => call.args.p_session_id === deviceB.session_id)
        .map((call) => call.args.p_expected_version),
    ).toEqual([1])
  })

  it('reuses the correct session/version contract for each route refresh', async () => {
    const original = await createRemoteExamSession({
      routeSlug: 'route-4',
      deviceId: 'device-A-fingerprint',
      tabId: 'tab-A',
      progress: { route: 'route-4', handledPins: [4] },
      errors: {},
      elapsedMs: 4000,
      startedAt: new Date(4_000).toISOString(),
      migrationKey: 'refresh-route-4',
    })

    const restored = await getRemoteExamSession(original.session_id)
    expect(restored?.session_id).toBe(original.session_id)
    expect(restored?.device_id).toBe('device-A-fingerprint')
    expect(restored?.tab_id).toBe('tab-A')
    expect(restored?.route_slug).toBe('route-4')
    expect(restored?.progress).toEqual({ route: 'route-4', handledPins: [4] })
  })

  it('creates independent exam sessions for separate tabs on the same device and route', async () => {
    const [tabA, tabB] = await Promise.all([
      createRemoteExamSession({
        routeSlug: 'route-1',
        deviceId: 'same-device-fingerprint',
        tabId: 'browser-tab-A',
        progress: { route: 'route-1', handledPins: [1] },
        errors: {},
        elapsedMs: 1000,
        startedAt: new Date(1_000).toISOString(),
        migrationKey: 'tab-A-create',
      }),
      createRemoteExamSession({
        routeSlug: 'route-1',
        deviceId: 'same-device-fingerprint',
        tabId: 'browser-tab-B',
        progress: { route: 'route-1', handledPins: [1, 2] },
        errors: {},
        elapsedMs: 2000,
        startedAt: new Date(2_000).toISOString(),
        migrationKey: 'tab-B-create',
      }),
    ])

    expect(tabA.session_id).not.toBe(tabB.session_id)
    expect(tabA.tab_id).toBe('browser-tab-A')
    expect(tabB.tab_id).toBe('browser-tab-B')
    expect((await listRemoteExamSessions('browser-tab-A')).map((item) => item.session_id)).toEqual([
      tabA.session_id,
    ])
    expect((await listRemoteExamSessions('browser-tab-B')).map((item) => item.session_id)).toEqual([
      tabB.session_id,
    ])
  })

  it('offers legacy null-tab sessions only to the explicit compatibility lookup', async () => {
    const legacy = await createRemoteExamSession({
      routeSlug: 'route-2',
      deviceId: 'same-device-fingerprint',
      tabId: 'legacy-tab',
      progress: { route: 'route-2', handledPins: [1, 2] },
      errors: {},
      elapsedMs: 2000,
      startedAt: new Date(2_000).toISOString(),
      migrationKey: 'legacy-session',
    })
    h.sessions.set(legacy.session_id, { ...legacy, tab_id: null })

    expect(await listRemoteExamSessions('new-tab')).toEqual([])
    expect(
      (await listRemoteExamSessions('new-tab', { includeLegacyNullTab: true })).map(
        (session) => session.session_id,
      ),
    ).toEqual([legacy.session_id])
  })

  it('rejects a stale concurrent writer instead of overwriting newer progress', async () => {
    const session = await createRemoteExamSession({
      routeSlug: 'route-1',
      deviceId: 'device-A-fingerprint',
      tabId: 'tab-A',
      progress: { route: 'route-1', handledPins: [1] },
      errors: {},
      elapsedMs: 1000,
      startedAt: new Date(1_000).toISOString(),
      migrationKey: 'concurrent-write',
    })
    const writerA = new RemoteExamSessionWriter(session.session_id, session.version)
    const writerB = new RemoteExamSessionWriter(session.session_id, session.version)

    await writerB.save('active', { route: 'route-1', handledPins: [1, 2] }, {}, 2000)
    await expect(
      writerA.save('active', { route: 'route-1', handledPins: [1, 3] }, {}, 3000),
    ).rejects.toMatchObject({ code: '40001' })

    expect(h.sessions.get(session.session_id)?.progress).toEqual({
      route: 'route-1',
      handledPins: [1, 2],
    })
  })

  it('recovers a stale writer when the conflicting save already stored the same snapshot', async () => {
    const session = await createRemoteExamSession({
      routeSlug: 'route-1',
      deviceId: 'device-A-fingerprint',
      tabId: 'tab-A',
      progress: { route: 'route-1', handledPins: [1] },
      errors: {},
      elapsedMs: 1000,
      startedAt: new Date(1_000).toISOString(),
      migrationKey: 'same-snapshot-conflict',
    })
    const writerA = new RemoteExamSessionWriter(session.session_id, session.version)
    const writerB = new RemoteExamSessionWriter(session.session_id, session.version)
    const sameProgress = { route: 'route-1', handledPins: [1, 2] }

    await writerB.save('active', sameProgress, {}, 2000)
    const recovered = await writerA.save('active', sameProgress, {}, 2000)
    const next = await writerA.save(
      'active',
      { route: 'route-1', handledPins: [1, 2, 3] },
      {},
      3000,
    )

    expect(recovered.version).toBe(2)
    expect(next.version).toBe(3)
    expect(h.sessions.get(session.session_id)?.progress).toEqual({
      route: 'route-1',
      handledPins: [1, 2, 3],
    })
  })
})
