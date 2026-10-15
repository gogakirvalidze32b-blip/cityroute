import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import fixture from '@/data/audio-audit-pins.fixture.json'
import { EXAM_START_AUDIO, resolvePinAudioUrl } from '@/data/route-audio'
import { audioEngine } from '@/lib/audio'
import { createExamSession } from '@/lib/exam-session'
import { loadActiveExam, saveActiveExam } from '@/lib/exam-persistence'
import { examRoadTrace } from '@/lib/pin-route-line'
import { chooseStartPin } from '@/lib/start-pin'
import { distanceToPinMeters, requestGpsOnce, type GpsPosition } from '@/lib/gps'
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

type FixturePin = { route: number; pin: number; lat: number; lng: number; instruction: string }

/** Routes 2–4 have no local pins; use their recorded pins (same coordinates, order, and texts). */
function withFixturePins(n: number): RouteWithPins {
  const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === `route-${n}`)!
  if (route.pins.length > 0) return route
  const rows = (fixture as FixturePin[]).filter((p) => p.route === n).sort((a, b) => a.pin - b.pin)
  return {
    ...route,
    pins: rows.map((p, i) => ({
      id: `p${n}-${p.pin}`,
      route_id: route.id,
      lat: p.lat,
      lng: p.lng,
      radius_m: 25,
      trigger_distance_m: i === 0 || i === rows.length - 1 ? 40 : 50,
      instruction_ka: p.instruction,
      audio_url: null,
      sort_order: p.pin,
      active: true,
    })) as PinRow[],
  }
}

const routes = [1, 2, 3, 4].map(withFixturePins)
const route1 = routes[0]
const play = vi.mocked(audioEngine.play)
const pinAt = (route: RouteWithPins, order: number) => route.pins.find((pin) => pin.sort_order === order)!
const sorted = (route: RouteWithPins) => [...route.pins].sort((a, b) => a.sort_order - b.sort_order)

function fix(lat: number, lng: number, extra: Partial<GpsPosition> = {}): GpsPosition {
  return { lat, lng, accuracy: 5, heading: null, speed: 0, timestamp: Date.now(), ...extra }
}

function bearingDeg(from: PinRow, to: PinRow): number {
  const φ1 = (from.lat * Math.PI) / 180
  const φ2 = (to.lat * Math.PI) / 180
  const Δλ = ((to.lng - from.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** A pin past the middle of the route that the selector places on its own when the car stands on it. */
function midRoutePin(route: RouteWithPins): PinRow {
  const pins = sorted(route)
  const trace = examRoadTrace(route.slug, pins)
  for (const pin of pins.slice(Math.floor(pins.length / 2))) {
    const decision = chooseStartPin(pins, { position: [pin.lat, pin.lng], accuracyM: 5, headingDeg: null, speedMps: 0 }, trace)
    if (decision.kind === 'start' && decision.sortOrder === pin.sort_order) return pin
  }
  throw new Error(`no unambiguous mid-route pin on ${route.slug}`)
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

async function sendFix(pos: GpsPosition) {
  expect(gps.onFix).not.toBeNull()
  await act(async () => {
    gps.onFix!(pos)
    await Promise.resolve()
  })
  await settle()
}

/** Drive onto a pin (moving, no heading: the cue then only needs the trigger zone). */
const driveToPin = (route: RouteWithPins, order: number) =>
  sendFix(fix(pinAt(route, order).lat, pinAt(route, order).lng, { speed: 5 }))

const nextOrder = () => Number(screen.getByTestId('next-pin').getAttribute('data-order'))

async function clickButton(name: string | RegExp) {
  await act(async () => {
    await userEvent.setup().click(screen.getByRole('button', { name }))
  })
  await settle()
}

function saveProgress(route: RouteWithPins, through: number) {
  const done = sorted(route).filter((pin) => pin.sort_order <= through)
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
const pinPlays = () => play.mock.calls.filter(([, id]) => id !== 'session-start' && id !== 'session-success')

function expectPlayedPin(route: RouteWithPins, order: number, call: unknown[]) {
  const pin = pinAt(route, order)
  expect(call[0]).toBe(resolvePinAudioUrl(route.slug, pin))
  expect(call[1]).toBe(pin.id)
  expect(call[2]).toBe(pin.instruction_ka)
}

describe('starting pin of a new exam', () => {
  beforeEach(() => {
    localStorage.clear()
    play.mockReset()
    play.mockImplementation(() => Promise.resolve(true))
    gps.onFix = null
    gps.once = null
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('starts the exam even if the first GPS fix never arrives', async () => {
    vi.mocked(requestGpsOnce).mockImplementationOnce(() => new Promise(() => {}))
    render(<ExamDriveSession route={route1} />)
    await settle()
    await pressStart()
    expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
    expect(screen.queryByRole('button', { name: /გამოცდის დაწყება/ })).toBeNull()
    expect(screen.getByTestId('start-pin-selection')).toBeTruthy()
  })

  it.each(routes.map((route) => [route.slug, route] as const))(
    '%s: at the agency the exam starts at PIN 1 as before',
    async (_slug, route) => {
      const first = sorted(route)[0]
      gps.once = fix(first.lat, first.lng)
      render(<ExamDriveSession route={route} />)
      await settle()
      await pressStart()
      expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
      expect(screen.queryByTestId('start-pin-selection')).toBeNull()
      expect(screen.queryByTestId('start-pin-notice')).toBeNull()
      expect(nextOrder()).toBe(first.sort_order)

      await driveToPin(route, first.sort_order)
      expect(pinPlays()).toHaveLength(1)
      expectPlayedPin(route, first.sort_order, pinPlays()[0])
    },
  )

  it.each(routes.map((route) => [route.slug, route] as const))(
    '%s: started midway, it continues from the pin where the car is; earlier pins never play',
    async (_slug, route) => {
      const start = midRoutePin(route)
      gps.once = fix(start.lat, start.lng)
      render(<ExamDriveSession route={route} />)
      await settle()
      await pressStart()
      expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
      expect(nextOrder()).toBe(start.sort_order)
      expect(screen.getByTestId('start-pin-notice').textContent).toContain(`PIN ${start.sort_order}-დან`)
      // The next instruction is the one where the car is, not PIN 1 far away.
      const first = sorted(route)[0]
      expect(screen.getByTestId('next-pin').textContent).toBe(start.instruction_ka)
      expect(distanceToPinMeters([start.lat, start.lng], [first.lat, first.lng])).toBeGreaterThan(500)
      expect(nextOrder()).not.toBe(first.sort_order)

      const earlier = sorted(route).filter((pin) => pin.sort_order < start.sort_order)
      for (const pin of earlier) await driveToPin(route, pin.sort_order)
      expect(pinPlays()).toHaveLength(0)
      expect(nextOrder()).toBe(start.sort_order)

      await driveToPin(route, start.sort_order)
      expect(pinPlays()).toHaveLength(1)
      expectPlayedPin(route, start.sort_order, pinPlays()[0])
      const after = sorted(route).find((pin) => pin.sort_order > start.sort_order)
      if (after) {
        await driveToPin(route, after.sort_order)
        expect(pinPlays()).toHaveLength(2)
        expectPlayedPin(route, after.sort_order, pinPlays()[1])
      }

      const saved = loadActiveExam(route.id, route.slug, route.name_ka)!
      expect(saved.startPending).toBe(false)
      expect(saved.triggeredSortOrders).toEqual(
        sorted(route)
          .filter((pin) => pin.sort_order <= (after ?? start).sort_order)
          .map((pin) => pin.sort_order),
      )
    },
  )

  it.each(routes.map((route) => [route.slug, route] as const))(
    '%s: with GPS accuracy worse than 20 m it keeps PIN 1 and says why',
    async (_slug, route) => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const start = midRoutePin(route)
      gps.once = fix(start.lat, start.lng, { accuracy: 35 })
      render(<ExamDriveSession route={route} />)
      await settle()
      await pressStart()
      expect(screen.getByTestId('start-pin-selection').textContent).toContain('ზუსტ GPS მდებარეობას ველოდები')
      expect(screen.getByTestId('next-pin').getAttribute('data-order')).toBe('')

      await sendFix(fix(start.lat, start.lng, { accuracy: 35, speed: 5 }))
      expect(screen.getByTestId('start-pin-selection')).toBeTruthy()
      expect(pinPlays()).toHaveLength(0)

      await act(async () => {
        vi.advanceTimersByTime(10_001)
      })
      await settle()
      expect(screen.queryByTestId('start-pin-selection')).toBeNull()
      expect(screen.getByTestId('start-pin-notice').textContent).toContain('GPS სიზუსტე 35 მ')
      expect(nextOrder()).toBe(sorted(route)[0].sort_order)
    },
  )

  it('an accurate fix during the wait still picks the right pin', async () => {
    const start = midRoutePin(route1)
    gps.once = fix(start.lat, start.lng, { accuracy: 60 })
    render(<ExamDriveSession route={route1} />)
    await settle()
    await pressStart()
    expect(screen.getByTestId('start-pin-selection')).toBeTruthy()
    await sendFix(fix(start.lat, start.lng, { accuracy: 6 }))
    expect(screen.queryByTestId('start-pin-selection')).toBeNull()
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(route1, start.sort_order, pinPlays()[0])
    expect(nextOrder()).toBe(start.sort_order + 1)
  })

  it('a car away from the route keeps PIN 1 and says why', async () => {
    gps.once = fix(41.95, 45.6)
    render(<ExamDriveSession route={route1} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(1)
    expect(screen.getByTestId('start-pin-notice').textContent).toContain('მარშრუტის ქუჩაზე არ არის')
  })

  it('route 1 PINs 19 and 24 (5 m apart): waits instead of guessing, then the choice starts at the chosen pin', async () => {
    const p19 = pinAt(route1, 19)
    gps.once = fix(p19.lat, p19.lng)
    render(<ExamDriveSession route={route1} />)
    await settle()
    await pressStart()
    const selection = screen.getByTestId('start-pin-selection')
    expect(selection.textContent).toContain('დაიძარით')
    expect(screen.getByTestId('next-pin').getAttribute('data-order')).toBe('')
    expect(screen.getByRole('button', { name: /PIN 19/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /PIN 24/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /PIN 1 · დასაწყისი/ })).toBeTruthy()

    // Standing still again does not decide, and nothing plays while undecided.
    await sendFix(fix(p19.lat, p19.lng))
    await driveToPin(route1, 19)
    expect(screen.getByTestId('start-pin-selection')).toBeTruthy()
    expect(pinPlays()).toHaveLength(0)

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: /PIN 24/ }))
    })
    await settle()
    expect(screen.queryByTestId('start-pin-selection')).toBeNull()
    expect(nextOrder()).toBe(24)
    await driveToPin(route1, 23)
    expect(pinPlays()).toHaveLength(0)
    await driveToPin(route1, 24)
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(route1, 24, pinPlays()[0])
  })

  it('route 1 PINs 19 and 24: a moving fix towards PIN 20 never starts on the PIN 24 pass', async () => {
    const p19 = pinAt(route1, 19)
    const p20 = pinAt(route1, 20)
    gps.once = fix(p19.lat, p19.lng)
    render(<ExamDriveSession route={route1} />)
    await settle()
    await pressStart()
    expect(screen.getByTestId('start-pin-selection')).toBeTruthy()

    await sendFix(fix(p19.lat, p19.lng, { speed: 8, heading: bearingDeg(p19, p20) }))
    if (screen.queryByTestId('start-pin-selection')) {
      expect(screen.getByTestId('start-pin-selection').textContent).toContain('აირჩიეთ')
    } else {
      expect([19, 20]).toContain(nextOrder())
    }
  })

  it('resume restores saved progress; the current GPS position does not override it', async () => {
    const done = sorted(route1).filter((pin) => pin.sort_order <= 15)
    saveActiveExam({
      routeId: route1.id,
      routeSlug: route1.slug,
      routeName: route1.name_ka,
      phase: 'active',
      exam: createExamSession(route1.id, route1.name_ka),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 60_000,
      triggeredPins: done.map((pin) => pin.id),
      triggeredSortOrders: done.map((pin) => pin.sort_order),
      lastPassedSortOrder: 15,
      nextSortOrder: 16,
      savedAt: Date.now(),
    })
    const p30 = pinAt(route1, 30)
    gps.once = fix(p30.lat, p30.lng)
    render(<ExamDriveSession route={route1} />)
    await settle()
    await pressStart()
    expect(screen.queryByTestId('start-pin-selection')).toBeNull()
    expect(nextOrder()).toBe(16)
    await driveToPin(route1, 30)
    expect(play).not.toHaveBeenCalled()
    expect(nextOrder()).toBe(16)
  })

  it.each(routes.map((route) => [route.slug, route] as const))(
    '%s: resume continues exactly from the saved pin, wherever the car is',
    async (_slug, route) => {
      const pins = sorted(route)
      const savedThrough = pins[2].sort_order
      const elsewhere = midRoutePin(route)
      saveProgress(route, savedThrough)
      gps.once = fix(elsewhere.lat, elsewhere.lng)
      render(<ExamDriveSession route={route} />)
      await settle()
      expect(screen.getByText(/დაუსრულებელი სესია/)).toBeTruthy()
      await pressStart()
      expect(screen.queryByTestId('start-pin-selection')).toBeNull()
      expect(screen.queryByTestId('start-pin-notice')).toBeNull()
      expect(play).not.toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
      expect(nextOrder()).toBe(pins[3].sort_order)

      await driveToPin(route, elsewhere.sort_order)
      expect(pinPlays()).toHaveLength(0)
      expect(nextOrder()).toBe(pins[3].sort_order)
      await driveToPin(route, pins[3].sort_order)
      expect(pinPlays()).toHaveLength(1)
      expectPlayedPin(route, pins[3].sort_order, pinPlays()[0])
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual(
        pins.slice(0, 4).map((pin) => pin.sort_order),
      )
    },
  )

  it.each(routes.map((route) => [route.slug, route] as const))(
    '%s: Finish → Start begins a new exam from the current GPS position, not the old progress',
    async (_slug, route) => {
      const pins = sorted(route)
      saveProgress(route, pins[3].sort_order)
      const first = pins[0]
      gps.once = fix(first.lat, first.lng)
      render(<ExamDriveSession route={route} />)
      await settle()
      await pressStart()
      expect(nextOrder()).toBe(pins[4].sort_order)
      await driveToPin(route, pins[4].sort_order)
      expect(pinPlays()).toHaveLength(1)

      await clickButton('დასრულება')
      expect(localStorage.getItem('cityroute-active-exam')).toBeNull()
      await clickButton('თავიდან')

      // The car is now midway along the route.
      const here = midRoutePin(route)
      await sendFix(fix(here.lat, here.lng))
      play.mockClear()
      await pressStart()
      expect(screen.queryByText(/დაუსრულებელი სესია/)).toBeNull()
      expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
      expect(nextOrder()).toBe(here.sort_order)
      expect(screen.getByTestId('next-pin').textContent).toBe(here.instruction_ka)

      const saved = loadActiveExam(route.id, route.slug, route.name_ka)!
      expect(saved.elapsedMs).toBeLessThan(5_000)
      expect(saved.triggeredSortOrders).toEqual(pins.filter((pin) => pin.sort_order < here.sort_order).map((pin) => pin.sort_order))

      // Old progress (next was pin 6) is not restored: driving there plays nothing.
      await driveToPin(route, pins[5].sort_order)
      expect(pinPlays()).toHaveLength(0)
      await driveToPin(route, here.sort_order)
      expect(pinPlays()).toHaveLength(1)
      expectPlayedPin(route, here.sort_order, pinPlays()[0])
    },
  )

  it.each(routes.map((route) => [route.slug, route] as const))(
    '%s: Finish → Start at the agency begins again at PIN 1 with the start audio',
    async (_slug, route) => {
      const pins = sorted(route)
      saveProgress(route, pins[pins.length - 2].sort_order)
      const first = pins[0]
      gps.once = fix(first.lat, first.lng)
      render(<ExamDriveSession route={route} />)
      await settle()
      await pressStart()
      expect(nextOrder()).toBe(pins[pins.length - 1].sort_order)

      await clickButton('დასრულება')
      await clickButton('თავიდან')
      await sendFix(fix(first.lat, first.lng))
      play.mockClear()
      await pressStart()
      expect(play).toHaveBeenCalledWith(EXAM_START_AUDIO, 'session-start', expect.any(String))
      expect(screen.queryByTestId('start-pin-selection')).toBeNull()
      expect(nextOrder()).toBe(first.sort_order)
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])

      await driveToPin(route, first.sort_order)
      expect(pinPlays()).toHaveLength(1)
      expectPlayedPin(route, first.sort_order, pinPlays()[0])
    },
  )

  it('a save made before the starting pin was chosen picks it on resume (no progress to restore)', async () => {
    const start = midRoutePin(route1)
    saveActiveExam({
      routeId: route1.id,
      routeSlug: route1.slug,
      routeName: route1.name_ka,
      phase: 'active',
      exam: createExamSession(route1.id, route1.name_ka),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 5_000,
      triggeredPins: [],
      triggeredSortOrders: [],
      lastPassedSortOrder: null,
      nextSortOrder: 1,
      startPending: true,
      savedAt: Date.now(),
    })
    gps.once = fix(start.lat, start.lng)
    render(<ExamDriveSession route={route1} />)
    await settle()
    await pressStart()
    expect(screen.getByTestId('start-pin-selection')).toBeTruthy()
    await sendFix(fix(start.lat, start.lng))
    expect(pinPlays()).toHaveLength(1)
    expectPlayedPin(route1, start.sort_order, pinPlays()[0])
    expect(nextOrder()).toBe(start.sort_order + 1)
  })
})

describe('every route: strict order from the first pin to the last', () => {
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

  it.each(routes.map((route) => [route.slug, route] as const))(
    '%s: each pin hands over to the next at once, passed pins never return, the last pin completes the route',
    async (_slug, route) => {
      const pins = sorted(route)
      gps.once = fix(pins[0].lat, pins[0].lng)
      render(<ExamDriveSession route={route} />)
      await settle()
      await pressStart()
      expect(nextOrder()).toBe(pins[0].sort_order)

      for (const [index, pin] of pins.entries()) {
        await driveToPin(route, pin.sort_order)
        expect(pinPlays().map(([, id]) => id)).toEqual(pins.slice(0, index + 1).map((p) => p.id))
        const next = pins[index + 1]
        const shown = screen.getByTestId('next-pin')
        expect(shown.getAttribute('data-order')).toBe(next ? String(next.sort_order) : '')
        expect(shown.textContent).toBe(next ? next.instruction_ka : '')
      }
      expect(screen.getByTestId('route-complete')).toBeTruthy()

      play.mockClear()
      for (const pin of [pins[0], pins[Math.floor(pins.length / 2)], pins[pins.length - 1], pins[0]]) {
        await driveToPin(route, pin.sort_order)
      }
      expect(play).not.toHaveBeenCalled()
      expect(screen.getByTestId('route-complete')).toBeTruthy()
      expect(screen.getByTestId('next-pin').getAttribute('data-order')).toBe('')
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual(
        pins.map((pin) => pin.sort_order),
      )
    },
  )
})
