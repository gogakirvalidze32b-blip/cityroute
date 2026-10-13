import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { audioEngine } from '@/lib/audio'
import { loadActiveExam } from '@/lib/exam-persistence'
import { examRoadTrace, examRouteLine } from '@/lib/pin-route-line'
import type { GpsPosition } from '@/lib/gps'
import type { PinRow, RouteWithPins } from '@/types/database'

vi.mock('@/context/AuthContext', () => ({
  usePlanFeatures: () => ({ mapNav: true, errorPanel: true, canSwitchViews: true, routeAudio: true }),
}))
vi.mock('@/hooks/useExamLayoutMode', () => ({ useExamLayoutMode: () => 'desktop' as const }))
vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(() => Promise.resolve(true)),
    playDetailed: vi.fn(() => Promise.resolve('played')),
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

const routeBySlug = (slug: string) => TELAVI_ROUTES_FALLBACK.find((route) => route.slug === slug)!
const cases = [
  ['route-2', 29],
  ['route-3', 31],
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

describe('routes 2 and 3 field-test resume on production', () => {
  beforeEach(() => {
    localStorage.clear()
    playDetailed.mockReset()
    playDetailed.mockImplementation(() => Promise.resolve('played'))
    vi.mocked(audioEngine.play).mockReset()
    vi.mocked(audioEngine.play).mockImplementation(() => Promise.resolve(true))
    gps.onFix = null
    gps.once = null
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('does not add a Tbilisi test route or route 4 pins', () => {
    expect(TELAVI_ROUTES_FALLBACK.some((route) => route.slug === 'test-route-tbilisi')).toBe(false)
    expect(routeBySlug('route-4').pins).toHaveLength(0)
    expect(routeBySlug('route-1').pins.length).toBeGreaterThan(1)
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
    const first = await startAtPin1(route)
    for (const pin of sorted(route)) await driveTo(route, pin.sort_order)
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
})
