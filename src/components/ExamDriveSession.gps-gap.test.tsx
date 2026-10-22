import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { SPEED_ZONES } from '@/data/speed-limits'
import { audioEngine } from '@/lib/audio'
import { examRoadTrace } from '@/lib/pin-route-line'
import { roadPointAt } from '@/lib/speed-limit'
import type { GpsPosition } from '@/lib/gps'
import type { PinRow, RouteWithPins } from '@/types/database'

vi.mock('@/context/AuthContext', () => ({
  usePlanFeatures: () => ({ mapNav: true, errorPanel: true, canSwitchViews: true, routeAudio: true }),
}))
vi.mock('@/hooks/useExamLayoutMode', () => ({ useExamLayoutMode: () => 'desktop' as const }))
vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(() => Promise.resolve(true)),
    playDetailed: vi.fn((_url, _id, _instruction, options) => {
      options?.onEnded?.()
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
  onError: null as ((err: GeolocationPositionError) => void) | null,
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
    watchGps: vi.fn((onFix: (pos: GpsPosition) => void, onError?: (err: GeolocationPositionError) => void) => {
      gps.onFix = onFix
      gps.onError = onError ?? null
      return () => {
        if (gps.onFix === onFix) gps.onFix = null
        if (gps.onError === onError) gps.onError = null
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
  ExamLiveMap: ({ nextPin, userPos }: { nextPin: PinRow | null; userPos: [number, number] }) => (
    <>
      <div data-testid="next-pin" data-order={nextPin?.sort_order ?? ''} />
      <div data-testid="map-position" data-position={userPos.join(',')} />
    </>
  ),
}))
vi.mock('@/components/ExamErrorGrid', () => ({ ExamErrorGrid: () => null }))
vi.mock('@/components/ExamScoreboard', () => ({
  ExamScoreboard: ({ speedLimitKmh }: { speedLimitKmh: number | null }) => (
    <div data-testid="speed-limit" data-limit={speedLimitKmh ?? 'unknown'} />
  ),
}))
vi.mock('@/components/ExamViewSwitcher', () => ({ ExamViewSwitcher: () => null }))
vi.mock('@/components/GpsAccuracyBadge', () => ({ GpsAccuracyBadge: () => null }))
vi.mock('@/components/RoutePreviewMap', () => ({ RoutePreviewMap: () => <div data-testid="preview" /> }))
vi.mock('@/components/ExamSummary', () => ({ ExamSummary: () => null }))

const uuid = (order: number) => `00000000-0000-4000-8000-${String(order).padStart(12, '0')}`
function remoteRoute(slug: string): RouteWithPins {
  const route = TELAVI_ROUTES_FALLBACK.find((r) => r.slug === slug)!
  return { ...route, id: '11111111-1111-4111-8111-111111111111', pins: route.pins.map((p) => ({ ...p, id: uuid(p.sort_order) })) }
}
const playDetailed = vi.mocked(audioEngine.playDetailed)
const M_LAT = 110540
const pinAt = (route: RouteWithPins, order: number) => route.pins.find((p) => p.sort_order === order)!
const fixAt = (route: RouteWithPins, order: number, northM: number, t: number): GpsPosition => {
  const p = pinAt(route, order)
  return { lat: p.lat + northM / M_LAT, lng: p.lng, accuracy: 5, heading: 0, speed: 5, timestamp: t }
}
const playedOrders = (route: RouteWithPins) =>
  playDetailed.mock.calls.map(([, id]) => route.pins.find((p) => p.id === id)!.sort_order)
const nextOrder = () => Number(screen.getByTestId('next-pin').getAttribute('data-order'))

async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}
async function sendFix(pos: GpsPosition) {
  await act(async () => {
    gps.onFix!(pos)
    await Promise.resolve()
  })
  await settle()
}
async function startAt(route: RouteWithPins, order: number) {
  gps.once = fixAt(route, order, 0, Date.now())
  render(<ExamDriveSession route={route} />)
  await settle()
  await act(async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: /გამოცდის დაწყება|გაგრძელება/ }))
  })
  await settle()
}
/** Plays pins 1 and 2 normally, so PIN 3 is the expected one. */
async function reachPin3(route: RouteWithPins) {
  await startAt(route, 1)
  const t = Date.now()
  await sendFix(fixAt(route, 1, 0, t))
  await sendFix(fixAt(route, 2, 0, t + 1000))
  expect(nextOrder()).toBe(3)
}

describe('GPS gap: expected PIN passed between two fixes (component)', () => {
  beforeEach(() => {
    localStorage.clear()
    playDetailed.mockReset()
    playDetailed.mockImplementation((_url, _id, _instruction, options) => {
      options?.onEnded?.()
      return Promise.resolve('played')
    })
    vi.mocked(audioEngine.isBusy).mockReset()
    vi.mocked(audioEngine.isBusy).mockImplementation(() => false)
    gps.onFix = null
    gps.onError = null
    gps.once = null
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('keeps the last map position but clears a stale speed limit until the next GPS fix', async () => {
    const route = remoteRoute('route-2')
    await startAt(route, 1)

    const road = examRoadTrace(route.slug, route.pins)!
    const zone = SPEED_ZONES[route.slug]![0]
    const point = roadPointAt(road, (zone.from + zone.to) / 2)
    await sendFix({
      lat: point[0],
      lng: point[1],
      accuracy: 5,
      heading: 0,
      speed: 5,
      timestamp: Date.now(),
    })
    expect(screen.getByTestId('speed-limit').getAttribute('data-limit')).toBe(String(zone.limitKmh))
    const lastMapPosition = screen.getByTestId('map-position').getAttribute('data-position')

    await act(async () => {
      gps.onError?.({
        code: 2,
        message: 'GPS unavailable',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError)
    })

    expect(screen.getByTestId('speed-limit').getAttribute('data-limit')).toBe('unknown')
    expect(screen.getByTestId('map-position').getAttribute('data-position')).toBe(lastMapPosition)

    await sendFix({
      lat: point[0],
      lng: point[1],
      accuracy: 5,
      heading: 0,
      speed: 5,
      timestamp: Date.now() + 1000,
    })
    expect(screen.getByTestId('speed-limit').getAttribute('data-limit')).toBe(String(zone.limitKmh))
  })

  for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
    it(`${slug}: PIN 3 passed unseen between fixes is played once, in order, without lookahead`, async () => {
      const route = remoteRoute(slug)
      await reachPin3(route)
      const before = playedOrders(route).length
      const t = Date.now() + 60000
      await sendFix(fixAt(route, 3, -100, t))
      expect(playedOrders(route)).toHaveLength(before)
      await sendFix(fixAt(route, 3, 100, t + 8000))
      const orders = playedOrders(route)
      expect(orders.slice(before)).toEqual([3])
      expect(nextOrder()).toBe(4)
      // GPS repeats near the same spot never play it again
      await sendFix(fixAt(route, 3, 110, t + 9000))
      await sendFix(fixAt(route, 3, 120, t + 10000))
      expect(playedOrders(route).slice(before)).toEqual([3])
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  }

  it('route-3: recovers the exact expected PIN after a 30-second GPS outage', async () => {
    const route = remoteRoute('route-3')
    await reachPin3(route)
    const before = playedOrders(route).length
    const t = Date.now() + 60000
    await sendFix(fixAt(route, 3, -100, t))
    await sendFix(fixAt(route, 3, 100, t + 30000))
    expect(playedOrders(route).slice(before)).toEqual([3])
    expect(nextOrder()).toBe(4)
  })

  it('route-3: opposite direction (PIN behind the movement) does not play it', async () => {
    const route = remoteRoute('route-3')
    await reachPin3(route)
    const before = playedOrders(route).length
    const t = Date.now() + 60000
    await sendFix(fixAt(route, 3, 100, t))
    await sendFix(fixAt(route, 3, 300, t + 8000))
    expect(playedOrders(route)).toHaveLength(before)
    expect(nextOrder()).toBe(3)
  })

  it('route-3: a GPS gap over 60 s does not infer a pass', async () => {
    const route = remoteRoute('route-3')
    await reachPin3(route)
    const before = playedOrders(route).length
    const t = Date.now() + 60000
    await sendFix(fixAt(route, 3, -100, t))
    await sendFix(fixAt(route, 3, 100, t + 65000))
    expect(playedOrders(route)).toHaveLength(before)
    expect(nextOrder()).toBe(3)
  })

  it('route-4: keeps the return-pass speed limit after a temporary GPS loss', async () => {
    const route = remoteRoute('route-4')
    await startAt(route, 1)

    const road = examRoadTrace(route.slug, route.pins)!
    for (const u of [15, 35, 55, 75, 95, 115, 130, 139.4]) {
      const point = roadPointAt(road, u)
      await sendFix({
        lat: point[0],
        lng: point[1],
        accuracy: 5,
        heading: 0,
        speed: 5,
        timestamp: Date.now() + u * 100,
      })
    }
    expect(screen.getByTestId('speed-limit').getAttribute('data-limit')).toBe('50')

    await act(async () => {
      gps.onError?.({
        code: 2,
        message: 'GPS unavailable',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError)
    })
    expect(screen.getByTestId('speed-limit').getAttribute('data-limit')).toBe('unknown')

    const returnPoint = roadPointAt(road, 139.4)
    await sendFix({
      lat: returnPoint[0],
      lng: returnPoint[1],
      accuracy: 5,
      heading: 0,
      speed: 5,
      timestamp: Date.now() + 20_000,
    })
    expect(screen.getByTestId('speed-limit').getAttribute('data-limit')).toBe('50')
  })

  it('route-3: while another voice is playing the PIN waits, then plays after it (never both)', async () => {
    const route = remoteRoute('route-3')
    await reachPin3(route)
    const before = playedOrders(route).length
    const busy = vi.mocked(audioEngine.isBusy)
    busy.mockImplementation(() => true)
    const t = Date.now() + 60000
    await sendFix(fixAt(route, 3, -100, t))
    await sendFix(fixAt(route, 3, 100, t + 8000))
    expect(playedOrders(route)).toHaveLength(before)
    busy.mockImplementation(() => false)
    await sendFix(fixAt(route, 3, 130, t + 9000))
    expect(playedOrders(route).slice(before)).toEqual([3])
  })
})
