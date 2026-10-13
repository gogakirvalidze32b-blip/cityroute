import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { EXAM_START_AUDIO, resolvePinAudioUrl } from '@/data/route-audio'
import { applyAuditedPinInstructions, applyRelocatedPin } from '@/hooks/useRoutes'
import { audioEngine } from '@/lib/audio'
import { loadActiveExam } from '@/lib/exam-persistence'
import { examRoadTrace, examRouteLine, pinRouteLine } from '@/lib/pin-route-line'
import { distanceToPinMeters, type GpsPosition } from '@/lib/gps'
import type { PinRow, RouteWithPins } from '@/types/database'

vi.mock('@/context/AuthContext', () => ({
  usePlanFeatures: () => ({ mapNav: true, errorPanel: true, canSwitchViews: true, routeAudio: true }),
}))
vi.mock('@/hooks/useExamLayoutMode', () => ({ useExamLayoutMode: () => 'desktop' as const }))
vi.mock('@/lib/audio', () => ({
  audioEngine: { play: vi.fn(() => Promise.resolve(true)), stopAll: vi.fn(), preloadAll: vi.fn() },
}))

const gps = vi.hoisted(() => ({
  onFix: null as ((pos: GpsPosition) => void) | null,
  once: null as GpsPosition | null,
}))

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
vi.mock('@/components/ExamLiveMap', () => ({
  ExamLiveMap: ({ nextPin }: { nextPin: PinRow | null }) => (
    <div data-testid="next-pin" data-order={nextPin?.sort_order ?? ''}>
      {nextPin?.instruction_ka ?? ''}
    </div>
  ),
}))
vi.mock('@/components/ExamErrorGrid', () => ({ ExamErrorGrid: () => null }))
vi.mock('@/components/ExamScoreboard', () => ({ ExamScoreboard: () => null }))
vi.mock('@/components/ExamViewSwitcher', () => ({ ExamViewSwitcher: () => null }))
vi.mock('@/components/GpsAccuracyBadge', () => ({ GpsAccuracyBadge: () => null }))
vi.mock('@/components/RoutePreviewMap', () => ({ RoutePreviewMap: () => <div data-testid="preview" /> }))
vi.mock('@/components/ExamSummary', () => ({
  ExamSummary: ({ onRestart }: { onRestart: () => void }) => (
    <button type="button" onClick={onRestart}>
      თავიდან
    </button>
  ),
}))

const liveRoutes = applyRelocatedPin(applyAuditedPinInstructions(TELAVI_ROUTES_FALLBACK))
const routeBySlug = (slug: string) => liveRoutes.find((route) => route.slug === slug)!
const route1 = routeBySlug('route-1')
const route4 = routeBySlug('route-4')
const cases = [
  ['route-2', 29],
  ['route-3', 31],
] as const

const play = vi.mocked(audioEngine.play)
const sorted = (route: RouteWithPins) => [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
const pinAt = (route: RouteWithPins, order: number) => route.pins.find((pin) => pin.sort_order === order)!
const ordersOf = (route: RouteWithPins) => sorted(route).map((pin) => pin.sort_order)
const fix = (route: RouteWithPins, order: number, extra: Partial<GpsPosition> = {}): GpsPosition => {
  const pin = pinAt(route, order)
  return { lat: pin.lat, lng: pin.lng, accuracy: 5, heading: null, speed: 0, timestamp: Date.now(), ...extra }
}

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
async function click(name: string | RegExp) {
  await act(async () => {
    await userEvent.setup().click(screen.getByRole('button', { name }))
  })
  await settle()
}
const pressStart = () => click(/გამოცდის დაწყება/)
async function sendFix(pos: GpsPosition) {
  expect(gps.onFix).not.toBeNull()
  await act(async () => {
    gps.onFix!(pos)
    await Promise.resolve()
  })
  await settle()
}
const driveTo = (route: RouteWithPins, order: number) => sendFix(fix(route, order, { speed: 5 }))

/** A pin far enough that standing on it cannot fire `target`’s trigger (Telavi pins often overlap). */
function farFrom(route: RouteWithPins, target: number, candidates: readonly number[]) {
  const here = pinAt(route, target)
  const trigger = pinAt(route, target).trigger_distance_m + 20
  const found = candidates.find((order) => {
    const pin = pinAt(route, order)
    return distanceToPinMeters([pin.lat, pin.lng], [here.lat, here.lng]) > trigger
  })
  expect(found, `need a pin farther than ${trigger} m from pin ${target}`).toBeTruthy()
  return found!
}
const nextOrder = () => Number(screen.getByTestId('next-pin').getAttribute('data-order'))
const nextText = () => screen.getByTestId('next-pin').textContent
const pinPlays = () => play.mock.calls.filter(([, id]) => id !== 'session-start' && id !== 'session-success')
const playedOrders = (route: RouteWithPins) =>
  pinPlays().map(([, id]) => route.pins.find((pin) => pin.id === id)!.sort_order)

async function startAtPin1(route: RouteWithPins) {
  gps.once = fix(route, 1)
  const view = render(<ExamDriveSession route={route} />)
  await settle()
  await pressStart()
  return view
}

async function driveWholeRoute(route: RouteWithPins) {
  for (const order of ordersOf(route)) await driveTo(route, order)
}

function expectCompleted() {
  expect(screen.getByTestId('route-complete').textContent).toContain('მარშრუტი დასრულებულია — ყველა PIN გავლილია.')
  expect(screen.getByTestId('next-pin').getAttribute('data-order')).toBe('')
  expect(screen.getByTestId('next-pin').textContent).toBe('')
  expect(screen.getByRole('button', { name: 'დასრულება' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /გამოცდის დაწყება/ })).toBeNull()
}

describe('routes 2 and 3 resume from the last saved pin', () => {
  beforeEach(() => {
    localStorage.clear()
    play.mockReset()
    play.mockImplementation(() => Promise.resolve(true))
    gps.onFix = null
    gps.once = null
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('does not change route 1 pins, route 4 local pins, or the Tbilisi test route', () => {
    expect(route1.pins).toHaveLength(34)
    expect(route4.pins).toHaveLength(0)
    expect(liveRoutes.some((route) => route.slug === 'test-route-tbilisi')).toBe(false)
  })

  it.each(cases)('%s uses its own street trace and pin order', (slug, count) => {
    const route = routeBySlug(slug)
    const pins = sorted(route)
    const line = examRouteLine(route.slug, pins)
    expect(pins).toHaveLength(count)
    expect(pins.map((pin) => pin.sort_order)).toEqual(Array.from({ length: count }, (_, index) => index + 1))
    expect(line).toEqual(examRoadTrace(route.slug, pins))
    expect(line.length).toBeGreaterThan(pinRouteLine(pins).length)
  })

  it.each(cases)('%s: a new session starts at pin 1 with pin 1’s instruction', async (slug) => {
    const route = routeBySlug(slug)
    await startAtPin1(route)
    expect(nextOrder()).toBe(1)
    expect(nextText()).toBe(pinAt(route, 1).instruction_ka)
    expect(pinPlays()).toHaveLength(0)
    expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
  })

  it.each(cases)('%s: pins hand over in sort_order and a later pin is not skipped', async (slug) => {
    const route = routeBySlug(slug)
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(playedOrders(route)).toEqual([1, 2])
    expect(nextOrder()).toBe(3)
    expect(nextText()).toBe(pinAt(route, 3).instruction_ka)

    const skip = farFrom(route, 3, ordersOf(route).filter((order) => order > 3))
    await driveTo(route, skip)
    expect(playedOrders(route)).toEqual([1, 2])
    expect(nextOrder()).toBe(3)

    await driveTo(route, 3)
    expect(playedOrders(route)).toEqual([1, 2, 3])
    expect(nextOrder()).toBe(4)
  })

  it.each(cases)(
    '%s: closing the page resumes from the current pin, not from the start',
    async (slug) => {
      const route = routeBySlug(slug)
      const first = await startAtPin1(route)
      await driveTo(route, 1)
      await driveTo(route, 2)
      expect(playedOrders(route)).toEqual([1, 2])
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
      first.unmount()

      play.mockClear()
      gps.once = fix(route, 1)
      render(<ExamDriveSession route={route} />)
      await settle()
      expect(screen.getByText(/დაუსრულებელი სესია/)).toBeTruthy()
      await pressStart()
      expect(play).not.toHaveBeenCalled()
      expect(screen.queryByTestId('start-pin-selection')).toBeNull()
      expect(nextOrder()).toBe(3)
      expect(nextText()).toBe(pinAt(route, 3).instruction_ka)

      const elsewhere = farFrom(route, 3, [1, 2, ...ordersOf(route).filter((order) => order > 3)])
      await driveTo(route, elsewhere)
      expect(pinPlays()).toHaveLength(0)
      expect(nextOrder()).toBe(3)
      await driveTo(route, 3)
      expect(playedOrders(route)).toEqual([3])
      expect(nextOrder()).toBe(4)
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
    },
  )

  it.each(cases)('%s: the last pin completes the route and a reload keeps that state', async (slug) => {
    const route = routeBySlug(slug)
    const orders = ordersOf(route)
    const first = await startAtPin1(route)
    await driveWholeRoute(route)
    expect(playedOrders(route)).toEqual(orders)
    expectCompleted()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual(orders)

    play.mockClear()
    await driveTo(route, 1)
    await driveTo(route, orders[orders.length - 1])
    expectCompleted()
    expect(play).not.toHaveBeenCalled()
    first.unmount()

    render(<ExamDriveSession route={route} />)
    await settle()
    expect(screen.getByTestId('route-complete').textContent).toContain('მარშრუტი დასრულებულია')
    expect(screen.queryByText(/დაუსრულებელი სესია/)).toBeNull()

    await pressStart()
    expectCompleted()
    await driveTo(route, 1)
    expectCompleted()
    expect(play).not.toHaveBeenCalled()
  }, 20_000)

  it.each(cases)('%s: only „თავიდან დაწყება“ starts over from pin 1', async (slug) => {
    const route = routeBySlug(slug)
    await startAtPin1(route)
    await driveWholeRoute(route)
    await click('თავიდან დაწყება')
    expect(screen.queryByTestId('route-complete')).toBeNull()
    expect(localStorage.getItem('cityroute-active-exam')).toBeNull()
    expect(screen.getByRole('button', { name: /გამოცდის დაწყება/ })).toBeTruthy()

    play.mockClear()
    gps.once = fix(route, 1)
    await pressStart()
    expect(nextOrder()).toBe(1)
    expect(pinPlays()).toHaveLength(0)
    await driveTo(route, 1)
    expect(playedOrders(route)).toEqual([1])
  }, 20_000)

  it.each(cases)('%s: each pin plays only its own instruction audio', async (slug) => {
    const route = routeBySlug(slug)
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    const calls = pinPlays()
    expect(calls).toHaveLength(2)
    for (const [index, order] of [1, 2].entries()) {
      const pin = pinAt(route, order)
      expect(calls[index][0]).toBe(resolvePinAudioUrl(route.slug, pin))
      expect(calls[index][1]).toBe(pin.id)
      expect(calls[index][2]).toBe(pin.instruction_ka)
    }
  })
})
