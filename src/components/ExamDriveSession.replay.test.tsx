/**
 * GPS replay harness for the REAL ExamDriveSession pipeline.
 *
 * Only the browser boundaries are mocked (watchGps, audio playback, map
 * widgets, plan features). GPS filtering, route matching, chainage, PIN
 * triggering and the audio queue all run unmodified.
 *
 * Legacy baseline (behaviour BEFORE the chainage migration) is stored in
 * src/test/replay/baselines/legacy-trigger.json and was written once with:
 *   $env:WRITE_REPLAY_BASELINE='1'; npx vitest run src/components/ExamDriveSession.replay.test.tsx
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { ExamDriveSession } from './ExamDriveSession'
import { saveActiveExam } from '@/lib/exam-persistence'
import { createExamSession } from '@/lib/exam-session'
import { loadRoutePinProgress } from '@/lib/route-pin-progress'
import { examRouteLine } from '@/lib/pin-route-line'
import { prepareRouteGeometry, type ActiveRouteId } from '@/lib/pure-route-geometry'
import { resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'
import type { GpsPosition } from '@/lib/gps'
import type { RouteWithPins } from '@/types/database'
import { currentProductionRoutes } from '@/test/migration-baseline/capture-baseline'
import { synthesizeTrace, type TraceFix } from '@/test/replay/route-replay'
import { REPLAY_ROUTES, REPLAY_SCENARIOS, type ReplayScenario } from '@/test/replay/replay-scenarios'
import {
  CHAINAGE_TRIGGER_ROLLOUT_ORDER,
  onPinTriggerEvent,
  setChainageTriggerRoutesForTesting,
  type PinTriggerShadowEvent,
} from '@/lib/pin-chainage-flag'
import { pinChainageTable } from '@/data/pin-chainage'

vi.mock('@/context/AuthContext', () => ({
  usePlanFeatures: () => ({ mapNav: true, errorPanel: true, canSwitchViews: true, routeAudio: true }),
}))
vi.mock('@/hooks/useExamLayoutMode', () => ({ useExamLayoutMode: () => 'desktop' as const }))

const h = vi.hoisted(() => ({
  gpsCb: null as null | ((pos: unknown) => void),
  fixIndex: -1,
  truthChainage: 0,
  played: [] as Array<{ pinId: string; fixIndex: number; truthChainage: number }>,
}))

vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(),
    playDetailed: vi.fn((_url: string, pinId: string, _instruction: string, options?: { onEnded?: () => void }) => {
      h.played.push({ pinId, fixIndex: h.fixIndex, truthChainage: h.truthChainage })
      options?.onEnded?.()
      return Promise.resolve('played')
    }),
    unlock: vi.fn(),
    isBusy: vi.fn(() => false),
    stopAll: vi.fn(),
    preload: vi.fn(),
    preloadAll: vi.fn(),
    setVolume: vi.fn(),
  },
}))

vi.mock('@/lib/gps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gps')>()
  return {
    ...actual,
    hasGpsConsent: vi.fn(() => false),
    markGpsConsentGranted: vi.fn(),
    clearGpsConsent: vi.fn(),
    requestGpsOnce: vi.fn(),
    requestWakeLock: vi.fn(() => Promise.resolve(() => {})),
    shouldAutoStartGps: vi.fn(() => Promise.resolve(false)),
    getGpsEnvironmentIssue: vi.fn(() => null),
    watchGps: vi.fn((cb: (pos: unknown) => void) => {
      h.gpsCb = cb
      return () => {}
    }),
  }
})

vi.mock('@/components/ExamErrorGrid', () => ({ ExamErrorGrid: () => <div /> }))
vi.mock('@/components/ExamLiveMap', () => ({ ExamLiveMap: () => <div /> }))
vi.mock('@/components/ExamScoreboard', () => ({ ExamScoreboard: () => <div /> }))
vi.mock('@/components/ExamSummary', () => ({ ExamSummary: () => <div /> }))
vi.mock('@/components/ExamViewSwitcher', () => ({ ExamViewSwitcher: () => <div /> }))
vi.mock('@/components/GpsAccuracyBadge', () => ({ GpsAccuracyBadge: () => <div /> }))
vi.mock('@/components/RoutePreviewMap', () => ({ RoutePreviewMap: () => <div /> }))

export type ReplayResult = {
  route: string
  scenario: string
  fixes: number
  /** Voices in playback order: sort_order and ground-truth chainage (m) at the fix that triggered it. */
  played: Array<{ order: number; truthChainageM: number }>
  /** Handled sort orders persisted at the end of the drive. */
  handled: number[]
  /** PINs never played. */
  notPlayed: number[]
}

let clock = Date.now()

function routeFor(slug: ActiveRouteId): RouteWithPins {
  return currentProductionRoutes().find((route) => route.slug === slug)!
}

export function pinChainagesFor(route: RouteWithPins): Map<number, number> {
  const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
  const geometry = prepareRouteGeometry(route.slug as ActiveRouteId, examRouteLine(route.slug, pins))
  const out = new Map<number, number>()
  let cursor = 0
  for (const pin of pins) {
    const chainage = resolveDemoPinChainage(geometry, pins, pin.sort_order, cursor)
    if (chainage == null) continue
    out.set(pin.sort_order, chainage)
    cursor = chainage
  }
  return out
}

export function traceFor(slug: ActiveRouteId, scenario: ReplayScenario): TraceFix[] {
  const route = routeFor(slug)
  const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
  const geometry = prepareRouteGeometry(slug, examRouteLine(slug, pins))
  const chainages = pinChainagesFor(route)
  const outages = (scenario.trace.outageAroundPins ?? []).flatMap(([order, before, after]) => {
    const at = chainages.get(order)
    return at == null ? [] : [{ fromChainageMeters: at - before, toChainageMeters: at + after }]
  })
  const { outageAroundPins: _ignored, ...trace } = scenario.trace
  return synthesizeTrace(geometry, { ...trace, outages, startTimestampMs: 1_800_000_000_000 })
}

export type ReplayOptions = {
  /** Device wall clock minus GPS fix time (ms). Real tablets can run several seconds ahead. */
  readonly clockSkewMs?: number
  /** Resume: keep localStorage (saved exam + PIN progress) instead of seeding a fresh exam. */
  readonly keepStorage?: boolean
  /** Mutate the saved exam before mounting (e.g. simulate a geometry-version mismatch). */
  readonly editSavedExam?: (saved: Record<string, unknown>) => Record<string, unknown>
}

export async function runReplay(
  slug: ActiveRouteId,
  fixes: readonly TraceFix[],
  scenarioId: string,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  cleanup()
  if (!options.keepStorage) localStorage.clear()
  h.played = []
  h.gpsCb = null
  h.fixIndex = -1
  const route = routeFor(slug)
  clock = fixes[0]!.timestamp - 5_000
  const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => clock)
  const hasSavedForRoute = localStorage.getItem(`cityroute-active-exam:${encodeURIComponent(slug)}`) !== null
  if (!options.keepStorage || !hasSavedForRoute) {
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: [fixes[0]!.lat, fixes[0]!.lng],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: [],
      triggeredSortOrders: [],
      savedAt: clock,
    })
  }
  if (options.editSavedExam) {
    const key = `cityroute-active-exam:${encodeURIComponent(slug)}`
    const raw = localStorage.getItem(key)
    if (raw) localStorage.setItem(key, JSON.stringify(options.editSavedExam(JSON.parse(raw))))
  }
  render(<ExamDriveSession route={route} />)
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
  expect(h.gpsCb).toBeTypeOf('function')
  for (const [index, fix] of fixes.entries()) {
    clock = fix.timestamp + 250 + (options.clockSkewMs ?? 0)
    h.fixIndex = index
    h.truthChainage = fix.truthChainageMeters
    const { truthChainageMeters: _truth, ...position } = fix
    await act(async () => {
      h.gpsCb!(position satisfies GpsPosition)
      await Promise.resolve()
    })
  }
  const orderById = new Map(route.pins.map((pin) => [pin.id, pin.sort_order]))
  const played = h.played
    .filter((item) => orderById.has(item.pinId))
    .map((item) => ({ order: orderById.get(item.pinId)!, truthChainageM: Math.round(item.truthChainage * 10) / 10 }))
  const handled = loadRoutePinProgress(slug) ?? []
  const playedOrders = new Set(played.map((item) => item.order))
  const notPlayed = route.pins.map((pin) => pin.sort_order).filter((order) => !playedOrders.has(order)).sort((a, b) => a - b)
  cleanup()
  nowSpy.mockRestore()
  return { route: slug, scenario: scenarioId, fixes: fixes.length, played, handled, notPlayed }
}

const BASELINE_PATH = resolve(__dirname, '../test/replay/baselines/legacy-trigger.json')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('GPS replay harness', () => {
  it('synthesizes deterministic traces', () => {
    const first = traceFor('route-2', REPLAY_SCENARIOS[2]!)
    const second = traceFor('route-2', REPLAY_SCENARIOS[2]!)
    expect(first).toEqual(second)
    expect(first.length).toBeGreaterThan(100)
    expect(first.every((fix, index) => index === 0 || fix.timestamp > first[index - 1]!.timestamp)).toBe(true)
  })

  it('leaves a GPS gap for outage scenarios', () => {
    const fixes = traceFor('route-2', REPLAY_SCENARIOS.find((item) => item.id.startsWith('outage'))!)
    const gaps = fixes.slice(1).map((fix, index) => fix.timestamp - fixes[index]!.timestamp)
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(10_000)
  })
})

// ---------------------------------------------------------------------------
// Kilometre-crossing trigger (feature flag ON per route, rollout order 2→4→1→3)
// ---------------------------------------------------------------------------

/** A voice spoken earlier than this before its trigger point is premature. */
const PREMATURE_SLACK_M = 25
/**
 * A voice spoken more than this after its PIN kilometre is outdated: the trigger
 * policy is 30 m (PIN_PASS_TOLERANCE_M) on MEASURED progress, plus up to 15 m of
 * route-match lag versus the true position at 5 s / 69 m fix spacing.
 */
const OUTDATED_LIMIT_M = 45

async function runActive(slug: ActiveRouteId, fixes: readonly TraceFix[], id: string, options: ReplayOptions = {}) {
  setChainageTriggerRoutesForTesting([slug])
  try {
    return await runReplay(slug, fixes, id, options)
  } finally {
    setChainageTriggerRoutesForTesting(null)
  }
}

function assertKilometreTriggerInvariants(
  slug: ActiveRouteId,
  result: ReplayResult,
  fixes: readonly TraceFix[],
  options: { requireNoStuckPins: boolean },
) {
  const table = pinChainageTable(slug)!
  const entry = new Map(table.pins.map((pin) => [pin.sort_order, pin]))
  const orders = result.played.map((item) => item.order)
  // Plays once, in forward order.
  expect(new Set(orders).size, 'duplicate voice').toBe(orders.length)
  expect(orders, 'voice order').toEqual([...orders].sort((a, b) => a - b))
  // Never premature, never outdated.
  for (const item of result.played) {
    const pin = entry.get(item.order)!
    const offset = item.truthChainageM - pin.chainage_m
    expect(offset, `${slug} #${item.order} spoken ${offset.toFixed(0)} m from its km`).toBeGreaterThanOrEqual(-(pin.lead_m + PREMATURE_SLACK_M))
    expect(offset, `${slug} #${item.order} spoken ${offset.toFixed(0)} m from its km`).toBeLessThanOrEqual(OUTDATED_LIMIT_M)
  }
  // Every voice spoken is also persisted as handled; handled orders are a prefix (resumable).
  expect(orders.every((order) => result.handled.includes(order))).toBe(true)
  const sortedPins = table.pins.map((pin) => pin.sort_order)
  expect(result.handled).toEqual(sortedPins.slice(0, result.handled.length))
  // Nothing the car drove well past is left pending (no "stuck" route).
  // Known limitation: at 5 s fix spacing the matcher stays ambiguous through the
  // hairpin / dual-pass finish corridor, so its last PINs are HELD (never spoken
  // wrongly) rather than handled; this check therefore applies to ≤ 2 s fixes.
  if (options.requireNoStuckPins) {
    const lastTruth = Math.max(...fixes.map((fix) => fix.truthChainageMeters))
    const passed = table.pins.filter((pin) => pin.chainage_m + 60 < lastTruth).map((pin) => pin.sort_order)
    const stuck = passed.filter((order) => !result.handled.includes(order))
    expect(stuck, `${slug}: PINs left unhandled although the car drove past them`).toEqual([])
  }
}

describe('kilometre-crossing trigger — active mode (flag on), every route and scenario', () => {
  for (const slug of CHAINAGE_TRIGGER_ROLLOUT_ORDER as readonly ActiveRouteId[]) {
    describe(slug, () => {
      for (const scenario of REPLAY_SCENARIOS) {
        it(`${scenario.id}: ${scenario.description}`, async () => {
          const fixes = traceFor(slug, scenario)
          const result = await runActive(slug, fixes, scenario.id)
          assertKilometreTriggerInvariants(slug, result, fixes, {
            requireNoStuckPins: scenario.trace.intervalMs <= 2000,
          })
          // Never worse than legacy: every PIN legacy spoke is handled.
          const legacy = existsSync(BASELINE_PATH)
            ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, ReplayResult>)[`${slug}/${scenario.id}`]
            : undefined
          if (legacy) {
            for (const item of legacy.played) expect(result.handled, `legacy spoke #${item.order}`).toContain(item.order)
          }
          if (scenario.id === 'clean-1hz-40kmh') {
            // Clean 1 Hz drive: identical voice set to legacy, nothing silent.
            expect(result.notPlayed).toEqual([])
          }
        }, 600_000)
      }
    })
  }
})

describe('kilometre-crossing trigger — resume, geometry version, route switching', () => {
  const clean = () => REPLAY_SCENARIOS.find((item) => item.id === 'clean-1hz-40kmh')!

  it('resume mid-route: no PIN is replayed, progress continues from the saved kilometre', async () => {
    const fixes = traceFor('route-2', clean())
    const half = Math.floor(fixes.length / 2)
    const first = await runActive('route-2', fixes.slice(0, half), 'resume-1')
    const second = await runActive('route-2', fixes.slice(half), 'resume-2', { keepStorage: true })
    const firstOrders = first.played.map((item) => item.order)
    const secondOrders = second.played.map((item) => item.order)
    expect(firstOrders.length).toBeGreaterThan(5)
    expect(secondOrders.filter((order) => firstOrders.includes(order))).toEqual([])
    expect([...firstOrders, ...secondOrders]).toEqual(pinChainageTable('route-2')!.pins.map((pin) => pin.sort_order))
  }, 600_000)

  it('resume with a different route-geometry version ignores the saved kilometre and still works', async () => {
    const fixes = traceFor('route-2', clean())
    const half = Math.floor(fixes.length / 2)
    const first = await runActive('route-2', fixes.slice(0, half), 'mismatch-1')
    const second = await runActive('route-2', fixes.slice(half), 'mismatch-2', {
      keepStorage: true,
      editSavedExam: (saved) => ({ ...saved, routeGeometryVersion: 'g1-some-older-geometry' }),
    })
    const all = [...first.played, ...second.played].map((item) => item.order)
    expect(new Set(all).size).toBe(all.length)
    expect(second.played.length).toBeGreaterThan(5)
  }, 600_000)

  it('route switching never leaks progress: Route 4 starts at PIN 1 after a half Route 2 drive', async () => {
    const r2 = traceFor('route-2', clean())
    await runActive('route-2', r2.slice(0, Math.floor(r2.length / 2)), 'switch-r2')
    const r2Handled = loadRoutePinProgress('route-2') ?? []
    const r4 = traceFor('route-4', clean()).slice(0, 120)
    const result = await runActive('route-4', r4, 'switch-r4', { keepStorage: true })
    expect(result.played[0]?.order).toBe(1)
    expect(loadRoutePinProgress('route-2')).toEqual(r2Handled)
  }, 600_000)

  it('a route whose flag is OFF keeps the legacy trigger even while another route is ON', async () => {
    setChainageTriggerRoutesForTesting(['route-4'])
    try {
      const scenario = REPLAY_SCENARIOS.find((item) => item.id === 'outage-pin10-1hz-40kmh')!
      const result = await runReplay('route-2', traceFor('route-2', scenario), scenario.id)
      const legacy = (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, ReplayResult>)[
        `route-2/${scenario.id}`
      ]
      expect(result).toEqual(legacy)
    } finally {
      setChainageTriggerRoutesForTesting(null)
    }
  }, 600_000)
})

describe('trigger exclusivity — exactly one PIN audio authority per route', () => {
  const clean = () => REPLAY_SCENARIOS.find((item) => item.id === 'clean-1hz-40kmh')!

  for (const slug of CHAINAGE_TRIGGER_ROLLOUT_ORDER as readonly ActiveRouteId[]) {
    it(`${slug}: with chainage active, every voice comes from a chainage decision (legacy never schedules audio)`, async () => {
      const events: PinTriggerShadowEvent[] = []
      const off = onPinTriggerEvent((event) => events.push(event))
      try {
        const result = await runActive(slug, traceFor(slug, clean()), 'exclusive-active')
        const activePlays = events.filter((e) => e.mode === 'active' && e.play !== null).map((e) => e.play)
        expect(events.filter((e) => e.mode === 'shadow')).toEqual([])
        expect(result.played.map((item) => item.order)).toEqual(activePlays)
        expect(result.notPlayed).toEqual([])
      } finally {
        off()
      }
    }, 600_000)

    it(`${slug}: ?pinTrigger=legacy rollback forces the legacy trigger only (identical to the legacy baseline)`, async () => {
      const events: PinTriggerShadowEvent[] = []
      const off = onPinTriggerEvent((event) => events.push(event))
      window.history.replaceState(null, '', `/route/${slug}?pinTrigger=legacy`)
      try {
        const result = await runActive(slug, traceFor(slug, clean()), clean().id)
        const legacy = (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, ReplayResult>)[
          `${slug}/${clean().id}`
        ]
        expect(result).toEqual(legacy)
        expect(events.filter((e) => e.mode === 'active')).toEqual([])
      } finally {
        off()
        window.sessionStorage.removeItem('cityroute-pin-trigger-override')
        window.history.replaceState(null, '', '/')
      }
    }, 600_000)
  }
})

describe('reliability fix: PIN anchor uses GPS time, not the device clock', () => {
  it('route-2 with the device clock 8 s ahead of GPS time still speaks every PIN (clean 1 Hz drive)', async () => {
    const scenario = REPLAY_SCENARIOS.find((item) => item.id === 'clean-1hz-40kmh')!
    const result = await runReplay('route-2', traceFor('route-2', scenario), 'clock-skew', { clockSkewMs: 8_000 })
    expect(result.notPlayed).toEqual([])
  }, 600_000)
})

describe('reliability fix: auto-save is throttled', () => {
  it('does not save the active exam on every GPS fix / timer tick (20 s of 1 Hz driving)', async () => {
    const scenario = REPLAY_SCENARIOS.find((item) => item.id === 'clean-1hz-40kmh')!
    // Middle of Route 2 between PINs: no PIN events, so only periodic saves remain.
    const fixes = traceFor('route-2', scenario).filter(
      (fix) => fix.truthChainageMeters > 1000 && fix.truthChainageMeters < 1230,
    )
    expect(fixes.length).toBeGreaterThanOrEqual(20)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await runReplay('route-2', fixes, 'save-throttle')
    const activeExamWrites = setItem.mock.calls.filter(([key]) => String(key).startsWith('cityroute-active-exam')).length
    // 1 initial test seed + mount save + unmount save (+ at most a couple of PIN/progress saves).
    expect(activeExamWrites).toBeLessThanOrEqual(6)
  }, 600_000)
})

describe('legacy trigger baseline (behaviour before the chainage migration)', () => {
  // Append-only: writing mode records scenarios that have no baseline yet and
  // refuses to touch existing entries.
  const writing = process.env.WRITE_REPLAY_BASELINE === '1'
  const baseline: Record<string, ReplayResult> =
    existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {}
  const collected: Record<string, ReplayResult> = {}

  for (const slug of REPLAY_ROUTES) {
    for (const scenario of REPLAY_SCENARIOS) {
      const key = `${slug}/${scenario.id}`
      if (writing && baseline[key]) continue
      it(`${key}: ${scenario.description}`, async () => {
        const result = await runReplay(slug, traceFor(slug, scenario), scenario.id)
        collected[key] = result
        if (writing) return
        expect(baseline[key], `missing baseline for ${key}`).toBeDefined()
        expect(result).toEqual(baseline[key])
      }, 600_000)
    }
  }

  if (writing) {
    it('appends new scenarios to the legacy baseline', () => {
      const merged = { ...collected, ...baseline }
      mkdirSync(dirname(BASELINE_PATH), { recursive: true })
      writeFileSync(BASELINE_PATH, JSON.stringify(merged, null, 1) + '\n', 'utf8')
    })
  }
})
