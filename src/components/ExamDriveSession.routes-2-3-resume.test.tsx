import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { audioEngine } from '@/lib/audio'
import { createExamSession } from '@/lib/exam-session'
import { loadActiveExam, saveActiveExam } from '@/lib/exam-persistence'
import { examRoadTrace, examRouteLine, EXAM_STREET_LINE_SLUGS } from '@/lib/pin-route-line'
import { distanceToPinMeters, type GpsPosition, type LatLng } from '@/lib/gps'
import { chooseStartPin } from '@/lib/start-pin'
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
const uuid = (order: number) => `00000000-0000-4000-8000-${String(order).padStart(12, '0')}`
function withRemotePins(route: RouteWithPins): RouteWithPins {
  return {
    ...route,
    id: '11111111-1111-4111-8111-111111111111',
    pins: route.pins.map((pin) => ({ ...pin, id: uuid(pin.sort_order) })),
  }
}
const cases = [
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

  it('does not add a Tbilisi test route', () => {
    expect(TELAVI_ROUTES_FALLBACK.some((route) => route.slug === 'test-route-tbilisi')).toBe(false)
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      expect(EXAM_STREET_LINE_SLUGS.has(slug)).toBe(true)
    }
  })

  it('route 1 resumes by sort order; the start announcement already counts pin 1', async () => {
    const route = routeBySlug('route-1')
    const first = await startAtPin1(route)
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

  it('a new route 1 exam can start at PIN 10, and reload keeps that resume', async () => {
    const route = routeBySlug('route-1')
    const pins = sorted(route)
    const line = examRoadTrace(route.slug, pins)!
    const bearing = (from: LatLng, to: LatLng) => {
      const φ1 = (from[0] * Math.PI) / 180
      const φ2 = (to[0] * Math.PI) / 180
      const Δλ = ((to[1] - from[1]) * Math.PI) / 180
      const y = Math.sin(Δλ) * Math.cos(φ2)
      const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
      return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
    }
    let chosen: GpsPosition | null = null
    for (let i = 1; i < line.length && !chosen; i++) {
      const length = distanceToPinMeters(line[i - 1], line[i])
      if (length === 0) continue
      const heading = bearing(line[i - 1], line[i])
      for (let d = 0; d <= length; d += 12) {
        const t = d / length
        const position: LatLng = [
          line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t,
          line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t,
        ]
        const decision = chooseStartPin(
          pins,
          { position, accuracyM: 5, headingDeg: heading, speedMps: 8 },
          line,
        )
        if (decision.kind === 'start' && decision.sortOrder === 10) {
          chosen = { lat: position[0], lng: position[1], accuracy: 5, heading, speed: 8, timestamp: Date.now() }
          break
        }
      }
    }
    expect(chosen).not.toBeNull()
    gps.once = chosen
    const first = render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()
    expect(nextOrder()).toBe(10)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    first.unmount()

    gps.once = fix(route, 1)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(10)
    expect(screen.queryByRole('button', { name: /გამოცდის დაწყება/ })).toBeNull()
  })
})
