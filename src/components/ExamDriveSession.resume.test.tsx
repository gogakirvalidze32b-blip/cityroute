import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { EXAM_START_AUDIO, resolvePinAudioUrl } from '@/data/route-audio'
import { audioEngine } from '@/lib/audio'
import { createExamSession } from '@/lib/exam-session'
import { loadActiveExam, saveActiveExam } from '@/lib/exam-persistence'
import { RESUME_PENDING_MESSAGE } from '@/lib/route-resume'
import type { GpsPosition } from '@/lib/gps'
import type { PinRow, RouteWithPins } from '@/types/database'

vi.mock('@/context/AuthContext', () => ({
  usePlanFeatures: () => ({ mapNav: true, errorPanel: true, canSwitchViews: true, routeAudio: true }),
}))

vi.mock('@/hooks/useExamLayoutMode', () => ({
  useExamLayoutMode: () => 'desktop' as const,
}))

vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(() => Promise.resolve(true)),
    stopAll: vi.fn(),
    preloadAll: vi.fn(),
  },
}))

const gps = vi.hoisted(() => ({
  onFix: null as ((pos: GpsPosition) => void) | null,
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
    requestGpsOnce: vi.fn(() =>
      Promise.resolve({ lat: 41.95, lng: 45.6, accuracy: 5, heading: null, speed: 0, timestamp: Date.now() }),
    ),
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

const localRoute1 = TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-1')!
const localRoute2 = TELAVI_ROUTES_FALLBACK.find((route) => route.slug === 'route-2')!
const uuid = (order: number) => `00000000-0000-4000-8000-${String(order).padStart(12, '0')}`
const remoteRoute1: RouteWithPins = {
  ...localRoute1,
  id: '11111111-1111-4111-8111-111111111111',
  pins: localRoute1.pins.map((pin) => ({ ...pin, id: uuid(pin.sort_order) })),
}

const play = vi.mocked(audioEngine.play)
const pinAt = (route: RouteWithPins, order: number) => route.pins.find((pin) => pin.sort_order === order)!

function saveProgress(route: RouteWithPins, through: number) {
  const done = route.pins.filter((pin) => pin.sort_order <= through)
  saveActiveExam({
    routeId: route.id,
    routeSlug: route.slug,
    routeName: route.name_ka,
    phase: 'active',
    exam: createExamSession(route.id, route.name_ka),
    userPos: null,
    heading: 0,
    speedKmh: 0,
    elapsedMs: 60_000,
    triggeredPins: done.map((pin) => pin.id),
    triggeredSortOrders: done.map((pin) => pin.sort_order),
    lastPassedSortOrder: through,
    nextSortOrder: through + 1,
    savedAt: Date.now(),
  })
}

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function pressStart() {
  await act(async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: /გამოცდის დაწყება/ }))
  })
  await settle()
}

async function driveTo(lat: number, lng: number, accuracy = 5) {
  expect(gps.onFix).not.toBeNull()
  await act(async () => {
    gps.onFix!({ lat, lng, accuracy, heading: null, speed: 5, timestamp: Date.now() })
    await Promise.resolve()
  })
  await settle()
}

const driveToPin = (route: RouteWithPins, order: number, accuracy = 5) => {
  const pin = pinAt(route, order)
  return driveTo(pin.lat, pin.lng, accuracy)
}

function nextShown() {
  const el = screen.getByTestId('next-pin')
  return { order: Number(el.getAttribute('data-order')), text: el.textContent }
}

function pinPlays() {
  return play.mock.calls.filter(([, id]) => id !== 'session-start' && id !== 'session-success')
}

function expectPlayedPin(route: RouteWithPins, order: number, call: unknown[]) {
  const pin = pinAt(route, order)
  const url = resolvePinAudioUrl(route.slug, pin)
  expect(url).toBeTruthy()
  expect(call[0]).toBe(url)
  expect(call[2]).toBe(pin.instruction_ka)
  expect(decodeURI(String(call[0]))).toBe(`/audio/points/${pin.instruction_ka}.wav`)
}

describe('exam resume in the live session', () => {
  beforeEach(() => {
    localStorage.clear()
    play.mockReset()
    play.mockImplementation(() => Promise.resolve(true))
    gps.onFix = null
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('resumes pins 1-15 at pin 16 and plays only pin 16 with its own audio', async () => {
    saveProgress(localRoute1, 15)
    render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()

    expect(nextShown()).toEqual({ order: 16, text: pinAt(localRoute1, 16).instruction_ka })
    expect(play).not.toHaveBeenCalled()

    await driveToPin(localRoute1, 1)
    await driveToPin(localRoute1, 15)
    expect(play).not.toHaveBeenCalled()
    expect(nextShown().order).toBe(16)

    await driveToPin(localRoute1, 16)
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(localRoute1, 16, pinPlays()[0])

    await driveToPin(localRoute1, 16)
    expect(pinPlays()).toHaveLength(1)
    expect(nextShown().order).toBe(17)

    const saved = loadActiveExam(localRoute1.id, 'route-1', localRoute1.name_ka)!
    expect(saved.triggeredSortOrders).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(saved.nextSortOrder).toBe(17)
  })

  it('keeps progress across close and reopen of a session driven from pin 1', async () => {
    const first = render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()
    expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
    expect(nextShown().order).toBe(1)

    for (let order = 1; order <= 15; order++) await driveToPin(localRoute1, order)
    expect(pinPlays().map((call) => call[1])).toEqual(
      Array.from({ length: 15 }, (_, i) => pinAt(localRoute1, i + 1).id),
    )
    first.unmount()

    play.mockClear()
    render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()
    expect(play).not.toHaveBeenCalled()
    expect(nextShown()).toEqual({ order: 16, text: pinAt(localRoute1, 16).instruction_ka })

    await driveToPin(localRoute1, 16)
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(localRoute1, 16, pinPlays()[0])
  })

  it('resumes pins 1-20 at pin 21 after a reload', async () => {
    saveProgress(localRoute1, 20)
    render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()
    expect(nextShown()).toEqual({ order: 21, text: pinAt(localRoute1, 21).instruction_ka })

    await driveToPin(localRoute1, 20)
    expect(play).not.toHaveBeenCalled()
    await driveToPin(localRoute1, 21)
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(localRoute1, 21, pinPlays()[0])
  })

  it('resumes a save made with Supabase pin ids while the local pin list is shown, then after the swap', async () => {
    saveProgress(remoteRoute1, 15)
    const view = render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()
    expect(nextShown().order).toBe(16)

    view.rerender(<ExamDriveSession route={remoteRoute1} />)
    await settle()
    expect(nextShown().order).toBe(16)

    await driveToPin(remoteRoute1, 1)
    expect(play).not.toHaveBeenCalled()
    await driveToPin(remoteRoute1, 16)
    expect(pinPlays()).toHaveLength(1)
    expect(pinPlays()[0][1]).toBe(uuid(16))
    expectPlayedPin(remoteRoute1, 16, pinPlays()[0])
  })

  it('waits for the pin list instead of starting at pin 1 for an old id-only save', async () => {
    const done = remoteRoute1.pins.filter((pin) => pin.sort_order <= 15)
    saveActiveExam({
      routeId: remoteRoute1.id,
      routeSlug: 'route-1',
      routeName: remoteRoute1.name_ka,
      phase: 'active',
      exam: createExamSession(remoteRoute1.id, remoteRoute1.name_ka),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 60_000,
      triggeredPins: done.map((pin) => pin.id),
      lastPassedPinId: uuid(15),
      nextPinId: uuid(16),
      savedAt: Date.now(),
    })
    const view = render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()
    expect(screen.getByText(RESUME_PENDING_MESSAGE)).toBeTruthy()
    expect(screen.queryByTestId('next-pin')).toBeNull()
    expect(play).not.toHaveBeenCalled()

    view.rerender(<ExamDriveSession route={remoteRoute1} />)
    await settle()
    await pressStart()
    expect(nextShown().order).toBe(16)
    await driveToPin(remoteRoute1, 16)
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(remoteRoute1, 16, pinPlays()[0])
  })

  it('does not queue pin 16 twice while it is starting, even across a pin list swap', async () => {
    saveProgress(localRoute1, 15)
    let startPin16: (started: boolean) => void = () => {}
    play.mockImplementation(() => new Promise<boolean>((resolve) => (startPin16 = resolve)))
    const view = render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()

    await driveToPin(localRoute1, 16)
    await driveToPin(localRoute1, 16)
    view.rerender(<ExamDriveSession route={remoteRoute1} />)
    await settle()
    await driveToPin(remoteRoute1, 16)
    expect(pinPlays()).toHaveLength(1)

    await act(async () => {
      startPin16(true)
      await Promise.resolve()
    })
    await settle()
    play.mockImplementation(() => Promise.resolve(true))
    await driveToPin(remoteRoute1, 16)
    expect(pinPlays()).toHaveLength(1)
    expect(nextShown().order).toBe(17)
    expect(loadActiveExam(remoteRoute1.id, 'route-1', remoteRoute1.name_ka)?.nextSortOrder).toBe(17)
  })

  it('does not skip pin 16 on a coarse fix and plays it when a good fix returns', async () => {
    saveProgress(localRoute1, 15)
    render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()

    await driveToPin(localRoute1, 16, 200)
    await driveToPin(localRoute1, 17, 200)
    await driveToPin(localRoute1, 17)
    expect(play).not.toHaveBeenCalled()
    expect(nextShown().order).toBe(16)

    await driveToPin(localRoute1, 16)
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(localRoute1, 16, pinPlays()[0])
  })

  it('does not use the route 1 save on route 2', async () => {
    saveProgress(localRoute1, 15)
    render(<ExamDriveSession route={localRoute2} />)
    await settle()
    expect(screen.queryByText(/დაუსრულებელი სესია/)).toBeNull()
    await pressStart()
    expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
    expect(pinPlays()).toHaveLength(0)
    expect(loadActiveExam(localRoute2.id, 'route-2', localRoute2.name_ka)?.triggeredSortOrders).toEqual([])
  })

  it('shows pin diagnostics only when turned on, without changing what plays', async () => {
    saveProgress(localRoute1, 15)
    const first = render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()
    expect(screen.queryByTestId('pin-debug')).toBeNull()
    first.unmount()

    localStorage.setItem('cityroute-pin-debug', '1')
    render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()
    const pin16 = pinAt(localRoute1, 16)
    await driveTo(pin16.lat + 0.01, pin16.lng)
    const panel = screen.getByTestId('pin-debug')
    expect(panel.textContent).toContain('შემდეგი PIN 16')
    expect(panel.textContent).toContain('ტრიგერის ზონის გარეთ')
    expect(play).not.toHaveBeenCalled()

    await driveToPin(localRoute1, 16)
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(localRoute1, 16, pinPlays()[0])
    expect(screen.getByTestId('pin-debug').textContent).toContain('PIN 16 · აუდიო დაიწყო')
  })

  it('starts a new exam at pin 1 after finishing', async () => {
    saveProgress(localRoute1, 15)
    render(<ExamDriveSession route={localRoute1} />)
    await settle()
    await pressStart()
    await act(async () => {
      await userEvent.setup().click(screen.getByText('დასრულება'))
    })
    await settle()
    expect(localStorage.getItem('cityroute-active-exam')).toBeNull()

    await act(async () => {
      await userEvent.setup().click(screen.getByText('თავიდან'))
    })
    await settle()
    play.mockClear()
    await pressStart()
    expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
    expect(nextShown().order).toBe(1)

    await driveToPin(localRoute1, 1)
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(localRoute1, 1, pinPlays()[0])
  })
})
