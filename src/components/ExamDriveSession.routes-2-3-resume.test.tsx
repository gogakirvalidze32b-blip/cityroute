import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { selectableRoutes } from '@/data/selectable-routes'
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
  ExamLiveMap: ({
    nextPin,
    userPos,
    heading,
  }: {
    nextPin: PinRow | null
    userPos: [number, number]
    heading: number
  }) => (
    <div
      data-testid="next-pin"
      data-id={nextPin?.id ?? ''}
      data-order={nextPin?.sort_order ?? ''}
      data-user-pos={userPos.join(',')}
      data-heading={heading}
    >
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
    selectedPinOrder?: number | null
    onPinSelect?: (sortOrder: number) => void
  }) => (
    <button
      type="button"
      data-testid="preview"
      data-selected-order={selectedPinOrder ?? ''}
      onClick={() => onPinSelect?.(3)}
    >
      preview map
    </button>
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
const allRoutePinCases = cases.flatMap(([slug]) => {
  const route = routeBySlug(slug)
  return sorted(route).map((pin) => [slug, pin.sort_order] as const)
})
const fix = (route: RouteWithPins, order: number, extra: Partial<GpsPosition> = {}): GpsPosition => {
  const pin = pinAt(route, order)
  return { lat: pin.lat, lng: pin.lng, accuracy: 5, heading: 0, speed: 5, timestamp: Date.now(), ...extra }
}
const movingFix = (route: RouteWithPins, order: number, extra: Partial<GpsPosition> = {}): GpsPosition => {
  const from = pinAt(route, order)
  const to = pinAt(route, order + 1)
  const dLng = ((to.lng - from.lng) * Math.PI) / 180
  const lat1 = (from.lat * Math.PI) / 180
  const lat2 = (to.lat * Math.PI) / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const heading = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  return fix(route, order, { heading, speed: 8, ...extra })
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
async function chooseManualPinMode() {
  await userEvent.setup().click(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' }))
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

  it('exposes only the four official routes', () => {
    expect(selectableRoutes(TELAVI_ROUTES_FALLBACK).map((route) => route.slug)).toEqual([
      'route-1',
      'route-2',
      'route-3',
      'route-4',
    ])
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      expect(EXAM_STREET_LINE_SLUGS.has(slug)).toBe(true)
    }
  })

  it('shows automatic and manual PIN choices above the start button and defaults to automatic', () => {
    const route = routeBySlug('route-1')
    render(<ExamDriveSession route={route} />)

    const controls = screen.getByTestId('exam-pin-selection-controls')
    const startButton = screen.getByRole('button', { name: '▶ გამოცდის დაწყება' })
    expect(controls.compareDocumentPosition(startButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByRole('combobox', { name: 'PIN-ების არჩევა' })).toBeNull()
  })

  it('discards a manual PIN choice when switching back to automatic mode', async () => {
    const route = routeBySlug('route-1')
    gps.once = fix(route, 1)
    render(<ExamDriveSession route={route} />)
    await settle()

    await chooseManualPinMode()
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }), '4')
    await userEvent.setup().click(screen.getByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' }))
    expect(screen.queryByRole('combobox', { name: 'PIN-ების არჩევა' })).toBeNull()
    await pressStart()

    expect(nextOrder()).toBe(1)
  })

  it('automatic start uses the next PIN after saved progress and keeps that progress', async () => {
    const route = routeBySlug('route-2')
    saveRoutePinProgress(route.slug, [1, 2])
    gps.once = fix(route, 3)
    render(<ExamDriveSession route={route} />)
    await settle()

    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('3')
    await pressStart()

    expect(nextOrder()).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)).toMatchObject({
      nextSortOrder: 3,
      triggeredSortOrders: [1, 2],
    })
  })

  it('automatic start resumes the same PIN after unmount and remount', async () => {
    const route = routeBySlug('route-2')
    saveRoutePinProgress(route.slug, [1, 2])
    gps.once = fix(route, 3)
    const first = render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(3)
    first.unmount()

    gps.once = null
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(3)
  })

  it('refresh resets temporary metrics but preserves the next PIN and restores the map position', async () => {
    const route = routeBySlug('route-2')
    const savedPosition: [number, number] = [41.72, 44.78]
    const exam = createExamSession(route.id, route.name_ka)
    exam.minorTotal = 4
    exam.severeTotal = 1
    saveRoutePinProgress(route.slug, [1, 2, 3, 4])
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam,
      userPos: savedPosition,
      heading: 87,
      speedKmh: 42,
      elapsedMs: 90_000,
      triggeredPins: [1, 2, 3, 4].map((order) => pinAt(route, order).id),
      triggeredSortOrders: [1, 2, 3, 4],
      lastPassedSortOrder: 4,
      nextSortOrder: 5,
      pendingPinSortOrder: null,
      queuedPinSortOrders: [],
      savedAt: Date.now(),
    })

    render(<ExamDriveSession route={route} />)
    await settle()

    expect(nextOrder()).toBe(5)
    expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBeLessThan(1000)
    expect(screen.getByTestId('next-pin').getAttribute('data-user-pos')).toBe(savedPosition.join(','))
    expect(screen.getByTestId('next-pin').getAttribute('data-heading')).toBe('87')
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3, 4])
    const restored = loadActiveExam(route.id, route.slug, route.name_ka)
    expect(restored?.elapsedMs).toBeLessThan(1000)
    expect(restored).toMatchObject({
      speedKmh: 0,
      triggeredSortOrders: [1, 2, 3, 4],
      nextSortOrder: 5,
      exam: { minorTotal: 0, severeTotal: 0 },
    })

    await sendFix(fix(route, 17))
    expect(nextOrder()).toBe(5)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3, 4])
  })

  it('does not fall back when persisted PIN sources conflict', async () => {
    const route = routeBySlug('route-2')
    saveRoutePinProgress(route.slug, [1, 3])
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 30_000,
      triggeredPins: [pinAt(route, 1).id, pinAt(route, 2).id],
      triggeredSortOrders: [1, 2],
      lastPassedSortOrder: 2,
      nextSortOrder: 3,
      savedAt: Date.now(),
    })

    render(<ExamDriveSession route={route} />)
    await settle()

    expect(screen.getByTestId('resume-error')).toBeTruthy()
    expect(nextOrder()).toBe(0)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 3])
  })

  it('a fully completed route stays complete until the user explicitly restarts it', async () => {
    const route = routeBySlug('route-2')
    saveRoutePinProgress(route.slug, sorted(route).map((pin) => pin.sort_order))
    gps.once = fix(route, 1)
    render(<ExamDriveSession route={route} />)
    await settle()

    expect(screen.getByTestId('route-complete')).toBeTruthy()
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('')
    expect(screen.queryByRole('button', { name: /გამოცდის დაწყება/ })).toBeNull()
    expect(loadRoutePinProgress(route.slug)).toEqual(sorted(route).map((pin) => pin.sort_order))

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'თავიდან დაწყება' }))
    })
    await pressStart()

    expect(nextOrder()).toBe(1)
    expect(loadRoutePinProgress(route.slug)).toBeNull()
  })

  it('keeps automatic start progress separate for each route', async () => {
    const routeOne = routeBySlug('route-1')
    const routeTwo = routeBySlug('route-2')
    saveRoutePinProgress(routeOne.slug, [1, 2, 3])
    saveRoutePinProgress(routeTwo.slug, [1])

    gps.once = fix(routeTwo, 2)
    const second = render(<ExamDriveSession route={routeTwo} />)
    await settle()
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('2')
    second.unmount()

    gps.once = fix(routeOne, 4)
    render(<ExamDriveSession route={routeOne} />)
    await settle()
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('4')
    await pressStart()

    expect(nextOrder()).toBe(4)
    expect(loadRoutePinProgress(routeOne.slug)).toEqual([1, 2, 3])
    expect(loadRoutePinProgress(routeTwo.slug)).toEqual([1])
  })

  it('automatic start does not skip incomplete PINs when GPS returns ahead', async () => {
    const route = routeBySlug('route-1')
    saveRoutePinProgress(route.slug, Array.from({ length: 13 }, (_, i) => i + 1))
    gps.once = movingFix(route, 15)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('14')

    await pressStart()
    expect(nextOrder()).toBe(14)
    expect(loadRoutePinProgress(route.slug)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
  })

  it('automatic start ignores an inaccurate GPS fix and continues from the saved progress', async () => {
    const route = routeBySlug('route-1')
    saveRoutePinProgress(route.slug, Array.from({ length: 13 }, (_, i) => i + 1))
    gps.once = fix(route, 16, { speed: 0, heading: null, accuracy: 60 })
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(14)
    expect(loadRoutePinProgress(route.slug)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
  })

  it('automatic start never jumps ahead of the saved progress on a GPS fix', async () => {
    const route = routeBySlug('route-1')
    saveRoutePinProgress(route.slug, [1, 2, 3])
    gps.once = movingFix(route, 19)
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(4)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3])
  })

  it('automatic start does not mark PINs passed from GPS', async () => {
    const route = routeBySlug('route-1')
    const saved = Array.from({ length: 13 }, (_, i) => i + 1)
    for (const extra of [{ speed: 0, heading: null }, { speed: 8, heading: null }, { speed: 0 }] as Partial<GpsPosition>[]) {
      localStorage.clear()
      saveRoutePinProgress(route.slug, saved)
      gps.once = movingFix(route, 15, extra)
      const view = render(<ExamDriveSession route={route} />)
      await settle()
      await pressStart()
      expect(nextOrder()).toBe(14)
      expect(loadRoutePinProgress(route.slug)).toEqual(saved)
      view.unmount()
      cleanup()
    }
  })

  it('automatic start with a far-ahead GPS fix keeps the saved PIN and marks nothing passed', async () => {
    const route = routeBySlug('route-1')
    const saved = Array.from({ length: 13 }, (_, i) => i + 1)
    saveRoutePinProgress(route.slug, saved)
    gps.once = movingFix(route, 19)
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(14)
    expect(loadRoutePinProgress(route.slug)).toEqual(saved)
  })

  it('manual PIN chosen but not started survives a refresh and is stored per route', async () => {
    const routeOne = routeBySlug('route-1')
    const routeTwo = routeBySlug('route-2')
    gps.once = fix(routeOne, 1)
    const first = render(<ExamDriveSession route={routeOne} />)
    await settle()
    await chooseManualPinMode()
    await act(async () => {
      await userEvent.setup().selectOptions(screen.getByRole('combobox'), '7')
    })
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('7')
    first.unmount()
    cleanup()

    // another route has its own, independent selection
    const other = render(<ExamDriveSession route={routeTwo} />)
    await settle()
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' }).getAttribute('aria-pressed')).toBe('true')
    other.unmount()
    cleanup()

    render(<ExamDriveSession route={routeOne} />)
    await settle()
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('7')
  })

  it('automatic GPS logic never overwrites a manual selection, and starting clears it', async () => {
    const route = routeBySlug('route-1')
    saveRoutePinProgress(route.slug, [1, 2, 3])
    gps.once = movingFix(route, 5)
    const first = render(<ExamDriveSession route={route} />)
    await settle()
    await chooseManualPinMode()
    await act(async () => {
      await userEvent.setup().selectOptions(screen.getByRole('combobox'), '9')
    })
    await pressStart()
    expect(nextOrder()).toBe(9)
    first.unmount()
    cleanup()
    expect(localStorage.getItem('cityroute-manual-pin:route-1')).toBeNull()
  })

  it('automatic start never goes back before the saved progress when GPS is at an earlier PIN', async () => {
    const route = routeBySlug('route-1')
    saveRoutePinProgress(route.slug, [1, 2, 3, 4, 5])
    gps.once = fix(route, 2, { speed: 0, heading: null })
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(6)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3, 4, 5])
  })

  it('manual start after finishing continues from the next unpassed PIN and keeps the progress', async () => {
    const route = routeBySlug('route-2')
    const view = await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()
    await chooseManualPinMode()
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('3')
    await pressStart()
    expect(nextOrder()).toBe(3)
    expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBeLessThan(1000)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    view.unmount()
  })

  it('finishing an Auto exam and starting again keeps progress; only თავიდან clears it', async () => {
    const route = routeBySlug('route-2')
    const other = routeBySlug('route-1')
    saveRoutePinProgress(other.slug, [1, 2, 3])
    const view = await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    expect(loadRoutePinProgress(other.slug)).toEqual([1, 2, 3])
    view.unmount()
  })

  it('Auto finish keeps the summary until continued and resumes the next PIN after refresh', async () => {
    const route = routeBySlug('route-2')
    const first = await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    first.unmount()
    cleanup()

    gps.once = null
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(3)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.startMode).toBe('automatic')

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      expect(screen.getByTestId('exam-summary')).toBeTruthy()
      expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])

      await act(async () => {
        await vi.advanceTimersByTimeAsync(4999)
      })
      expect(screen.getByTestId('exam-summary')).toBeTruthy()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(screen.getByTestId('exam-summary')).toBeTruthy()
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
      expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    } finally {
      vi.useRealTimers()
    }

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('3')
    cleanup()

    gps.once = fix(route, 3)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ავტომატურად' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('3')
    await pressStart()
    expect(nextOrder()).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
  })

  it('Manual finish preserves the next PIN choice across summary and refresh', async () => {
    const route = routeBySlug('route-2')
    gps.once = fix(route, 1)
    const first = render(<ExamDriveSession route={route} />)
    await settle()
    await chooseManualPinMode()
    await act(async () => {
      await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }), '1')
    })
    await pressStart()
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.startMode).toBe('manual')
    first.unmount()
    cleanup()

    gps.once = null
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.startMode).toBe('manual')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(screen.getByTestId('exam-summary')).toBeTruthy()
      expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    } finally {
      vi.useRealTimers()
    }

    cleanup()
    gps.once = fix(route, 3)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' }).getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }) as HTMLSelectElement).value).toBe('3')
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('3')
    await pressStart()
    expect(nextOrder()).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
  })

  it('starts and resumes from a manually selected PIN while marking earlier PINs complete', async () => {
    const route = routeBySlug('route-2')
    saveRoutePinProgress(route.slug, [1, 2])
    gps.once = fix(route, 1)
    const first = render(<ExamDriveSession route={route} />)
    await settle()

    await chooseManualPinMode()
    const pinPicker = screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }) as HTMLSelectElement
    expect(pinPicker.value).toBe('3')
    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('3')

    await userEvent.setup().selectOptions(pinPicker, '4')
    await pressStart()
    expect(nextOrder()).toBe(4)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)).toMatchObject({
      nextSortOrder: 4,
      triggeredSortOrders: [1, 2, 3],
    })
    first.unmount()

    gps.once = null
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(4)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(4)
  })

  it('keeps the PIN 8 regression fixed after unmount and remount', async () => {
    const route = routeBySlug('route-1')
    const selectedPin = pinAt(route, 8)
    gps.once = fix(route, 1)
    const first = render(<ExamDriveSession route={route} />)
    await settle()
    await chooseManualPinMode()
    await userEvent.setup().selectOptions(
      screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }),
      '8',
    )
    await pressStart()

    expect(nextOrder()).toBe(8)
    expect(screen.getByTestId('next-pin').getAttribute('data-id')).toBe(selectedPin.id)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)).toMatchObject({
      nextSortOrder: 8,
      triggeredSortOrders: [1, 2, 3, 4, 5, 6, 7],
    })
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3, 4, 5, 6, 7])
    first.unmount()

    gps.once = null
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(8)
    expect(screen.getByTestId('next-pin').getAttribute('data-id')).toBe(selectedPin.id)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(8)
  })

  it('starts, persists, and restores every PIN on all four routes', async () => {
    expect(allRoutePinCases).toHaveLength(127)
    expect(
      Object.fromEntries(
        cases.map(([slug]) => [slug, sorted(routeBySlug(slug)).length]),
      ),
    ).toEqual({ 'route-1': 35, 'route-2': 29, 'route-3': 31, 'route-4': 32 })
    let checked = 0

    for (const [slug, order] of allRoutePinCases) {
      cleanup()
      localStorage.clear()
      const route = routeBySlug(slug)
      const selectedPin = pinAt(route, order)
      gps.once = fix(route, order)
      const first = render(<ExamDriveSession route={route} />)
      await settle()
      await chooseManualPinMode()
      await userEvent.setup().selectOptions(
        screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }),
        String(order),
      )
      await pressStart()

      const precedingOrders = Array.from({ length: order - 1 }, (_, index) => index + 1)
      expect(nextOrder(), `${slug} PIN ${order} active order`).toBe(order)
      expect(screen.getByTestId('next-pin').getAttribute('data-id')).toBe(selectedPin.id)
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toMatchObject({
        nextSortOrder: order,
        triggeredSortOrders: precedingOrders,
      })
      expect(loadRoutePinProgress(route.slug)).toEqual(precedingOrders.length ? precedingOrders : null)
      expect(screen.queryByTestId('route-complete')).toBeNull()
      first.unmount()

      gps.once = null
      render(<ExamDriveSession route={route} />)
      await settle()
      expect(nextOrder(), `${slug} PIN ${order} restored order`).toBe(order)
      expect(screen.getByTestId('next-pin').getAttribute('data-id')).toBe(selectedPin.id)
      expect(screen.queryByTestId('route-complete')).toBeNull()
      checked += 1
    }

    expect(checked).toBe(127)
  }, 120_000)

  it('preselects the first unfinished PIN and preserves map selection', async () => {
    const route = routeBySlug('route-2')
    saveRoutePinProgress(route.slug, [1, 2])
    gps.once = fix(route, 1)
    render(<ExamDriveSession route={route} />)
    await settle()
    await chooseManualPinMode()

    const pinPicker = screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }) as HTMLSelectElement
    expect(pinPicker.value).toBe('3')
    await userEvent.setup().selectOptions(pinPicker, '4')
    expect(screen.getByTestId('selected-preview-pin').textContent).toContain('PIN 4')
    await userEvent.setup().click(screen.getByTestId('preview'))
    expect(pinPicker.value).toBe('3')
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

    // Mid-route finish keeps the PIN progress but drops the active exam (timer reset).
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()

    expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    expect(screen.getByTestId('exam-summary')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'გაგრძელება' })).toBeTruthy()

    // Back on the start page, an agency / PIN 1 GPS fix must not reset to PIN 1.
    playDetailed.mockClear()
    gps.once = fix(route, 1)
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()
    await pressStart()

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
    expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3])

    audioTestState.autoEnd = true
    playDetailed.mockClear()
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()
    await pressStart()

    // PIN 3 was already passed: its progress is kept and its voice is not replayed.
    expect(playDetailed).not.toHaveBeenCalled()
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3])
    expect(nextOrder()).toBe(4)
    expect(audioEngine.unlock).toHaveBeenCalled()
  })

  it('route 1: თავიდან resets time and starts a fresh exam from PIN 1', async () => {
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
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
      expect(loadRoutePinProgress(route.slug)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))

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

      for (let order = 1; order <= 12; order += 1) await driveTo(route, order)
      expect(playedOrders(route)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
      await driveTo(route, 13)
      expect(playedOrders(route).at(-1)).toBe(13)
      expect(nextOrder()).toBe(14)
      view.unmount()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it.each(cases)('%s: finish and restart clears progress and starts at PIN 1', async (slug) => {
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
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
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
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
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

  it('route 2: finish resets the timer, keeps PINs 1-2; გაგრძელება returns to the start page and Auto starts at PIN 3', async () => {
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
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
      expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])

      now += 120_000
      playDetailed.mockClear()
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
      })
      await settle()
      expect(screen.queryByTestId('exam-summary')).toBeNull()
      expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('3')
      await pressStart()

      expect(nextOrder()).toBe(3)
      expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBe(0)
      expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
      expect(playDetailed).not.toHaveBeenCalled()
      view.unmount()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('route 2: restarting after PIN 12 clears only Route 2 progress', async () => {
    const route1 = routeBySlug('route-1')
    const route2 = routeBySlug('route-2')
    saveRoutePinProgress(route1.slug, [1, 2])
    saveRoutePinProgress(route2.slug, Array.from({ length: 12 }, (_, index) => index + 1))

    const view = await startAtPin1(route2)
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

  it('starts a new Route 3 exam at PIN 1 without changing Route 2 progress', async () => {
    const route2 = routeBySlug('route-2')
    const route3 = routeBySlug('route-3')
    const view = await startAtPin1(route2)

    for (const pin of sorted(route2)) {
      await driveTo(route2, pin.sort_order)
    }
    const completedRoute2Orders = sorted(route2).map((pin) => pin.sort_order)
    expect(loadRoutePinProgress(route2.slug)).toEqual(completedRoute2Orders)

    playDetailed.mockClear()
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
    expect(loadActiveExam(route1.id, route1.slug, route1.name_ka)).toBeNull()
    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2])

    view.rerender(<ExamDriveSession route={route2} />)
    await settle()
    expect(screen.getByRole('button', { name: /გამოცდის დაწყება/ })).toBeTruthy()
    await pressStart()
    await driveTo(route2, 1)
    await driveTo(route2, 2)
    await driveTo(route2, 3)

    view.rerender(<ExamDriveSession route={route1} />)
    await settle()
    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2])
    await pressStart()
    expect(nextOrder()).toBe(3)
    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2])
    expect(loadRoutePinProgress(route2.slug)).toEqual([1, 2, 3])

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
