import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { selectableRoutes } from '@/data/selectable-routes'
import { audioEngine } from '@/lib/audio'
import { createExamSession, loadExamHistory } from '@/lib/exam-session'
import { loadActiveExam, saveActiveExam } from '@/lib/exam-persistence'
import { examRoadTrace, examRouteLine, EXAM_STREET_LINE_SLUGS } from '@/lib/pin-route-line'
import {
  prepareRouteGeometry,
  projectOrderedPointsToRoute,
  projectPointToRoute,
  type ActiveRouteId,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'
import { identifyRoundaboutGateTarget } from '@/lib/pin-audio'
import type { GpsPosition } from '@/lib/gps'
import { resolvePinAudioUrl } from '@/data/route-audio'
import { ROUTE_FINISH_PIN_RANGES } from '@/data/route-finish'
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
    onFinish,
    onContinue,
    finalized,
  }: {
    onRestart: () => void
    onFinish?: () => void
    onContinue?: () => void
    finalized?: boolean
  }) => (
    <div data-testid="exam-summary">
      {onContinue && (
        <button type="button" onClick={onContinue}>
          გაგრძელება
        </button>
      )}
      {!finalized && <button type="button" onClick={onFinish}>დასრულება</button>}
      {finalized && <button type="button" onClick={onRestart}>ახალი გამოცდა</button>}
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
  ['route-3', 30],
  ['route-4', 32],
] as const

const playDetailed = vi.mocked(audioEngine.playDetailed)
const pinAt = (route: RouteWithPins, order: number) => route.pins.find((pin) => pin.sort_order === order)!
const sorted = (route: RouteWithPins) => [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
const routeGeometryCache = new WeakMap<RouteWithPins, PreparedRouteGeometry>()
const simulatedRouteChainage = new Map<string, number>()
const simulatedInitialFix = new Map<string, GpsPosition>()
let simulatedGpsTime = 0

function routeGeometry(route: RouteWithPins): PreparedRouteGeometry {
  const cached = routeGeometryCache.get(route)
  if (cached) return cached
  const coordinates = examRoadTrace(route.slug, route.pins) ?? route.polyline
  const geometry = prepareRouteGeometry(route.slug as ActiveRouteId, coordinates)
  routeGeometryCache.set(route, geometry)
  return geometry
}

function routePositionAt(geometry: PreparedRouteGeometry, chainageMeters: number) {
  const chainage = Math.max(0, Math.min(geometry.totalLengthMeters, chainageMeters))
  let index = geometry.coordinates.length - 2
  for (let candidate = 0; candidate < geometry.coordinates.length - 1; candidate += 1) {
    const segmentLength =
      geometry.cumulativeMeters[candidate + 1] - geometry.cumulativeMeters[candidate]
    if (segmentLength > 0 && geometry.cumulativeMeters[candidate + 1] >= chainage) {
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

function pinChainageAfter(
  route: RouteWithPins,
  pin: PinRow,
  minimumChainage: number,
): number {
  const geometry = routeGeometry(route)
  const candidates: Array<{ chainage: number; crossTrack: number }> = []
  for (let index = 0; index < geometry.coordinates.length - 1; index += 1) {
    if (geometry.cumulativeMeters[index + 1] <= geometry.cumulativeMeters[index]) continue
    const segment = prepareRouteGeometry(route.slug as ActiveRouteId, [
      geometry.coordinates[index],
      geometry.coordinates[index + 1],
    ])
    const projection = projectPointToRoute(segment, [pin.lat, pin.lng])
    if (!projection || projection.crossTrackMeters > 20) continue
    const chainage = geometry.cumulativeMeters[index] + projection.chainageMeters
    if (chainage < minimumChainage - 5) continue
    candidates.push({ chainage, crossTrack: projection.crossTrackMeters })
  }
  const closestCrossTrack = Math.min(...candidates.map((candidate) => candidate.crossTrack))
  const best = candidates
    .filter((candidate) => candidate.crossTrack <= closestCrossTrack + 5)
    .sort((first, second) => first.chainage - second.chainage)[0] ?? null
  if (best && best.chainage < minimumChainage && minimumChainage - best.chainage <= 5) {
    return minimumChainage
  }
  const fallback = best?.chainage ??
    projectPointToRoute(geometry, [pin.lat, pin.lng])?.chainageMeters ??
    0
  return Math.abs(fallback - minimumChainage) <= 25 ? minimumChainage : fallback
}

function pinChainageBefore(
  route: RouteWithPins,
  pin: PinRow,
  maximumChainage: number,
): number | null {
  const geometry = routeGeometry(route)
  let best: number | null = null
  for (let index = 0; index < geometry.coordinates.length - 1; index += 1) {
    if (geometry.cumulativeMeters[index] >= maximumChainage) continue
    const segment = prepareRouteGeometry(route.slug as ActiveRouteId, [
      geometry.coordinates[index],
      geometry.coordinates[index + 1],
    ])
    const projection = projectPointToRoute(segment, [pin.lat, pin.lng])
    if (!projection || projection.crossTrackMeters > 20) continue
    const chainage = geometry.cumulativeMeters[index] + projection.chainageMeters
    if (chainage < maximumChainage && (best === null || chainage > best)) best = chainage
  }
  return best
}

async function sendRouteFix(
  route: RouteWithPins,
  geometry: PreparedRouteGeometry,
  chainageMeters: number,
  speed = 5,
) {
  const previous = simulatedRouteChainage.get(route.slug)
  const travelMeters = previous === undefined ? 0 : Math.abs(chainageMeters - previous)
  simulatedGpsTime = Math.max(simulatedGpsTime, Date.now() - 1000) +
    Math.max(1000, (travelMeters / 25) * 1000)
  const point = routePositionAt(geometry, chainageMeters)
  const position: GpsPosition = {
    lat: point.lat,
    lng: point.lng,
    accuracy: 5,
    heading: previous !== undefined && chainageMeters < previous
      ? (point.heading + 180) % 360
      : point.heading,
    speed,
    timestamp: simulatedGpsTime,
  }
  const originalNow = Object.getOwnPropertyDescriptor(Date, 'now')
  Object.defineProperty(Date, 'now', {
    configurable: true,
    writable: true,
    value: () => simulatedGpsTime + 1000,
  })
  try {
    await act(async () => {
      expect(gps.onFix).not.toBeNull()
      gps.onFix!(position)
      await Promise.resolve()
    })
  } finally {
    if (originalNow) Object.defineProperty(Date, 'now', originalNow)
  }
  simulatedRouteChainage.set(route.slug, chainageMeters)
  await settle()
}

async function travelToChainage(
  route: RouteWithPins,
  geometry: PreparedRouteGeometry,
  targetChainage: number,
  finalSpeed = 5,
) {
  const previous = simulatedRouteChainage.get(route.slug)
  const start = previous ?? Math.max(0, targetChainage - 30)
  const steps = Math.max(1, Math.ceil(Math.abs(targetChainage - start) / 120))
  for (let step = 1; step <= steps; step += 1) {
    const chainage = start + ((targetChainage - start) * step) / steps
    await sendRouteFix(
      route,
      geometry,
      chainage,
      step === steps ? finalSpeed : 5,
    )
  }
}

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
  simulatedRouteChainage.clear()
  simulatedInitialFix.clear()
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
async function driveTo(route: RouteWithPins, order: number) {
  if (gps.once && simulatedInitialFix.get(route.slug) !== gps.once) {
    simulatedRouteChainage.delete(route.slug)
    simulatedInitialFix.set(route.slug, gps.once)
  }
  const pin = pinAt(route, order)
  const geometry = routeGeometry(route)
  let minimumChainage = simulatedRouteChainage.get(route.slug) ?? 0
  const needsInitialChainage = !simulatedRouteChainage.has(route.slug)
  if (needsInitialChainage) {
    const saved = loadActiveExam(route.id, route.slug, route.name_ka)
    const handledOrders = new Set([
      ...(loadRoutePinProgress(route.slug) ?? []),
      ...(saved?.triggeredSortOrders ?? []),
    ])
    const priorProjection = projectOrderedPointsToRoute(
      geometry,
      sorted(route)
        .filter((item) => handledOrders.has(item.sort_order))
        .map((item) => [item.lat, item.lng] as const),
    )
    minimumChainage = priorProjection?.chainageMeters ?? 0
  }
  const chainage = pinChainageAfter(route, pin, minimumChainage)
  if (needsInitialChainage) {
    const latitudeDeltaMeters = ((gps.once?.lat ?? Infinity) - pin.lat) * 111_320
    const longitudeDeltaMeters =
      ((gps.once?.lng ?? Infinity) - pin.lng) *
      111_320 *
      Math.cos((pin.lat * Math.PI) / 180)
    const startsNearTarget = Math.hypot(latitudeDeltaMeters, longitudeDeltaMeters) <= 25
    const approachStart = startsNearTarget ? chainage : minimumChainage
    simulatedRouteChainage.set(route.slug, Math.max(0, approachStart - 30))
  }
  const gateTarget = identifyRoundaboutGateTarget(route.slug, order, pin.lat, pin.lng)
  if (gateTarget) {
    const gateChainage =
      projectPointToRoute(geometry, [gateTarget.lat, gateTarget.lng])?.chainageMeters ?? chainage
    await travelToChainage(route, geometry, Math.max(0, gateChainage - 10), 0.2)
    await travelToChainage(route, geometry, gateChainage + 270)
    await travelToChainage(route, geometry, Math.max(0, gateChainage - 10))
    await travelToChainage(route, geometry, gateChainage + 5)
    return
  }

  await travelToChainage(route, geometry, Math.max(minimumChainage, chainage - 25))
  await travelToChainage(route, geometry, Math.max(minimumChainage, chainage - 10))
  await travelToChainage(route, geometry, chainage + 5)
}
const nextOrder = () => Number(screen.getByTestId('next-pin').getAttribute('data-order'))
const playedOrders = (route: RouteWithPins) =>
  playDetailed.mock.calls.flatMap(([, id]) => {
    const pin = route.pins.find((item) => item.id === id)
    return pin ? [pin.sort_order] : []
  })

async function startAtPin1(route: RouteWithPins) {
  gps.once = fix(route, 1)
  const view = render(<ExamDriveSession route={route} />)
  await settle()
  await pressStart()
  const startChainage = pinChainageAfter(route, pinAt(route, 1), 0)
  simulatedRouteChainage.set(route.slug, startChainage)
  simulatedInitialFix.set(route.slug, gps.once!)
  return view
}

async function startAtFinishSection(route: RouteWithPins) {
  const finishStart = ROUTE_FINISH_PIN_RANGES[route.slug].start
  const completedOrders = sorted(route)
    .filter((pin) => pin.sort_order < finishStart)
    .map((pin) => pin.sort_order)
  saveRoutePinProgress(route.slug, completedOrders)

  const geometry = routeGeometry(route)
  const firstFinishChainage = pinChainageAfter(route, pinAt(route, finishStart), 0)
  const initialChainage = Math.max(0, firstFinishChainage - 30)
  const point = routePositionAt(geometry, initialChainage)
  gps.once = {
    lat: point.lat,
    lng: point.lng,
    accuracy: 5,
    heading: point.heading,
    speed: 5,
    timestamp: Date.now(),
  }
  const view = render(<ExamDriveSession route={route} />)
  await settle()
  await pressStart()
  simulatedRouteChainage.set(route.slug, initialChainage)
  simulatedInitialFix.set(route.slug, gps.once)
  return view
}

async function startRoute3AtPin11(route: RouteWithPins) {
  const priorOrders = route.pins.filter((pin) => pin.sort_order < 11).map((pin) => pin.sort_order)
  const priorPins = route.pins.filter((pin) => pin.sort_order < 11).map((pin) => pin.id)
  const { lat, lng } = pinAt(route, 11)
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
  simulatedRouteChainage.set(route.slug, pinChainageAfter(route, pinAt(route, 11), 0))
  simulatedInitialFix.set(route.slug, gps.once!)
  return view
}

async function driveThroughPins(route: RouteWithPins, startOrder = 1, endOrder = 12) {
  for (const pin of sorted(route)) {
    if (pin.sort_order >= startOrder && pin.sort_order <= endOrder) {
      await driveTo(route, pin.sort_order)
    }
  }
}

describe('Telavi field-test routes keep strict progress and resume on production', () => {
  beforeEach(() => {
    localStorage.clear()
    simulatedRouteChainage.clear()
    simulatedInitialFix.clear()
    simulatedGpsTime = 0
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

  it('removes Route 3 PIN 12 from Auto and Manual selection without renumbering later PINs', async () => {
    const route = routeBySlug('route-3')
    const orders = sorted(route).map((pin) => pin.sort_order)
    expect(orders).not.toContain(12)
    expect(orders.slice(9, 14)).toEqual([10, 11, 13, 14, 15])

    render(<ExamDriveSession route={route} />)
    await chooseManualPinMode()
    const options = Array.from(
      screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }).querySelectorAll('option'),
    ).map((option) => option.value)
    expect(options).not.toContain('12')
    expect(options).toContain('13')
    expect(options).toContain('14')
  })

  it('continues Route 3 from PIN 11 to PIN 13 and then PIN 14 in automatic mode', async () => {
    const route = routeBySlug('route-3')
    saveRoutePinProgress(route.slug, Array.from({ length: 11 }, (_, index) => index + 1))
    gps.once = fix(route, 13)
    render(<ExamDriveSession route={route} />)
    await settle()
    await pressStart()

    expect(nextOrder()).toBe(13)
    await driveTo(route, 13)
    expect(nextOrder()).toBe(14)
    expect(loadRoutePinProgress(route.slug)).toEqual([
      ...Array.from({ length: 11 }, (_, index) => index + 1),
      13,
    ])
    expect(playedOrders(route)).not.toContain(12)
  })

  it('drops removed Route 3 PIN 12 from a restored audio queue and continues at PIN 13', async () => {
    const route = routeBySlug('route-3')
    const completed = Array.from({ length: 11 }, (_, index) => index + 1)
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: [pinAt(route, 11).lat, pinAt(route, 11).lng],
      heading: 0,
      speedKmh: 5,
      elapsedMs: 1000,
      triggeredPins: [...completed, 12].map((order) => `p3-${order}`),
      triggeredSortOrders: [...completed, 12],
      lastPassedSortOrder: 11,
      nextSortOrder: 12,
      pendingPinSortOrder: 12,
      queuedPinSortOrders: [12],
      savedAt: Date.now(),
    })
    gps.once = fix(route, 13)

    render(<ExamDriveSession route={route} />)
    await settle()

    expect(nextOrder()).toBe(13)
    await driveTo(route, 13)
    expect(nextOrder()).toBe(14)
    expect(playedOrders(route)).toEqual([13])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).not.toBe(12)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.queuedPinSortOrders).not.toContain(12)
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

  it.each(cases)('%s does not restart at PIN 1 when saved progress is corrupt', async (slug) => {
    const route = routeBySlug(slug)
    localStorage.setItem(`cityroute-pin-progress:${route.slug}`, '{')
    gps.once = fix(route, 1)

    render(<ExamDriveSession route={route} />)
    await settle()

    expect(screen.getByTestId('resume-error')).toBeTruthy()
    expect(screen.getByRole('button', { name: '▶ გამოცდის დაწყება' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByTestId('next-pin')).toBeNull()
    expect(loadRoutePinProgress(route.slug)).toBeNull()

    await userEvent.setup().click(screen.getByRole('button', { name: 'თავიდან დაწყება' }))
    expect(localStorage.getItem(`cityroute-pin-progress:${route.slug}`)).toBeNull()
    await settle()
    await pressStart()

    expect(nextOrder()).toBe(1)
  })

  it('does not trust an empty active snapshot over corrupt route progress', async () => {
    const route = routeBySlug('route-1')
    localStorage.setItem(`cityroute-pin-progress:${route.slug}`, '{')
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: null,
      heading: 0,
      speedKmh: 42,
      elapsedMs: 30_000,
      triggeredPins: [],
      triggeredSortOrders: [],
      lastPassedSortOrder: null,
      nextSortOrder: 1,
      savedAt: Date.now(),
    })

    render(<ExamDriveSession route={route} />)
    await settle()

    expect(screen.getByTestId('resume-error')).toBeTruthy()
    expect(nextOrder()).toBe(0)
  })

  it('refresh preserves the exam metrics, elapsed time, PIN, and map position', async () => {
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
    expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBeGreaterThanOrEqual(90_000)
    expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBeLessThan(90_100)
    expect(screen.getByTestId('next-pin').getAttribute('data-user-pos')).toBe(savedPosition.join(','))
    expect(screen.getByTestId('next-pin').getAttribute('data-heading')).toBe('87')
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3, 4])
    const restored = loadActiveExam(route.id, route.slug, route.name_ka)
    expect(restored?.elapsedMs).toBeGreaterThanOrEqual(90_000)
    expect(restored?.elapsedMs).toBeLessThan(90_100)
    expect(restored).toMatchObject({
      speedKmh: 42,
      triggeredSortOrders: [1, 2, 3, 4],
      nextSortOrder: 5,
      exam: { minorTotal: 4, severeTotal: 1 },
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

  it('Continue resumes the current session at the next unpassed PIN and keeps its mode and progress', async () => {
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
      expect(nextOrder()).toBe(3)
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.startMode).toBe('automatic')
      expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
      view.unmount()
  })

  it('Continue keeps Auto progress and does not create a new exam', async () => {
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
    expect(nextOrder()).toBe(3)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    expect(loadRoutePinProgress(other.slug)).toEqual([1, 2, 3])
    view.unmount()
  })

  it('Auto pause keeps a resumable session through Continue and refresh', async () => {
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
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    } finally {
      vi.useRealTimers()
    }

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()
    expect(screen.queryByTestId('exam-summary')).toBeNull()
    expect(nextOrder()).toBe(3)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.startMode).toBe('automatic')
    cleanup()
    gps.once = fix(route, 3)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
  })

  it('Auto pause preserves PIN 16 and the session through refresh', async () => {
    const route = routeBySlug('route-2')
    saveRoutePinProgress(route.slug, Array.from({ length: 14 }, (_, index) => index + 1))
    gps.once = fix(route, 15)
    render(<ExamDriveSession route={route} />)
    await settle()

    expect(screen.getByTestId('preview').getAttribute('data-selected-order')).toBe('15')
    await pressStart()
    expect(nextOrder()).toBe(15)
    await driveTo(route, 15)
    expect(loadRoutePinProgress(route.slug)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    expect(screen.getByTestId('exam-summary')).toBeTruthy()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.elapsedMs).toBeGreaterThan(0)
    cleanup()

    gps.once = null
    render(<ExamDriveSession route={route} />)
    await settle()

    expect(nextOrder()).toBe(16)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1),
    )
    expect(loadRoutePinProgress(route.slug)).toEqual(Array.from({ length: 15 }, (_, index) => index + 1))
  })

  it('Manual pause preserves the next PIN and mode across summary and refresh', async () => {
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
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.startMode).toBe('manual')
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
    expect(allRoutePinCases).toHaveLength(126)
    expect(
      Object.fromEntries(
        cases.map(([slug]) => [slug, sorted(routeBySlug(slug)).length]),
      ),
    ).toEqual({ 'route-1': 35, 'route-2': 29, 'route-3': 30, 'route-4': 32 })
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

      const precedingOrders = sorted(route)
        .filter((pin) => pin.sort_order < order)
        .map((pin) => pin.sort_order)
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

    expect(checked).toBe(126)
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

  it('route 1 resumes by sort order; pin 1 is counted by GPS', async () => {
    const route = routeBySlug('route-1')
    const first = await startAtPin1(route)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(nextOrder()).toBe(1)
    await driveTo(route, 1)
    expect(playedOrders(route)).toEqual([1])
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
    expect(playedOrders(route)).toEqual([])
  })

  it('route 1: mid-route დასრულება → გაგრძელება resumes at PIN 3; agency GPS cannot rewind', async () => {
    const route = routeBySlug('route-1')
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(playedOrders(route)).toEqual([1, 2])
    expect(nextOrder()).toBe(3)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])

    // Pausing preserves both the active session and the PIN progress.
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()

    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
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

  it('Continue restores the paused exam snapshot; Finish saves results; only New exam clears progress', async () => {
    const route = routeBySlug('route-2')
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const exam = createExamSession(route.id, route.name_ka)
    exam.minorTotal = 3
    const firstError = Object.keys(exam.counts)[0]!
    exam.counts[firstError]!.minor = 3
    const handledPins = route.pins.filter((pin) => pin.sort_order <= 2)
    saveRoutePinProgress(route.slug, [1, 2])
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      startMode: 'automatic',
      exam,
      userPos: [handledPins[1]!.lat, handledPins[1]!.lng],
      heading: 120,
      speedKmh: 18,
      elapsedMs: 12_345,
      triggeredPins: handledPins.map((pin) => pin.id),
      triggeredSortOrders: [1, 2],
      lastPassedSortOrder: 2,
      nextSortOrder: 3,
      savedAt: now,
    }, { allowProgressRollback: true })
    gps.once = fix(route, 3)
    render(<ExamDriveSession route={route} />)
    await settle()

    expect(nextOrder()).toBe(3)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    expect(screen.getByTestId('exam-summary')).toBeTruthy()
    const paused = loadActiveExam(route.id, route.slug, route.name_ka)!
    expect(paused.elapsedMs).toBe(12_345)
    expect(paused.exam.minorTotal).toBe(3)
    expect(paused.triggeredSortOrders).toEqual([1, 2])
    expect(paused.nextSortOrder).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'გაგრძელება' }))
    })
    await settle()
    expect(screen.queryByTestId('exam-summary')).toBeNull()
    expect(nextOrder()).toBe(3)
    expect(Number(screen.getByTestId('elapsed-ms').textContent)).toBe(12_345)
    const resumed = loadActiveExam(route.id, route.slug, route.name_ka)!
    expect(resumed.exam.startedAt).toBe(exam.startedAt)
    expect(resumed.exam.minorTotal).toBe(3)
    expect(resumed.elapsedMs).toBe(12_345)
    expect(resumed.triggeredSortOrders).toEqual([1, 2])

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])
    expect(loadExamHistory(route.id)[0]).toMatchObject({
      elapsedMs: 12_345,
      minorTotal: 3,
      passedPinOrders: [1, 2],
    })
    expect(screen.getByRole('button', { name: 'ახალი გამოცდა' })).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'ახალი გამოცდა' }))
    })
    await settle()
    expect(loadRoutePinProgress(route.slug)).toBeNull()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
  })

  it('route 1: Finish during a pending instruction persists and resumes that exact PIN', async () => {
    const route = routeBySlug('route-1')
    const completedOrders = [1, 2]
    saveRoutePinProgress(route.slug, completedOrders)
    gps.once = fix(route, 3)
    const geometry = routeGeometry(route)
    const pendingChainage = pinChainageAfter(route, pinAt(route, 3), 0)
    const approachChainage = Math.max(0, pendingChainage - 40)
    const approach = routePositionAt(geometry, approachChainage)
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: [approach.lat, approach.lng],
      heading: approach.heading,
      speedKmh: 5,
      elapsedMs: 1000,
      triggeredPins: completedOrders.map((order) => pinAt(route, order).id),
      triggeredSortOrders: completedOrders,
      lastPassedSortOrder: 2,
      nextSortOrder: 3,
      savedAt: Date.now(),
    })
    render(<ExamDriveSession route={route} />)
    await settle()
    simulatedRouteChainage.set(route.slug, approachChainage)
    simulatedInitialFix.set(route.slug, gps.once)

    audioTestState.autoEnd = false
    await driveTo(route, 3)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual(completedOrders)

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(3)
    expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])

    audioTestState.autoEnd = true
    playDetailed.mockClear()
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
      })
      await settle()
      expect(nextOrder()).toBe(4)
        expect(loadRoutePinProgress(route.slug)).toEqual([1, 2, 3])
        expect(playedOrders(route)).toEqual([3])
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
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).not.toBeNull()
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
      expect(loadRoutePinProgress(route.slug)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1))

      now += 30_000
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'ახალი გამოცდა' }))
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
  }, 20_000)

  it.each(cases)('%s: finish and restart clears progress and starts at PIN 1', async (slug) => {
    let now = Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      const route = routeBySlug(slug)
      let view =
        slug === 'route-3'
          ? await startRoute3AtPin11(route)
          : await startAtPin1(route)
      const throughOrder = slug === 'route-3' ? 13 : 12
      await driveThroughPins(route, slug === 'route-3' ? 11 : 1, throughOrder)
      const completedOrders = sorted(route)
        .filter((pin) => pin.sort_order <= throughOrder)
        .map((pin) => pin.sort_order)
      expect(nextOrder()).toBe(slug === 'route-3' ? 14 : 13)
      expect(loadRoutePinProgress(route.slug)).toEqual(completedOrders)

      now += 65_000
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).not.toBeNull()
      expect(loadRoutePinProgress(route.slug)).toEqual(completedOrders)
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'ახალი გამოცდა' }))
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
      const completedOrders =
        slug === 'route-3'
          ? [...Array.from({ length: 11 }, (_, index) => index + 1), 13]
          : Array.from({ length: 12 }, (_, index) => index + 1)
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
      expect(nextOrder()).toBe(slug === 'route-3' ? 14 : 13)
      expect(loadRoutePinProgress(route.slug)).toEqual(completedOrders)

      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
        expect(loadActiveExam(route.id, route.slug, route.name_ka)).not.toBeNull()
      expect(loadRoutePinProgress(route.slug)).toEqual(completedOrders)
      await act(async () => {
          await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
        await settle()
        await act(async () => {
          await userEvent.setup().click(screen.getByRole('button', { name: 'ახალი გამოცდა' }))
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

  it('route 2: Continue resumes PIN 3 and retains the paused timer', async () => {
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
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.elapsedMs).toBe(0)
      expect(loadRoutePinProgress(route.slug)).toEqual([1, 2])

      now += 120_000
      playDetailed.mockClear()
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'გაგრძელება' }))
      })
      await settle()
      expect(screen.queryByTestId('exam-summary')).toBeNull()
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
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'ახალი გამოცდა' }))
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
    const savedPosition = loadActiveExam(route.id, route.slug, route.name_ka)?.userPos
    gps.once = savedPosition
      ? {
          lat: savedPosition[0],
          lng: savedPosition[1],
          accuracy: 5,
          heading: 0,
          speed: 5,
          timestamp: Date.now(),
        }
      : fix(route, 2)
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(nextOrder()).toBe(3)
    expect(screen.queryByRole('button', { name: /გამოცდის დაწყება/ })).toBeNull()

    const resumeChainage = simulatedRouteChainage.get(route.slug) ??
      projectPointToRoute(routeGeometry(route), [
        gps.once!.lat,
        gps.once!.lng,
      ])?.chainageMeters ?? 0
    const priorPinChainage = pinChainageBefore(route, pinAt(route, 1), resumeChainage)
    expect(priorPinChainage).not.toBeNull()
    await travelToChainage(route, routeGeometry(route), priorPinChainage!)
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
    const finishStart = ROUTE_FINISH_PIN_RANGES[slug].start
    const first = await startAtFinishSection(route)
    for (const pin of sorted(route).filter((item) => item.sort_order >= finishStart)) {
      await driveTo(route, pin.sort_order)
    }
    if (slug !== 'route-3') {
      await travelToChainage(route, routeGeometry(route), routeGeometry(route).totalLengthMeters - 5)
      expect(screen.getByTestId('exam-summary')).toBeTruthy()
    } else {
      expect(screen.getByTestId('route-complete').textContent).toContain('მარშრუტი დასრულებულია')
    }
    if (slug === 'route-3') {
      expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual(
        sorted(route).map((pin) => pin.sort_order),
      )
    } else {
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).not.toBeNull()
      expect(loadRoutePinProgress(route.slug)).toEqual(sorted(route).map((pin) => pin.sort_order))
      await act(async () => {
        await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
      })
      await settle()
      expect(loadActiveExam(route.id, route.slug, route.name_ka)).toBeNull()
    }
    first.unmount()

    playDetailed.mockClear()
    render(<ExamDriveSession route={route} />)
    await settle()
    expect(screen.getByTestId('route-complete').textContent).toContain('მარშრუტი დასრულებულია')
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
  }, 20_000)

  it('restores independent Route 2 and Route 3 audio queues after route switches', async () => {
    const route2 = routeBySlug('route-2')
    const route3 = routeBySlug('route-3')
    const view = await startAtPin1(route2)
    audioTestState.autoEnd = false
    await driveTo(route2, 1)
    await driveTo(route2, 2)

    const route2State = loadActiveExam(route2.id, route2.slug, route2.name_ka)
    expect(route2State?.pendingPinSortOrder).toBe(1)
    expect(route2State?.queuedPinSortOrders).toEqual([2])

    const route3Pins = sorted(route3)
    const route3Handled = route3Pins.filter((pin) => pin.sort_order < 2)
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
      triggeredSortOrders: [1],
      lastPassedSortOrder: 1,
      nextSortOrder: 2,
      pendingPinSortOrder: 2,
      queuedPinSortOrders: [3],
      savedAt: Date.now(),
    })

    view.rerender(<ExamDriveSession route={route3} />)
    await settle()
    expect(playDetailed.mock.calls.at(-1)?.[1]).toBe(pinAt(route3, 2).id)
    expect(loadActiveExam(route3.id, route3.slug, route3.name_ka)?.queuedPinSortOrders).toEqual([3])

    cleanup()
    render(<ExamDriveSession route={route2} />)
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
    await startAtPin1(route)
    await driveTo(route, 1)
    await driveTo(route, 2)
    expect(nextOrder()).toBe(3)

    playDetailed.mockClear()
    await sendRouteFix(route, routeGeometry(route), routeGeometry(route).cumulativeMeters[2], 5)
    expect(playDetailed).not.toHaveBeenCalled()
    expect(nextOrder()).toBe(3)

    await driveTo(route, 3)
    expect(playedOrders(route)).toEqual([3])
    expect(nextOrder()).toBe(4)
  })

  it('route 1 mid-route progress survives a finish and a route 2 hop in the same mounted session', async () => {
    const route1 = routeBySlug('route-1')
    const route2 = routeBySlug('route-2')
    await startAtPin1(route1)
    await driveTo(route1, 1)
    await driveTo(route1, 2)

    await act(async () => {
      await userEvent.setup().click(screen.getByRole('button', { name: 'დასრულება' }))
    })
    await settle()
    expect(loadActiveExam(route1.id, route1.slug, route1.name_ka)?.triggeredSortOrders).toEqual([1, 2])
    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2])

    cleanup()
    render(<ExamDriveSession route={route2} />)
    await settle()
    expect(screen.getByRole('button', { name: /გამოცდის დაწყება/ })).toBeTruthy()
    await pressStart()
    await driveTo(route2, 1)
    await driveTo(route2, 2)
    await driveTo(route2, 3)

    cleanup()
    render(<ExamDriveSession route={route1} />)
    await settle()
    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2])
    expect(nextOrder()).toBe(3)
    expect(loadRoutePinProgress(route1.slug)).toEqual([1, 2])
    expect(loadRoutePinProgress(route2.slug)).toEqual([1, 2, 3])

    cleanup()
    render(<ExamDriveSession route={route2} />)
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
    const geometry = routeGeometry(route)
    const chainage = pinChainageAfter(
      route,
      pinAt(route, 5),
      simulatedRouteChainage.get(route.slug) ?? 0,
    )
    await sendRouteFix(route, geometry, chainage)
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
    const currentChainage = simulatedRouteChainage.get(route.slug)!
    const priorPinChainage = pinChainageBefore(route, pinAt(route, 1), currentChainage)
    expect(priorPinChainage).not.toBeNull()
    await travelToChainage(route, routeGeometry(route), priorPinChainage!)
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
