import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import route3Road from '@/data/route-3-road.json'
import route2Road from '@/data/route-2-road.json'
import { audioEngine } from '@/lib/audio'
import { createExamSession } from '@/lib/exam-session'
import { loadActiveExam, saveActiveExam } from '@/lib/exam-persistence'
import { examRoadTrace, examRouteLine, EXAM_STREET_LINE_SLUGS } from '@/lib/pin-route-line'
import type { GpsPosition } from '@/lib/gps'
import { resolvePinAudioUrl } from '@/data/route-audio'
import { loadRoutePinProgress, saveRoutePinProgress } from '@/lib/route-pin-progress'
import type { PinRow, RouteWithPins } from '@/types/database'

vi.mock('@/context/AuthContext', () => ({
  usePlanFeatures: () => ({ mapNav: true, errorPanel: true, canSwitchViews: true, routeAudio: true }),
}))
vi.mock('@/hooks/useExamLayoutMode', () => ({ useExamLayoutMode: () => 'desktop' as const }))
vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(() => Promise.resolve(true)),
    playDetailed: vi.fn((_url, _id, _instruction, options) => {
      if (audioTestState.autoEnd) options?.onEnded?.()
      return Promise.resolve('played')
    }),
    unlock: vi.fn(),
    isBusy: vi.fn(() => false),
    stopAll: vi.fn(),
    preloadAll: vi.fn(),
  },
}))

const gps = vi.hoisted(() => ({
  onFix: null as ((pos: GpsPosition) => void) | null,
  once: null as GpsPosition | null,
}))
const audioTestState = vi.hoisted(() => ({ autoEnd: true }))

vi.mock('@/lib/gps', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gps')>()
  return {
    ...actual,
    hasGpsConsent: vi.fn(() => true),
    markGpsConsentGranted: vi.fn(),
    clearGpsConsent: vi.fn(),
    shouldAutoStartGps: vi.fn(() => Promise.resolve(false)),
    getGpsEnvironmentIssue: vi.fn(() => null),
    requestWakeLock: vi.fn(() => Promise.resolve(() => {})),
    requestGpsOnce: vi.fn(() => Promise.resolve({ ...gps.once!, timestamp: Date.now() })),
    watchGps: vi.fn((onFix: (pos: GpsPosition) => void) => {
      gps.onFix = onFix
      return () => {
        if (gps.onFix === onFix) gps.onFix = null
      }
    }),
  }
})

vi.mock('@/lib/gps-filter', () => ({
  createGpsFilter: () => ({ filter: (reading: unknown) => reading, reset: () => {} }),
}))

vi.mock('@/lib/route-nav', () => ({
  createSpeedTracker: () => ({}),
  gpsToLatLng: (pos: GpsPosition) => [pos.lat, pos.lng] as [number, number],
  resolveHeading: () => 0,
  resolveExamSpeedKmh: () => 5,
  formatDuration: (ms: number) => `${Math.floor(ms / 1000)}s`,
}))

vi.mock('@/components/ExamLiveMap', () => ({
  ExamLiveMap: ({ nextPin }: { nextPin: PinRow | null }) => (
    <div data-testid="next-pin" data-order={nextPin?.sort_order ?? ''}>
      {nextPin?.instruction_ka ?? ''}
    </div>
  ),
}))
vi.mock('@/components/ExamErrorGrid', () => ({ ExamErrorGrid: () => null }))
vi.mock('@/components/ExamScoreboard', () => ({
  ExamScoreboard: ({ elapsedMs }: { elapsedMs: number }) => <output data-testid="elapsed-ms">{elapsedMs}</output>,
}))
vi.mock('@/components/ExamViewSwitcher', () => ({ ExamViewSwitcher: () => null }))
vi.mock('@/components/GpsAccuracyBadge', () => ({ GpsAccuracyBadge: () => null }))
vi.mock('@/components/RoutePreviewMap', () => ({
  RoutePreviewMap: ({
    selectedPinOrder,
    onPinSelect,
  }: {
    selectedPinOrder: number | null
    onPinSelect?: (sortOrder: number) => void
  }) => (
    <div data-testid="preview" data-selected-order={selectedPinOrder ?? ''}>
      <button type="button" onClick={() => onPinSelect?.(7)}>
        map PIN 7
      </button>
    </div>
  ),
}))
vi.mock('@/components/ExamSummary', () => ({
  ExamSummary: ({
    onRestart,
    onContinue,
  }: {
    onRestart: () => void
    onContinue?: () => void
  }) => (
    <div data-testid="exam-summary">
      {onContinue && (
        <button type="button" onClick={onContinue}>
          გაგრძელება
        </button>
      )}
      <button type="button" onClick={onRestart}>
        თავიდან
      </button>
    </div>
  ),
}))

const routeBySlug = (slug: string) => TELAVI_ROUTES_FALLBACK.find((route) => route.slug === slug)!
const uuid = (order: number) => `00000000-0000-4000-8000-${String(order).padStart(12, '0')}`
function withRemotePins(route: RouteWithPins): RouteWithPins {
  return {
    ...route,
    id: '11111111-1111-4111-8111-111111111111',
    pins: route.pins.map((pin) => ({ ...pin, id: uuid(pin.sort_order) })),
  }
}
const cases = [
  ['route-1', 35],
  ['route-2', 29],
  ['route-3', 31],
  ['route-4', 32],
] as const

const playDetailed = vi.mocked(audioEngine.playDetailed)
const pinAt = (route: RouteWithPins, order: number) => route.pins.find((pin) => pin.sort_order === order)!
const sorted = (route: RouteWithPins) => [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
const fix = (route: RouteWithPins, order: number, extra: Partial<GpsPosition> = {}): GpsPosition => {
  const pin = pinAt(route, order)
  return { lat: pin.lat, lng: pin.lng, accuracy: 5, heading: 0, speed: 5, timestamp: Date.now(), ...extra }
}

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
async function pressStart() {
  await act(async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: /გამოცდის დაწყება|გაგრძელება/ }))
  })
  await settle()
}
async function sendFix(pos: GpsPosition) {
  expect(gps.onFix).not.toBeNull()
  await act(async () => {
    gps.onFix!(pos)
    await Promise.resolve()
  })
  await settle()
}
const driveTo = (route: RouteWithPins, order: number) => sendFix(fix(route, order))
const nextOrder = () => Number(screen.getByTestId('next-pin').getAttribute('data-order'))
const playedOrders = (route: RouteWithPins) =>
  playDetailed.mock.calls.map(([, id]) => route.pins.find((pin) => pin.id === id)!.sort_order)

async function startAtPin1(route: RouteWithPins) {
  gps.once = fix(route, 1)
  const view = render(<ExamDriveSession route={route} />)
  await settle()
  await pressStart()
  return view
}

async function startRoute3AtPin11(route: RouteWithPins) {
  const priorOrders = route.pins.filter((pin) => pin.sort_order < 11).map((pin) => pin.sort_order)
  const priorPins = route.pins.filter((pin) => pin.sort_order < 11).map((pin) => pin.id)
  const [lat, lng] = route3Road[230]
  saveActiveExam({
    routeId: route.id,
    routeSlug: route.slug,
    routeName: route.name_ka,
    phase: 'active',
    exam: createExamSession(route.id, route.name_ka),
    userPos: [lat, lng],
    heading: 0,
    speedKmh: 5,
    elapsedMs: 1000,
    triggeredPins: priorPins,
    triggeredSortOrders: priorOrders,
    lastPassedSortOrder: 10,
    nextSortOrder: 11,
    savedAt: Date.now(),
  })
  const view = render(<ExamDriveSession route={route} />)
  await settle()
  expect(nextOrder()).toBe(11)
  return view
}

async function driveThroughPin12(route: RouteWithPins, startOrder = 1) {
  for (let order = startOrder; order <= 12; order += 1) {
    if (route.slug === 'route-3' && order === 12) {
      await driveTo(route, order)
      expect(nextOrder()).toBe(order)
      for (const [index, [lat, lng]] of route3Road.slice(231, 258).entries()) {
        await sendFix({
          lat,
          lng,
          accuracy: 5,
          heading: 0,
          speed: 5,
          timestamp: Date.now() + index + 1,
        })
      }
    } else {
      await driveTo(route, order)
    }
  }
}

describe('Telavi field-test routes keep strict progress and resume on production', () => {
  beforeEach(() => {
    localStorage.clear()
    playDetailed.mockReset()
    playDetailed.mockImplementation((_url, _id, _instruction, options) => {
      if (audioTestState.autoEnd) options?.onEnded?.()
      return Promise.resolve('played')
    })
    vi.mocked(audioEngine.play).mockReset()
    vi.mocked(audioEngine.play).mockImplementation(() => Promise.resolve(true))
    gps.onFix = null
    gps.once = null
    audioTestState.autoEnd = true
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('lets the user browse a selected PIN without changing a fresh run start from PIN 1', async () => {
    const route = routeBySlug('route-2')
    saveRoutePinProgress(route.slug, Array.from({ length: 12 }, (_, index) => index + 1))
    gps.once = fix(route, 1)
    render(<ExamDriveSession route={route} />)
    await settle()

    const user = userEvent.setup()
    const selector = screen.getByRole('combobox', { name: 'PIN-ების არჩევა' })
    await user.selectOptions(selector, '8')
    expect(screen.getByTestId('selected-preview-pin').textContent).toBe(
      `PIN 8${pinAt(route, 8).instruction_ka}`,
    )
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('8')

    await user.click(screen.getByRole('button', { name: 'map PIN 7' }))
    expect(selector).toHaveValue('7')
    expect(screen.getByTestId('selected-preview-pin').textContent).toBe(
      `PIN 7${pinAt(route, 7).instruction_ka}`,
    )

    await user.click(screen.getByRole('button', { name: /გამოცდის დაწყება/ }))
    await settle()
    expect(nextOrder()).toBe(1)
    expect(loadRoutePinProgress(route.slug)).toBeNull()
  })

  it('does not add a Tbilisi test route', () => {
    expect(TELAVI_ROUTES_FALLBACK.some((route) => route.slug === 'test-route-tbilisi')).toBe(false)
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      expect(EXAM_STREET_LINE_SLUGS.has(slug)).toBe(true)
    }
  })

  it('keeps PIN 1 completed when a stale active save is restored after a route switch', async () => {
    const route1 = routeBySlug('route-1')
    const route2 = routeBySlug('route-2')
    const view = await startAtPin1(route2)

    saveRoutePinProgress(route1.slug, [1])
    saveActiveExam({
      routeId: route1.id,
      routeSlug: route1.slug,
      routeName: route1.name_ka,
      phase: 'active',
      exam: createExamSession(route1.id, route1.name_ka),
      userPos: [route1.pins[0].lat, route1.pins[0].lng],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: [],
      triggeredSortOrders: [],
      lastPassedSortOrder: null,
      nextSortOrder: 1,
      savedAt: Date.now(),
    })

    gps.once = fix(route1, 1)
    view.rerender(<ExamDriveSession route={route1} />)
    await settle()

    expect(nextOrder()).toBe(2)
    await driveTo(route1, 1)
    expect(playedOrders(route1)).toEqual([])
    await driveTo(route1, 2)
    expect(playedOrders(route1)).toEqual([2])
    expect(nextOrder()).toBe(3)
  })

  it('derives completed PINs from saved IDs when sort-order metadata is empty', async () => {
    const route1 = routeBySlug('route-1')
    const route2 = routeBySlug('route-2')
    const view = await startAtPin1(route2)

    saveActiveExam({
      routeId: route1.id,
      routeSlug: route1.slug,
      routeName: route1.name_ka,
      phase: 'active',
      exam: createExamSession(route1.id, route1.name_ka),
      userPos: [route1.pins[0].lat, route1.pins[0].lng],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: [route1.pins[0].id],
      triggeredSortOrders: [],
      lastPassedSortOrder: null,
      nextSortOrder: 1,
      savedAt: Date.now(),
    })

    gps.once = fix(route1, 1)
    view.rerender(<ExamDriveSession route={route1} />)
    await settle()

    expect(nextOrder()).toBe(2)
    await driveTo(route1, 1)
    expect(playedOrders(route1)).toEqual([])
    await driveTo(route1, 2)
    expect(playedOrders(route1)).toEqual([2])
    expect(nextOrder()).toBe(3)
  })

  it('route 1 resumes by sort order; pin 1 is counted by GPS (session-start voice is muted)', async () => {
    const route = routeBySlug('route-1')
    const first = await startAtPin1(route)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(nextOrder()).toBe(1)
    await driveTo(route, 1)
    expect(playDetailed).toHaveBeenCalledTimes(1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
    expect(nextOrder()).toBe(2)
    await driveTo(route, 2)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    expect(screen.queryByTestId('route-complete')).toBeNull()
    first.unmount()
    playDetailed.mockClear()
    gps.once = fix(route, 1)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(3)
    await driveTo(route, 1)
    expect(playDetailed).not.toHaveBeenCalled()
  })

  it('route 1: mid-route დასრულება → გაგრძელება resumes at PIN 3; agency GPS cannot rewind', async () => {
    const route = routeBySlug('route-1')
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(playedOrders(route)).toEqual([1, 2])
    expect(nextOrder()).toBe(3)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])

    // Mid-route finish must keep progress (keepForResume / persistActiveExamNow).
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()

    const saved = loadActiveExam(route.id, route.slug, route.name_ka)
    expect(saved).not.toBeNull()
    expect(saved?.triggeredSortOrders).toEqual([1, 2])
    expect(saved?.lastPassedSortOrder).toBe(2)
    expect(saved?.nextSortOrder).toBe(3)
    expect(screen.getByTestId('exam-summary')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'გაგრძელება' })).toBeTruthy()

    // continueFromSummary with agency / PIN 1 GPS must not reset to PIN 1.
    playDetailed.mockClear()
    gps.once = fix(route, 1)
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()

    expect(nextOrder()).toBe(3)
    expect(screen.queryByTestId('exam-summary')).toBeNull()
    await driveTo(route, 1)
    expect(playDetailed).not.toHaveBeenCalled()
    await driveTo(route, 2)
    expect(playDetailed).not.toHaveBeenCalled()
    await driveTo(route, 3)
    expect(playedOrders(route)).toEqual([3])
    // Same original WAV as a normal visit to PIN 3 — never TTS / wrong path.
    const pin3 = route.pins.find((p) => p.sort_order === 3)!
    const expectedWav = resolvePinAudioUrl(route.slug, pin3)
    expect(expectedWav).toBeTruthy()
    expect(playDetailed.mock.calls[0][0]).toBe(expectedWav)
    expect(playDetailed.mock.calls[0][1]).toBe(pin3.id)
    expect(nextOrder()).toBe(4)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
  })

  it('route 1: Finish during a pending instruction persists and resumes that exact PIN', async () => {
    const route = routeBySlug('route-1')
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)

    audioTestState.autoEnd = false
    await driveTo(route, 3)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(3)

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(3)

    audioTestState.autoEnd = true
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()

    expect(playedOrders(route).slice(-1)).toEqual([3])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBeNull()
    expect(nextOrder()).toBe(4)
    expect(audioEngine.unlock).toHaveBeenCalled()
  })

  it('route 1: თავიდან starts a fresh run from PIN 1 and resets saved progress', async () => {
    let now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const route = routeBySlug('route-1')
      const view = await startAtPin1(route)
      for (let order = 1; order <= 12; order += 1) await driveTo(route, order)
      expect(nextOrder()).toBe(13)
      now += 65_000
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual(
        Array.from({ length: 12 }, (_, index) => index + 1),
      )

      now += 30_000
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'თავიდან' }))
      })
      await settle()
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()

      playDetailed.mockClear()
      await pressStart()
      expect(nextOrder()).toBe(1)
      expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBe(0)
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.elapsedMs).toBeLessThan(1000)

      await driveTo(route, 1)
      expect(playedOrders(route)).toEqual([1])
      expect(nextOrder()).toBe(2)
      view.unmount()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it.each(cases)('%s: restarting after a stopped run starts at PIN 1, including after remount', async (slug) => {
    let now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const route = routeBySlug(slug)
      let view =
        slug === 'route-3'
          ? await startRoute3AtPin11(route)
          : await startAtPin1(route)
      await driveThroughPin12(route, slug === 'route-3' ? 11 : 1)
      const completedOrders = Array.from({ length: 12 }, (_, index) => index + 1)
      expect(nextOrder()).toBe(13)
      expect(loadRoutePinProgress(route.slug)).toEqual(completedOrders)

      now += 65_000
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
      const stopped = loadActiveExam(route.id, route.slug, route.name_ka)
      expect(stopped?.triggeredSortOrders).toEqual(completedOrders)
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'თავიდან' }))
      })
      await settle()
      await pressStart()

      expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBe(0)
      expect(nextOrder()).toBe(1)
      expect(loadRoutePinProgress(route.slug)).toBeNull()

      view.unmount()
      gps.once = fix(route, 1)
      view = render(<ExamDriveSession route={route} />)
      await settle()
      expect(nextOrder()).toBe(1)
      expect(loadRoutePinProgress(route.slug)).toBeNull()
      view.unmount()
    } finally {
      nowSpy.mockRestore()
    }
  }, 30_000)

  it.each(cases)('%s: stale active-session progress cannot erase route PIN progress', async (slug) => {
    let now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const route = routeBySlug(slug)
      const completedOrders = Array.from({ length: 12 }, (_, index) => index + 1)
      saveRoutePinProgress(route.slug, completedOrders)
      saveActiveExam({
        routeId: route.id,
        routeSlug: route.slug,
        routeName: route.name_ka,
        phase: 'active',
        exam: createExamSession(route.id, route.name_ka),
        userPos: [route.pins[0].lat, route.pins[0].lng],
        heading: 0,
        speedKmh: 5,
        elapsedMs: 45_000,
        triggeredPins: [],
        triggeredSortOrders: [],
        lastPassedSortOrder: null,
        nextSortOrder: 1,
        pendingPinSortOrder: null,
        savedAt: now,
      })

      gps.once = fix(route, 1)
      const view = render(<ExamDriveSession route={route} />)
      await settle()
      expect(nextOrder()).toBe(13)
      expect(loadRoutePinProgress(route.slug)).toEqual(completedOrders)

      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
      const stopped = loadActiveExam(route.id, route.slug, route.name_ka)
      expect(stopped?.triggeredSortOrders).toEqual(completedOrders)
      expect(loadRoutePinProgress(route.slug)).toEqual(completedOrders)
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'თავიდან' }))
      })
      await settle()
      await pressStart()
      expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBe(0)
      expect(nextOrder()).toBe(1)
      expect(loadRoutePinProgress(route.slug)).toBeNull()
      view.unmount()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('route 2: გაგრძელება preserves elapsed time and resumes at PIN 3 after PINs 1 and 2', async () => {
    let now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const route = routeBySlug('route-2')
      const view = await startAtPin1(route)
      await driveTo(route, 1)
      await driveTo(route, 2)
      now += 125_000

      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
      const stopped = loadActiveExam(route.id, route.slug, route.name_ka)
      expect(stopped?.triggeredSortOrders).toEqual([1, 2])
      expect(stopped?.nextSortOrder).toBe(3)
      expect(stopped?.elapsedMs).toBeGreaterThanOrEqual(125_000)

      now += 120_000
      playDetailed.mockClear()
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
      })
      await settle()

      expect(nextOrder()).toBe(3)
      expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBe(stopped?.elapsedMs)
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(3)
      expect(playDetailed).not.toHaveBeenCalled()
      view.unmount()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('route 2: a fresh start and restart begin at PIN 1 without changing Route 1 progress', async () => {
    const route1 = routeBySlug('route-1')
    const route2 = routeBySlug('route-2')
    saveRoutePinProgress(route1.slug, [1, 2])
    saveRoutePinProgress(route2.slug, Array.from({ length: 12 }, (_, index) => index + 1))

    const view = await startAtPin1(route2)
    expect(nextOrder()).toBe(1)
    await driveThroughPin12(route2)
    expect(nextOrder()).toBe(13)
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'თავიდან' }))
    })
    await settle()
    await pressStart()

    expect(nextOrder()).toBe(1)
    expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBeLessThan(1000)
    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2])
    expect(loadRoutePinProgress(route2.slug)).toBeNull()
    view.unmount()
  })

  it.each(cases)('%s uses its street trace', (slug, count) => {
    const route = routeBySlug(slug)
    expect(sorted(route)).toHaveLength(count)
    expect(examRouteLine(slug, route.pins)).toEqual(examRoadTrace(slug, route.pins))
  })

  it.each(cases)('%s: closing the page resumes from the current pin', async (slug) => {
    const route = routeBySlug(slug)
    const first = await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(playedOrders(route)).toEqual([1, 2])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    first.unmount()

    playDetailed.mockClear()
    gps.once = fix(route, 1)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(3)
    expect(screen.queryByRole('button', { name: /გამოცდის დაწყება/ })).toBeNull()

    await driveTo(route, 1)
    expect(playDetailed).not.toHaveBeenCalled()
    expect(nextOrder()).toBe(3)
    await driveTo(route, 3)
    expect(playedOrders(route)).toEqual([3])
    await driveTo(route, 3)
    expect(nextOrder()).toBe(4)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
  })

  it.each(cases)('%s: finishing all pins keeps the completed state after reload', async (slug) => {
    const route = routeBySlug(slug)
    const last = sorted(route).at(-1)!.sort_order
    const first = slug === 'route-3'
      ? await startRoute3AtPin11(route)
      : await startAtPin1(route)
    for (const pin of sorted(route)) {
      if (slug === 'route-3' && pin.sort_order < 11) continue
      if (slug === 'route-3' && pin.sort_order === 12) {
        await driveTo(route, pin.sort_order)
        expect(nextOrder()).toBe(12)
        expect(playedOrders(route)).not.toContain(12)

        for (const [index, [lat, lng]] of route3Road.slice(231, 258).entries()) {
          await sendFix({
            lat,
            lng,
            accuracy: 5,
            heading: 0,
            speed: 5,
            timestamp: Date.now() + index + 1,
          })
        }
        expect(playedOrders(route)).toContain(12)
        continue
      }
      await driveTo(route, pin.sort_order)
    }
    expect(screen.getByTestId('route-complete').textContent).toContain('მარშრუტი დასრულებულია')
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual(
      sorted(route).map((pin) => pin.sort_order),
    )
    first.unmount()

    playDetailed.mockClear()
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(screen.getByTestId('route-complete').textContent).toContain('მარშრუტი დასრულებულია')
    await driveTo(route, 1)
    await driveTo(route, last)
    expect(playDetailed).not.toHaveBeenCalled()

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'თავიდან' }))
    })
    await settle()
    await pressStart()

    expect(nextOrder()).toBe(1)
    expect(screen.queryByTestId('route-complete')).toBeNull()
    expect(loadRoutePinProgress(route.slug)).toBeNull()
  }, 20_000)

  it.each(cases)('%s: pagehide writes the current pin progress', async (slug) => {
    const route = routeBySlug(slug)
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(3)
  })

  it('route 1 and route 2 keep separate progress across route switches and remounts', async () => {
    const route1 = routeBySlug('route-1')
    const route2 = routeBySlug('route-2')

    const route1View = await startAtPin1(route1)
    await driveTo(route1, 1)
    await driveTo(route1, 2)
    await act(async () => window.dispatchEvent(new Event('pagehide')))
    route1View.unmount()

    const route2View = await startAtPin1(route2)
    await driveTo(route2, 1)
    await driveTo(route2, 2)
    await driveTo(route2, 3)
    await act(async () => window.dispatchEvent(new Event('pagehide')))
    route2View.unmount()

    render(<ExamDriveSession route={route1} />)
    await settle()
    expect(nextOrder()).toBe(3)
    expect(loadActiveExam(route1.id, route1.slug, route1.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    cleanup()

    render(<ExamDriveSession route={route2} />)
    await settle()
    expect(nextOrder()).toBe(4)
    expect(loadActiveExam(route2.id, route2.slug, route2.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
  })

  it('starts a new route at PIN 1 without clearing another route’s progress', async () => {
    const route2 = routeBySlug('route-2')
    const route3 = routeBySlug('route-3')
    const view = await startAtPin1(route2)

    for (const pin of sorted(route2)) {
      await driveTo(route2, pin.sort_order)
    }
    const completedRoute2Orders = sorted(route2).map((pin) => pin.sort_order)
    expect(loadRoutePinProgress(route2.slug)).toEqual(completedRoute2Orders)

    playDetailed.mockClear()
    saveRoutePinProgress(route3.slug, Array.from({ length: 10 }, (_, index) => index + 1))
    gps.once = fix(route3, 1)
    view.rerender(<ExamDriveSession route={route3} />)
    await settle()
    await pressStart()

    expect(nextOrder()).toBe(1)
    expect(loadRoutePinProgress(route2.slug)).toEqual(completedRoute2Orders)
    expect(loadRoutePinProgress(route3.slug)).toBeNull()

    await driveTo(route3, 1)
    expect(playedOrders(route3)).toEqual([1])
    expect(loadRoutePinProgress(route3.slug)).toEqual([1])
    expect(loadRoutePinProgress(route2.slug)).toEqual(completedRoute2Orders)
  })

  it('restores independent Route 2 and Route 3 audio queues after route switches', async () => {
    audioTestState.autoEnd = false
    const route2 = routeBySlug('route-2')
    const route3 = routeBySlug('route-3')
    const view = await startAtPin1(route2)
    await driveTo(route2, 1)
    await driveTo(route2, 2)

    const route2State = loadActiveExam(route2.id, route2.slug, route2.name_ka)
    expect(route2State?.pendingPinSortOrder).toBe(1)
    expect(route2State?.queuedPinSortOrders).toEqual([2])

    const route3Pins = sorted(route3)
    const route3Handled = route3Pins.filter((pin) => pin.sort_order <= 2)
    saveActiveExam({
      routeId: route3.id,
      routeSlug: route3.slug,
      routeName: route3.name_ka,
      phase: 'active',
      exam: createExamSession(route3.id, route3.name_ka),
      userPos: [route3Pins[0]!.lat, route3Pins[0]!.lng],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: route3Handled.map((pin) => pin.id),
      triggeredSortOrders: [1, 2],
      lastPassedSortOrder: 2,
      nextSortOrder: 3,
      pendingPinSortOrder: 2,
      queuedPinSortOrders: [3],
      savedAt: Date.now(),
    })

    view.rerender(<ExamDriveSession route={route3} />)
    await settle()
    expect(playDetailed.mock.calls.at(-1)?.[1]).toBe(pinAt(route3, 2).id)
    expect(loadActiveExam(route3.id, route3.slug, route3.name_ka)?.queuedPinSortOrders).toEqual([3])

    view.rerender(<ExamDriveSession route={route2} />)
    await settle()
    expect(playDetailed.mock.calls.at(-1)?.[1]).toBe(pinAt(route2, 1).id)
    expect(loadActiveExam(route2.id, route2.slug, route2.name_ka)?.queuedPinSortOrders).toEqual([2])

    await act(async () => {
      audioTestState.autoEnd = true
      const latestOptions = playDetailed.mock.calls.at(-1)?.[3]
      latestOptions?.onEnded?.()
    })
    await settle()
    expect(playDetailed.mock.calls.at(-1)?.[1]).toBe(pinAt(route2, 2).id)
    expect(loadActiveExam(route3.id, route3.slug, route3.name_ka)?.queuedPinSortOrders).toEqual([3])
  })

  it('route 2 PIN #3 stays quiet at the agency exit and plays at its later road position', async () => {
    const route = routeBySlug('route-2')
    const road = route2Road as [number, number][]
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(nextOrder()).toBe(3)

    playDetailed.mockClear()
    await sendFix({
      lat: road[2][0],
      lng: road[2][1],
      accuracy: 5,
      heading: 0,
      speed: 5,
      timestamp: Date.now() + 1000,
    })
    expect(playDetailed).not.toHaveBeenCalled()
    expect(nextOrder()).toBe(3)

    await sendFix({
      lat: road[13][0],
      lng: road[13][1],
      accuracy: 5,
      heading: 0,
      speed: 0.3,
      timestamp: Date.now() + 2000,
    })
    expect(playedOrders(route)).toEqual([3])
    expect(nextOrder()).toBe(4)
  })

  it('route 1 mid-route progress survives a finish and a route 2 hop in the same mounted session', async () => {
    const route1 = routeBySlug('route-1')
    const route2 = routeBySlug('route-2')
    const view = await startAtPin1(route1)
    await driveTo(route1, 1)
    await driveTo(route1, 2)

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    expect(loadActiveExam(route1.id, route1.slug, route1.name_ka)?.nextSortOrder).toBe(3)

    view.rerender(<ExamDriveSession route={route2} />)
    await settle()
    expect(screen.getByRole('button', { name: /გამოცდის დაწყება/ })).toBeTruthy()
    await pressStart()
    await driveTo(route2, 1)
    await driveTo(route2, 2)
    await driveTo(route2, 3)

    view.rerender(<ExamDriveSession route={route1} />)
    await settle()
    expect(nextOrder()).toBe(3)
    expect(loadActiveExam(route1.id, route1.slug, route1.name_ka)?.triggeredSortOrders).toEqual([1, 2])

    view.rerender(<ExamDriveSession route={route2} />)
    await settle()
    expect(nextOrder()).toBe(4)
    expect(loadActiveExam(route2.id, route2.slug, route2.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
  })

  it.each(cases)('%s: an incomplete empty-pin write does not erase saved progress', async (slug) => {
    const route = routeBySlug(slug)
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 90_000,
      triggeredPins: [uuid(1), uuid(2)],
      triggeredSortOrders: [1, 2],
      lastPassedSortOrder: 2,
      nextSortOrder: 3,
      savedAt: Date.now(),
    })
    gps.once = fix(route, 1)
    const view = render(<ExamDriveSession route={{ ...route, pins: [] }} />)
    await settle()
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(3)

    view.rerender(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(3)
    expect(screen.queryByTestId('route-complete')).toBeNull()
  })

  it.each(cases)('%s: local ids resume, then Supabase UUID pins keep the same next pin', async (slug) => {
    const local = routeBySlug(slug)
    const remote = withRemotePins(local)
    saveActiveExam({
      routeId: local.id,
      routeSlug: local.slug,
      routeName: local.name_ka,
      phase: 'active',
      exam: createExamSession(local.id, local.name_ka),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 45_000,
      triggeredPins: [pinAt(local, 1).id, pinAt(local, 2).id],
      triggeredSortOrders: [1, 2],
      lastPassedSortOrder: 2,
      nextSortOrder: 3,
      savedAt: Date.now(),
    })
    gps.once = fix(local, 1)
    const view = render(<ExamDriveSession route={local} />)
    await settle()
    expect(nextOrder()).toBe(3)

    view.rerender(<ExamDriveSession route={remote} />)
    await settle()
    expect(nextOrder()).toBe(3)
    playDetailed.mockClear()
    await driveTo(remote, 1)
    expect(playDetailed).not.toHaveBeenCalled()
    await driveTo(remote, 3)
    expect(playDetailed.mock.calls[0][1]).toBe(uuid(3))
    expect(loadActiveExam(remote.id, remote.slug, remote.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
  })

  it.each(cases)('%s: a later pin does not play while an earlier one is still next', async (slug) => {
    const route = routeBySlug(slug)
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    playDetailed.mockClear()
    await driveTo(route, 4)
    await driveTo(route, 5)
    expect(playDetailed).not.toHaveBeenCalled()
    expect(nextOrder()).toBe(3)
    expect(screen.queryByTestId('route-complete')).toBeNull()
  })

  it.each(cases)('%s: driving back to a passed pin does not change the next pin', async (slug) => {
    const route = routeBySlug(slug)
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(nextOrder()).toBe(3)
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(playedOrders(route)).toEqual([1, 2])
    expect(nextOrder()).toBe(3)
    expect(screen.queryByTestId('route-complete')).toBeNull()
  })

  it.each(cases)('%s: a stale unmounted session cannot overwrite newer progress', async (slug) => {
    const route = routeBySlug(slug)
    const first = await startAtPin1(route)
    await driveTo(route, 1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])

    gps.once = fix(route, 1)
    const second = render(<ExamDriveSession route={route} />)
    await settle()
    await driveTo(route, 2)
    await driveTo(route, 2)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])

    first.unmount()
    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
    })
    const saved = loadActiveExam(route.id, route.slug, route.name_ka)
    expect(saved?.triggeredSortOrders).toEqual([1, 2])
    expect(saved?.nextSortOrder).toBe(3)
    second.unmount()
  })

  it('a new route 1 exam always starts at PIN 1 even when the first GPS fix is near PIN 10', async () => {
    const route = routeBySlug('route-1')
    gps.once = fix(route, 10)
    const first = render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    await driveTo(route, 10)
    expect(playedOrders(route)).toEqual([])
    expect(nextOrder()).toBe(1)
    first.unmount()

    gps.once = fix(route, 1)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(1)
    expect(screen.queryByRole('button', { name: /გამოცდის დაწყება/ })).toBeNull()
  })
})
