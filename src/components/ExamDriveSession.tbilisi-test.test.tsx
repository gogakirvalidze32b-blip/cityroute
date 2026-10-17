import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import fs from 'node:fs'
import path from 'node:path'
import { ExamDriveSession } from './ExamDriveSession'
// fs/path: assert original WAV files exist on disk for mapped instructions
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyLocalTbilisiTestPin, LOCAL_TBILISI_TEST_ROUTE as route } from '@/data/local-tbilisi-test-pin'
import { resolvePinAudioUrl } from '@/data/route-audio'
import { applyRelocatedPin } from '@/hooks/useRoutes'
import { audioEngine } from '@/lib/audio'
import { loadActiveExam } from '@/lib/exam-persistence'
import type { GpsPosition } from '@/lib/gps'
import type { PinRow } from '@/types/database'

vi.mock('@/context/AuthContext', () => ({
  usePlanFeatures: () => ({ mapNav: true, errorPanel: true, canSwitchViews: true, routeAudio: true }),
}))
vi.mock('@/hooks/useExamLayoutMode', () => ({ useExamLayoutMode: () => 'desktop' as const }))
vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(() => Promise.resolve(true)),
    playDetailed: vi.fn(() => Promise.resolve('played')),
    unlock: vi.fn(),
    stopAll: vi.fn(),
    preloadAll: vi.fn(),
    isBusy: vi.fn(() => false),
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
  ExamSummary: ({
    onRestart,
    onContinue,
  }: {
    onRestart: () => void
    onContinue?: () => void
  }) => (
    <div data-testid="exam-summary">
      {onContinue ? (
        <button type="button" onClick={onContinue}>
          გაგრძელება
        </button>
      ) : null}
      <button type="button" onClick={onRestart}>
        თავიდან
      </button>
    </div>
  ),
}))

const EXPECTED = [
  { lat: 41.6789378, lng: 44.9788424, instruction: 'გთხოვთ, მოუხვიოთ მარჯვნივ' },
  { lat: 41.6792766, lng: 44.9781393, instruction: 'გთხოვთ, იმოძრაოთ პირდაპირ' },
  { lat: 41.6798062, lng: 44.9783244, instruction: 'გთხოვთ, 300 მეტრში მოუხვიოთ მარჯვნივ' },
  { lat: 41.6811228, lng: 44.979409, instruction: 'გთხოვთ, მოუხვიოთ მარჯვნივ' },
  { lat: 41.6811569, lng: 44.9808128, instruction: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
]
const ORDERS = [1, 2, 3, 4, 5]
/** Pins with no exact instruction→WAV map entry (engine must stay silent — no TTS). */
const WITHOUT_WAV = [3]

const playDetailed = vi.mocked(audioEngine.playDetailed)
const pin = (order: number) => route.pins.find((p) => p.sort_order === order)!
const fix = (order: number, extra: Partial<GpsPosition> = {}): GpsPosition => ({
  lat: pin(order).lat,
  lng: pin(order).lng,
  accuracy: 5,
  heading: null,
  speed: 0,
  timestamp: Date.now(),
  ...extra,
})

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
let fixesSent = 0
async function sendFix(pos: GpsPosition) {
  expect(gps.onFix).not.toBeNull()
  fixesSent += 1
  await act(async () => {
    gps.onFix!(pos)
    await Promise.resolve()
  })
  await settle()
}
const driveTo = (order: number) => sendFix(fix(order, { speed: 5 }))
const nextOrder = () => Number(screen.getByTestId('next-pin').getAttribute('data-order'))
const nextText = () => screen.getByTestId('next-pin').textContent
const pinPlays = () =>
  playDetailed.mock.calls.filter(([, id]) => id !== 'session-start' && id !== 'session-success')
const playedOrders = () => pinPlays().map(([, id]) => route.pins.find((p) => p.id === id)!.sort_order)

async function startAtPin1() {
  gps.once = fix(1)
  const view = render(<ExamDriveSession route={route} />)
  await settle()
  await pressStart()
  return view
}
async function driveWholeRoute() {
  for (const order of ORDERS) await driveTo(order)
}
function expectCompleted() {
  expect(screen.getByTestId('route-complete').textContent).toContain(
    'მარშრუტი დასრულებულია — ყველა PIN გავლილია.',
  )
  expect(screen.getByTestId('next-pin').getAttribute('data-order')).toBe('')
  expect(screen.getByTestId('next-pin').textContent).toBe('')
  expect(screen.getByRole('button', { name: 'დასრულება' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /გამოცდის დაწყება/ })).toBeNull()
}

describe('standalone test city „ტესტი — თბილისი“', () => {
  beforeEach(() => {
    localStorage.clear()
    playDetailed.mockReset()
    playDetailed.mockImplementation(() => Promise.resolve('played'))
    gps.onFix = null
    gps.once = null
    fixesSent = 0
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('has exactly the five given pins, in order; the old start coordinate is gone', () => {
    expect(route.name_ka).toBe('ტესტი — თბილისი')
    const ordered = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    expect(ordered.map((p) => ({ lat: p.lat, lng: p.lng, instruction: p.instruction_ka }))).toEqual(
      EXPECTED,
    )
    expect(route.pins.map((p) => p.sort_order)).toEqual(ORDERS)
    expect(route.pins.some((p) => p.lat === 41.6786037 && p.lng === 44.9795425)).toBe(false)
    expect(route.slug).toBe('test-route-tbilisi')
    expect(route.city_id).not.toMatch(/telavi/i)
  })

  it('is added next to the Telavi routes without changing any of them', () => {
    const before = structuredClone(TELAVI_ROUTES_FALLBACK)
    const routes = applyLocalTbilisiTestPin(applyRelocatedPin(TELAVI_ROUTES_FALLBACK))
    const telavi = routes.filter((r) => r.slug !== route.slug)
    expect(telavi).toEqual(applyRelocatedPin(before))
    expect(routes.filter((r) => r.slug === route.slug)).toEqual([route])
  })

  it('each pin uses the exact instruction→WAV map (or null); never a wrong/similar file', () => {
    expect(decodeURI(resolvePinAudioUrl(route.slug, pin(1))!)).toBe(
      '/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
    )
    expect(decodeURI(resolvePinAudioUrl(route.slug, pin(2))!)).toBe(
      '/audio/points/გთხოვთ, იმოძრაოთ პირდაპირ.wav',
    )
    expect(decodeURI(resolvePinAudioUrl(route.slug, pin(4))!)).toBe(
      '/audio/points/მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav',
    )
    expect(decodeURI(resolvePinAudioUrl(route.slug, pin(5))!)).toBe(
      '/audio/points/გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ.wav',
    )
    for (const order of WITHOUT_WAV) {
      expect(resolvePinAudioUrl(route.slug, pin(order))).toBeNull()
    }
    expect(fs.existsSync(path.resolve('public/audio/points', 'მალე, გთხოვთ მოუხვიოთ მარჯვნივ.wav'))).toBe(
      true,
    )
  })

  it('a new session starts at pin 1 without session-start voice', async () => {
    await startAtPin1()
    expect(nextOrder()).toBe(1)
    expect(nextText()).toBe(pin(1).instruction_ka)
    expect(pinPlays()).toHaveLength(0)
    expect(playDetailed).not.toHaveBeenCalledWith(expect.anything(), 'session-start', expect.anything())
  })

  it('every pin hands over to the next one: 1 → 2 → 3 → 4 → 5', async () => {
    await startAtPin1()
    for (const order of ORDERS) {
      const fixesBefore = fixesSent
      await driveTo(order)
      expect(fixesSent - fixesBefore).toBe(1)
      expect(playedOrders()).toEqual(ORDERS.slice(0, order))
      if (order < 5) {
        expect(nextOrder()).toBe(order + 1)
        expect(nextText()).toBe(pin(order + 1).instruction_ka)
      }
    }
    expectCompleted()
  })

  it('a pin is not skipped: pin 4 or 5 does not play while pin 3 is the target', async () => {
    await startAtPin1()
    await driveTo(1)
    await driveTo(2)
    await driveTo(4)
    await driveTo(5)
    expect(playedOrders()).toEqual([1, 2])
    expect(nextOrder()).toBe(3)
  })

  it('the last pin completes the route', async () => {
    await startAtPin1()
    await driveWholeRoute()
    expect(playedOrders()).toEqual(ORDERS)
    expectCompleted()
    playDetailed.mockClear()
    for (const order of [1, 2, 3, 4, 5, 1]) {
      await driveTo(order)
      expectCompleted()
    }
    expect(playDetailed).not.toHaveBeenCalled()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual(ORDERS)
  })

  it('a reload after the last pin keeps the completed state', async () => {
    const first = await startAtPin1()
    await driveWholeRoute()
    first.unmount()

    playDetailed.mockClear()
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(screen.getByTestId('route-complete').textContent).toContain('მარშრუტი დასრულებულია')
    expect(playDetailed).not.toHaveBeenCalled()
  })

  it('თავიდან after mid-route stop clears progress; a fresh mount starts at pin 1', async () => {
    const first = await startAtPin1()
    await driveTo(1)
    await driveTo(2)
    await click('დასრულება')
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])

    await click('თავიდან')
    expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
    first.unmount()

    playDetailed.mockClear()
    gps.onFix = null
    gps.once = fix(1)
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(1)
    await driveTo(1)
    expect(playedOrders()).toEqual([1])
  })

  it('mid-route დასრულება keeps progress for გაგრძელება', async () => {
    await startAtPin1()
    await driveTo(1)
    await driveTo(2)
    await click('დასრულება')

    const saved = loadActiveExam(route.id, route.slug, route.name_ka)
    expect(saved?.triggeredSortOrders).toEqual([1, 2])
    expect(screen.getByRole('button', { name: 'გაგრძელება' })).toBeTruthy()

    playDetailed.mockClear()
    gps.once = fix(1)
    await click('გაგრძელება')
    expect(nextOrder()).toBe(3)
    await driveTo(3)
    expect(playedOrders()).toEqual([3])
  })
})
