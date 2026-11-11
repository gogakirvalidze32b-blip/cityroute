import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { audioEngine } from '@/lib/audio'
import { examRoadTrace } from '@/lib/pin-route-line'
import { prepareRouteGeometry, projectOrderedPointsToRoute, type ActiveRouteId, type PreparedRouteGeometry } from '@/lib/pure-route-geometry'
import type { GpsPosition } from '@/lib/gps'
import { saveRoutePinProgress } from '@/lib/route-pin-progress'
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
  formatDuration: (ms: number) => `${Math.floor(ms / 1000)}s`,
}))
vi.mock('@/components/ExamLiveMap', () => ({
  ExamLiveMap: ({ nextPin }: { nextPin: PinRow | null }) => (
    <div data-testid="next-pin" data-order={nextPin?.sort_order ?? ''} />
  ),
}))
vi.mock('@/components/ExamErrorGrid', () => ({ ExamErrorGrid: () => null }))
vi.mock('@/components/ExamScoreboard', () => ({ ExamScoreboard: () => null }))
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
const pinAt = (route: RouteWithPins, order: number) => route.pins.find((p) => p.sort_order === order)!
const routeGeometryCache = new WeakMap<RouteWithPins, PreparedRouteGeometry>()
function routeGeometry(route: RouteWithPins): PreparedRouteGeometry {
  const cached = routeGeometryCache.get(route)
  if (cached) return cached
  const geometry = prepareRouteGeometry(
    route.slug as ActiveRouteId,
    examRoadTrace(route.slug, route.pins) ?? route.polyline,
  )
  routeGeometryCache.set(route, geometry)
  return geometry
}
function pinChainage(route: RouteWithPins, order: number): number {
  const projection = projectOrderedPointsToRoute(
    routeGeometry(route),
    route.pins
      .filter((pin) => pin.sort_order <= order)
      .sort((first, second) => first.sort_order - second.sort_order)
      .map((pin) => [pin.lat, pin.lng] as const),
  )
  if (!projection) throw new Error(`Could not project route ${route.slug} through PIN ${order}`)
  return projection.chainageMeters
}
function positionAt(route: RouteWithPins, chainageMeters: number) {
  const geometry = routeGeometry(route)
  const chainage = Math.max(0, Math.min(geometry.totalLengthMeters, chainageMeters))
  let index = geometry.coordinates.length - 2
  for (let candidate = 0; candidate < geometry.coordinates.length - 1; candidate += 1) {
    if (
      geometry.cumulativeMeters[candidate + 1] > geometry.cumulativeMeters[candidate] &&
      geometry.cumulativeMeters[candidate + 1] >= chainage
    ) {
      index = candidate
      break
    }
  }
  const segmentLength =
    geometry.cumulativeMeters[index + 1] - geometry.cumulativeMeters[index]
  const fraction = segmentLength === 0
    ? 0
    : (chainage - geometry.cumulativeMeters[index]) / segmentLength
  const start = geometry.coordinates[index]
  const end = geometry.coordinates[index + 1]
  const dLng = ((end[1] - start[1]) * Math.PI) / 180
  const lat1 = (start[0] * Math.PI) / 180
  const lat2 = (end[0] * Math.PI) / 180
  const heading = (
    (Math.atan2(
      Math.sin(dLng) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng),
    ) * 180) / Math.PI +
    360
  ) % 360
  return {
    lat: start[0] + (end[0] - start[0]) * fraction,
    lng: start[1] + (end[1] - start[1]) * fraction,
    heading,
  }
}
const fixAtChainage = (
  route: RouteWithPins,
  order: number,
  offsetMeters: number,
  timestamp: number,
): GpsPosition => {
  const point = positionAt(route, pinChainage(route, order) + offsetMeters)
  return {
    ...point,
    accuracy: 5,
    speed: 5,
    timestamp,
  }
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
  const originalNow = Object.getOwnPropertyDescriptor(Date, 'now')
  Object.defineProperty(Date, 'now', {
    configurable: true,
    writable: true,
    value: () => pos.timestamp,
  })
  try {
    await act(async () => {
      gps.onFix!(pos)
      await Promise.resolve()
    })
    await settle()
  } finally {
    if (originalNow) Object.defineProperty(Date, 'now', originalNow)
  }
}
async function startAtPin3(route: RouteWithPins, offsetMeters = -20) {
  saveRoutePinProgress(route.slug, [1, 2])
  gps.once = fixAtChainage(route, 3, offsetMeters, Date.now())
  render(<ExamDriveSession route={route} />)
  await settle()
  await act(async () => {
    await userEvent.setup().click(screen.getByRole('button', { name: /გამოცდის დაწყება|გაგრძელება/ }))
  })
  await settle()
  await sendFix(gps.once)
}
/** Plays pins 1 and 2 normally, so PIN 3 is the expected one. */
async function reachPin3(route: RouteWithPins) {
  await startAtPin3(route)
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
    gps.once = null
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  for (const slug of ['route-3', 'route-4']) {
    it(`${slug}: PIN 3 passed unseen between fixes is played once, in order, without lookahead`, async () => {
      const route = remoteRoute(slug)
      await reachPin3(route)
      const before = playedOrders(route).length
      const t = Date.now() + 60000
      await sendFix(fixAtChainage(route, 3, -15, t))
      expect(playedOrders(route)).toHaveLength(before)
      await sendFix(fixAtChainage(route, 3, 5, t + 8000))
      const orders = playedOrders(route)
      expect(orders.slice(before)).toEqual([3])
      expect(nextOrder()).toBe(4)
      // GPS repeats near the same spot never play it again
      await sendFix(fixAtChainage(route, 3, 8, t + 9000))
      await sendFix(fixAtChainage(route, 3, 10, t + 10000))
      expect(playedOrders(route).slice(before)).toEqual([3])
      expect(orders).toEqual([...orders].sort((a, b) => a - b))
    })
  }

  it('route-3: recovers the exact expected PIN after a 30-second GPS outage', async () => {
    const route = remoteRoute('route-3')
    await reachPin3(route)
    const before = playedOrders(route).length
    const t = Date.now() + 60000
    await sendFix(fixAtChainage(route, 3, -15, t))
    await sendFix(fixAtChainage(route, 3, 5, t + 30000))
    expect(playedOrders(route).slice(before)).toEqual([3])
    expect(nextOrder()).toBe(4)
  })

  it('route-3: opposite direction (PIN behind the movement) does not play it', async () => {
    const route = remoteRoute('route-3')
    await startAtPin3(route, 20)
    const before = playedOrders(route).length
    const t = Date.now() + 60000
    await sendFix(fixAtChainage(route, 3, 35, t))
    await sendFix(fixAtChainage(route, 3, 55, t + 8000))
    expect(playedOrders(route)).toHaveLength(before)
    expect(nextOrder()).toBe(3)
  })

  it('route-3: a GPS gap over 60 s does not infer a pass', async () => {
    const route = remoteRoute('route-3')
    await reachPin3(route)
    const before = playedOrders(route).length
    const t = Date.now() + 60000
    await sendFix(fixAtChainage(route, 3, -15, t))
    await sendFix(fixAtChainage(route, 3, 5, t + 65000))
    expect(playedOrders(route)).toHaveLength(before)
    expect(nextOrder()).toBe(3)
  })

  it('route-3: while another voice is playing the PIN waits, then plays after it (never both)', async () => {
    const route = remoteRoute('route-3')
    await reachPin3(route)
    const before = playedOrders(route).length
    const busy = vi.mocked(audioEngine.isBusy)
    busy.mockImplementation(() => true)
    const t = Date.now() + 60000
    await sendFix(fixAtChainage(route, 3, -15, t))
    await sendFix(fixAtChainage(route, 3, 5, t + 8000))
    expect(playedOrders(route)).toHaveLength(before)
    busy.mockImplementation(() => false)
    await settle(550)
    expect(playedOrders(route).slice(before)).toEqual([3])
  })
})
