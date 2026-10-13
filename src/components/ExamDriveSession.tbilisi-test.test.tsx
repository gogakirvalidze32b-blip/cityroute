import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import fs from 'node:fs'
import path from 'node:path'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyLocalTbilisiTestPin, LOCAL_TBILISI_TEST_ROUTE as route } from '@/data/local-tbilisi-test-pin'
import { EXAM_START_AUDIO, resolvePinAudioUrl } from '@/data/route-audio'
import { applyAuditedPinInstructions, applyRelocatedPin } from '@/hooks/useRoutes'
import { audioEngine } from '@/lib/audio'
import { loadActiveExam } from '@/lib/exam-persistence'
import type { GpsPosition } from '@/lib/gps'
import type { PinRow } from '@/types/database'

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

const EXPECTED = [
  { lat: 41.6786037, lng: 44.9795425, instruction: 'გთხოვთ, მოუხვიოთ მარჯვნივ' },
  { lat: 41.6789698, lng: 44.9786878, instruction: 'გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ' },
  { lat: 41.6792766, lng: 44.9781393, instruction: 'გთხოვთ, იმოძრაოთ პირდაპირ' },
]

const play = vi.mocked(audioEngine.play)
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
async function sendFix(pos: GpsPosition) {
  expect(gps.onFix).not.toBeNull()
  await act(async () => {
    gps.onFix!(pos)
    await Promise.resolve()
  })
  await settle()
}
const driveTo = (order: number) => sendFix(fix(order, { speed: 5 }))
const nextOrder = () => Number(screen.getByTestId('next-pin').getAttribute('data-order'))
const pinPlays = () => play.mock.calls.filter(([, id]) => id !== 'session-start' && id !== 'session-success')
const playedOrders = () => pinPlays().map(([, id]) => route.pins.find((p) => p.id === id)!.sort_order)

describe('standalone test city „ტესტი — თბილისი“', () => {
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

  it('has exactly the three given pins, in order, and nothing else', () => {
    expect(route.name_ka).toBe('ტესტი — თბილისი')
    expect([...route.pins].sort((a, b) => a.sort_order - b.sort_order).map((p) => ({ lat: p.lat, lng: p.lng, instruction: p.instruction_ka }))).toEqual(EXPECTED)
    expect(route.pins.map((p) => p.sort_order)).toEqual([1, 2, 3])
    expect(route.slug).not.toMatch(/^route-\d+$/)
    expect(route.city_id).not.toMatch(/telavi/i)
  })

  it('is added next to the Telavi routes without changing any of them', () => {
    const before = structuredClone(TELAVI_ROUTES_FALLBACK)
    const routes = applyRelocatedPin(applyAuditedPinInstructions(applyLocalTbilisiTestPin(TELAVI_ROUTES_FALLBACK)))
    const telavi = routes.filter((r) => r.slug !== route.slug)
    expect(telavi).toEqual(applyRelocatedPin(applyAuditedPinInstructions(before)))
    expect(routes.filter((r) => r.slug === route.slug)).toEqual([route])
    expect(route.slug).toBe('test-route-tbilisi')
  })

  it('uses the exact WAV for each instruction; only pin 1 has no recording yet', () => {
    for (const p of route.pins) {
      const url = resolvePinAudioUrl(route.slug, p)
      expect(decodeURI(String(url))).toBe(`/audio/points/${p.instruction_ka}.wav`)
      expect(fs.existsSync(path.resolve('public/audio/points', `${p.instruction_ka}.wav`))).toBe(p.sort_order !== 1)
    }
  })

  it('plays 1 → 2 → 3 once each; driving back past them repeats nothing', async () => {
    gps.once = fix(1)
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(1)

    await driveTo(3)
    expect(pinPlays()).toHaveLength(0)
    for (const order of [1, 1, 2, 2, 3, 3]) await driveTo(order)
    expect(playedOrders()).toEqual([1, 2, 3])
    for (const [url, , text] of pinPlays()) expect(decodeURI(String(url))).toBe(`/audio/points/${text}.wav`)

    for (const order of [2, 1, 2, 3, 1]) await driveTo(order)
    expect(playedOrders()).toEqual([1, 2, 3])
  })

  it('Finish → Start is a new session from the current GPS position, without the old progress', async () => {
    gps.once = fix(1)
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    await driveTo(1)
    await driveTo(2)
    await driveTo(3)
    expect(playedOrders()).toEqual([1, 2, 3])

    await click('დასრულება')
    expect(localStorage.getItem('cityroute-active-exam')).toBeNull()
    await click('თავიდან')

    // Now standing at pin 2.
    await sendFix(fix(2))
    play.mockClear()
    await pressStart()
    expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
    expect(screen.queryByText(/დაუსრულებელი სესია/)).toBeNull()
    expect(nextOrder()).toBe(2)
    const saved = loadActiveExam(route.id, route.slug, route.name_ka)!
    expect(saved.triggeredSortOrders).toEqual([1])
    expect(saved.elapsedMs).toBeLessThan(5_000)

    await driveTo(1)
    expect(pinPlays()).toHaveLength(0)
    await driveTo(2)
    await driveTo(3)
    expect(playedOrders()).toEqual([2, 3])
  })

  it('Finish → Start at pin 1 starts again from pin 1', async () => {
    gps.once = fix(2)
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(2)
    await driveTo(2)
    await click('დასრულება')
    await click('თავიდან')

    await sendFix(fix(1))
    play.mockClear()
    await pressStart()
    expect(nextOrder()).toBe(1)
    for (const order of [1, 2, 3]) await driveTo(order)
    expect(playedOrders()).toEqual([1, 2, 3])
  })

  it('Resume restores the saved progress, wherever the car is', async () => {
    gps.once = fix(1)
    const first = render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    await driveTo(1)
    await driveTo(2)
    expect(playedOrders()).toEqual([1, 2])
    first.unmount()

    play.mockClear()
    gps.once = fix(1)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(screen.getByText(/დაუსრულებელი სესია/)).toBeTruthy()
    await pressStart()
    expect(play).not.toHaveBeenCalled()
    expect(screen.queryByTestId('start-pin-selection')).toBeNull()
    expect(nextOrder()).toBe(3)

    await driveTo(1)
    await driveTo(2)
    expect(pinPlays()).toHaveLength(0)
    await driveTo(3)
    expect(playedOrders()).toEqual([3])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3])
  })
})
