/**
 * PIN AUDIO integration: ExamDriveSession wiring (GPS callback → decidePinAudio → audioEngine).
 * PIN detection / coordinates are untouched; this only checks WHEN the voice is requested.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup, fireEvent, screen } from '@testing-library/react'
import { ExamDriveSession } from './ExamDriveSession'
import { loadActiveExam, saveActiveExam } from '@/lib/exam-persistence'
import { createExamSession } from '@/lib/exam-session'
import { saveRoutePinProgress } from '@/lib/route-pin-progress'
import { audioEngine } from '@/lib/audio'
import { distanceToPinMeters, headingMatches, requestGpsOnce } from '@/lib/gps'
import {
  pinAudioApproachWindowMeters,
  pinAudioTriggerDistanceMeters,
} from '@/lib/pin-audio'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import route1Road from '@/data/route-1-road.json'
import route2Road from '@/data/route-2-road.json'
import route3Road from '@/data/route-3-road.json'
import route4Road from '@/data/route-4-road.json'
import {
  prepareRouteGeometry,
  projectPointToRoute,
  projectPointToRouteNearChainage,
  projectOrderedPointsToRoute,
  type ActiveRouteId,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'
import type { RouteWithPins } from '@/types/database'
import type { LatLng } from '@/lib/gps'

// Mock dependencies
vi.mock('@/context/AuthContext', () => ({
  usePlanFeatures: () => ({
    mapNav: true,
    errorPanel: true,
    canSwitchViews: true,
    routeAudio: true,
  }),
}))

vi.mock('@/hooks/useExamLayoutMode', () => ({
  useExamLayoutMode: () => 'desktop' as const,
}))

const h = vi.hoisted(() => ({
  gpsCb: null as null | ((pos: Record<string, number | null>) => void),
  playStatus: 'played' as 'played' | 'failed' | 'busy' | 'cancelled' | 'duplicate',
  playOptions: [] as Array<{
    onEnded?: () => void
    onFailure?: (reason: 'media-error' | 'play-rejected' | 'playback-timeout') => void
  }>,
  autoEnd: true,
  busy: false,
}))

vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(),
    playDetailed: vi.fn((_url, _pinId, _instruction, options) => {
      h.playOptions.push(options ?? {})
      if (h.playStatus === 'played' && h.autoEnd) options?.onEnded?.()
      return Promise.resolve(h.playStatus)
    }),
    unlock: vi.fn(),
    isBusy: vi.fn(() => h.busy),
    stopAll: vi.fn(),
    preloadAll: vi.fn(),
    setVolume: vi.fn(),
  },
}))

vi.mock('@/lib/gps', () => ({
  hasGpsConsent: vi.fn(() => false),
  markGpsConsentGranted: vi.fn(),
  clearGpsConsent: vi.fn(),
  requestGpsOnce: vi.fn(),
  requestWakeLock: vi.fn(() => Promise.resolve(() => {})),
  shouldAutoStartGps: vi.fn(() => Promise.resolve(false)),
  watchGps: vi.fn((cb: (pos: Record<string, number | null>) => void) => { h.gpsCb = cb; return () => {} }),
  getGpsEnvironmentIssue: vi.fn(() => null),
  distanceToPinMeters: vi.fn((a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 111320, (a[1] - b[1]) * 111320 * Math.cos((a[0] * Math.PI) / 180))),
  headingMatches: vi.fn((_u: unknown, _p: unknown, _h: unknown, _tol?: number) => true),
  formatGpsError: vi.fn((err) => String(err)),
  gpsToLatLng: vi.fn((pos) => [pos.latitude, pos.longitude] as LatLng),
  resolveHeading: vi.fn(() => 0),
  resolveExamSpeedKmh: vi.fn(() => 0),
}))

vi.mock('@/data/route-audio', () => ({
  enrichPinsWithLocalAudio: vi.fn((slug, pins) => pins),
  collectPreloadAudioUrls: vi.fn(() => []),
  EXAM_START_AUDIO: '/audio/დაწყება.wav',
  EXAM_START_TEXT: 'გთხოვთ დაიწყოთ',
  EXAM_SUCCESS_AUDIO: '/audio/გილოცავთ.wav',
  EXAM_SUCCESS_TEXT: 'გილოცავთ',
  isStartPinAlreadyAnnounced: vi.fn(() => false),
}))

vi.mock('@/lib/route-nav', () => ({
  createSpeedTracker: vi.fn(() => ({})),
  gpsToLatLng: vi.fn((pos) => [pos.latitude, pos.longitude] as LatLng),
  resolveExamSpeedKmh: vi.fn(() => 0),
  resolveHeading: vi.fn(() => 0),
  formatDuration: vi.fn((ms) => `${Math.floor(ms / 1000)}s`),
}))

vi.mock('@/lib/gps-filter', () => ({
  createGpsFilter: vi.fn(() => ({
    filter: vi.fn((reading) => reading),
    reset: vi.fn(),
  })),
}))

// Mock component dependencies
vi.mock('@/components/ExamErrorGrid', () => ({
  ExamErrorGrid: () => <div data-testid="error-grid">Error Grid</div>,
}))

vi.mock('@/components/ExamLiveMap', () => ({
  ExamLiveMap: () => <div data-testid="live-map">Live Map</div>,
}))

vi.mock('@/components/ExamScoreboard', () => ({
  ExamScoreboard: () => <div data-testid="scoreboard">Scoreboard</div>,
}))

vi.mock('@/components/ExamSummary', () => ({
  ExamSummary: ({ onRestart }: { onRestart: () => void }) => (
    <div data-testid="exam-summary">
      <button onClick={onRestart}>დაიწყე თავიდან</button>
    </div>
  ),
}))

vi.mock('@/components/ExamViewSwitcher', () => ({
  ExamViewSwitcher: () => <div>View Switcher</div>,
}))

vi.mock('@/components/GpsAccuracyBadge', () => ({
  GpsAccuracyBadge: () => <div>GPS Badge</div>,
}))

vi.mock('@/components/RoutePreviewMap', () => ({
  RoutePreviewMap: () => <div data-testid="preview-map">Preview Map</div>,
}))


const LAT_PER_M = 1 / 111320
const BASE_LAT = 41.9
const pinAt = (i: number, northM: number) => ({
  id: 'pin-' + (i + 1),
  route_id: 'r2',
  lat: BASE_LAT + northM * LAT_PER_M,
  lng: 45.4,
  radius_m: 25,
  trigger_distance_m: 50,
  instruction_ka: 'ინსტრუქცია ' + (i + 1),
  audio_url: '/audio/pin-' + (i + 1) + '.mp3',
  sort_order: i + 1,
  active: true,
})

const route = {
  id: 'r2',
  slug: 'route-2',
  name_ka: 'მარშრუტი 2',
  polyline: [[41.9, 45.4], [41.91, 45.4]] as LatLng[],
  pins: [pinAt(0, 200), pinAt(1, 400), pinAt(2, 600)],
} as unknown as RouteWithPins

const finishRoads: Record<'route-1' | 'route-2' | 'route-3' | 'route-4', LatLng[]> = {
  'route-1': route1Road as LatLng[],
  'route-2': route2Road as LatLng[],
  'route-3': route3Road as LatLng[],
  'route-4': route4Road as LatLng[],
}

function roadPointAt(geometry: PreparedRouteGeometry, chainageMeters: number): LatLng {
  const bounded = Math.max(0, Math.min(geometry.totalLengthMeters, chainageMeters))
  const segment = Math.max(
    0,
    geometry.cumulativeMeters.findIndex(
      (value, index) =>
        index < geometry.cumulativeMeters.length - 1 &&
        value <= bounded &&
        bounded <= geometry.cumulativeMeters[index + 1],
    ),
  )
  const start = geometry.coordinates[segment]
  const end = geometry.coordinates[segment + 1]
  const fraction =
    (bounded - geometry.cumulativeMeters[segment]) /
    (geometry.cumulativeMeters[segment + 1] - geometry.cumulativeMeters[segment])
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ]
}

function fix(northM: number, over: Record<string, number | null> = {}) {
  return { latitude: BASE_LAT + northM * LAT_PER_M, longitude: 45.4, accuracy: 5, heading: 0, speed: 10, timestamp: gpsClock, ...over }
}

let gpsClock = Date.now()
let lastGpsNorthM: number | null = null

function advanceGpsClock(milliseconds: number) {
  gpsClock += milliseconds
  if (vi.isFakeTimers()) vi.setSystemTime(gpsClock)
}

async function emit(northM: number, over: Record<string, number | null> = {}) {
  const emitAt = async (positionNorthM: number) => {
    advanceGpsClock(Math.max(
      1_000,
      Math.ceil(Math.abs(positionNorthM - (lastGpsNorthM ?? positionNorthM)) / 20 * 1_000),
    ))
    await act(async () => {
      h.gpsCb!(fix(positionNorthM, over))
      await Promise.resolve()
    })
    lastGpsNorthM = positionNorthM
  }
  if (lastGpsNorthM === null) await emitAt(northM - 50)
  await emitAt(northM)
}

describe('ExamDriveSession – PIN audio wiring', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.clearAllMocks()
    gpsClock = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => gpsClock)
    lastGpsNorthM = null
    vi.mocked(headingMatches).mockImplementation(() => true)
    h.gpsCb = null
    h.playStatus = 'played'
    h.playOptions = []
    h.autoEnd = true
    h.busy = false
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: [BASE_LAT, 45.4],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: [],
      savedAt: Date.now(),
    })
    render(<ExamDriveSession route={route} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(h.gpsCb).toBeTypeOf('function')
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.mocked(requestGpsOnce).mockReset()
    vi.restoreAllMocks()
    localStorage.clear()
  })

  const played = () => vi.mocked(audioEngine.playDetailed as (...a: unknown[]) => unknown).mock.calls.map((c) => c[1])

  it('plays the start cue once on an allowed new-start PIN and not on GPS repeats', async () => {
    cleanup()
    localStorage.clear()
    const startPosition = fix(200)
    vi.mocked(requestGpsOnce).mockResolvedValue(startPosition as never)
    render(<ExamDriveSession route={route} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /გამოცდის დაწყება/ }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const startCalls = vi.mocked(audioEngine.playDetailed).mock.calls.filter(
      ([url]) => url === '/audio/დაწყება.wav',
    )
    expect(startCalls).toHaveLength(1)
    expect(startCalls[0]?.[2]).toBe('გთხოვთ დაიწყოთ')

    await emit(200)
    await emit(200)
    expect(vi.mocked(audioEngine.playDetailed).mock.calls.filter(
      ([url]) => url === '/audio/დაწყება.wav',
    )).toHaveLength(1)
  })

  it('does not play the start cue when a new session starts from an out-of-range PIN', async () => {
    cleanup()
    localStorage.clear()
    const sixPinRoute = {
      ...route,
      polyline: [[BASE_LAT, 45.4], [BASE_LAT + 0.02, 45.4]] as LatLng[],
      pins: Array.from({ length: 6 }, (_, index) => pinAt(index, (index + 1) * 200)),
    } as RouteWithPins
    vi.mocked(requestGpsOnce).mockResolvedValue(fix(1000) as never)
    render(<ExamDriveSession route={sixPinRoute} />)

    fireEvent.click(screen.getByRole('button', { name: 'PIN-ის არჩევა ხელით' }))
    fireEvent.change(screen.getByRole('combobox', { name: 'PIN-ების არჩევა' }), {
      target: { value: '5' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /გამოცდის დაწყება/ }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(vi.mocked(audioEngine.playDetailed).mock.calls.some(
      ([url]) => url === '/audio/დაწყება.wav',
    )).toBe(false)
  })

  it.each(['route-1', 'route-2', 'route-4'] as const)(
    '%s auto-finishes on forward GPS entry to its final road segment, once and without a return',
    async (slug) => {
      cleanup()
      localStorage.clear()
      const selectedRoute = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const routeId = slug as ActiveRouteId
      const geometry = prepareRouteGeometry(routeId, finishRoads[slug])
      const finalPin = selectedRoute.pins.reduce((last, pin) =>
        pin.sort_order > last.sort_order ? pin : last,
      )
      const handledOrders = selectedRoute.pins
        .filter((pin) => pin.sort_order < finalPin.sort_order)
        .map((pin) => pin.sort_order)
      const savedPosition = roadPointAt(geometry, geometry.totalLengthMeters - 160)

      saveRoutePinProgress(slug, handledOrders)
      h.autoEnd = false
      saveActiveExam({
        routeId: selectedRoute.id,
        routeSlug: slug,
        routeName: selectedRoute.name_ka,
        phase: 'active',
        exam: createExamSession(selectedRoute.id, selectedRoute.name_ka),
        userPos: savedPosition,
        heading: 205,
        speedKmh: 20,
        elapsedMs: 1000,
        triggeredPins: selectedRoute.pins
          .filter((pin) => handledOrders.includes(pin.sort_order))
          .map((pin) => pin.id),
        savedAt: Date.now(),
      })
      render(<ExamDriveSession route={selectedRoute} />)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      let lastChainage = 0
      const emitAt = async (position: LatLng, chainage: number) => {
        advanceGpsClock(Math.max(1_000, Math.ceil(Math.abs(chainage - lastChainage) / 20 * 1_000)))
        lastChainage = chainage
        await act(async () => {
          h.gpsCb!({
            latitude: position[0],
            longitude: position[1],
            accuracy: 3,
            heading: 288,
            speed: 10,
            timestamp: gpsClock,
          })
          await Promise.resolve()
        })
      }

      for (let chainage = 0; chainage < geometry.totalLengthMeters - 30; chainage += 50) {
        await emitAt(roadPointAt(geometry, chainage), chainage)
      }
      await emitAt(
        roadPointAt(geometry, geometry.totalLengthMeters - 10),
        geometry.totalLengthMeters - 10,
      )
      expect(played()).toContain(finalPin.id)
      expect(vi.mocked(audioEngine.playDetailed).mock.calls.filter(
        ([url]) => url === '/audio/გილოცავთ.wav',
      )).toHaveLength(0)
      expect(screen.queryByTestId('exam-summary')).toBeNull()

      await act(async () => {
        h.playOptions[0]?.onEnded?.()
      })
      h.autoEnd = true
      await emitAt(roadPointAt(geometry, geometry.totalLengthMeters - 4), geometry.totalLengthMeters - 4)
      await emitAt(roadPointAt(geometry, geometry.totalLengthMeters - 1), geometry.totalLengthMeters - 1)

      const successCalls = vi.mocked(audioEngine.playDetailed).mock.calls.filter(
        ([url]) => url === '/audio/გილოცავთ.wav',
      )
      expect(successCalls).toHaveLength(1)
      expect(screen.getByTestId('exam-summary')).toBeTruthy()
    },
  )

  it.each([
    { slug: 'route-1', order: 32 },
    { slug: 'route-2', order: 26 },
    { slug: 'route-3', order: 29 },
    { slug: 'route-4', order: 29 },
  ] as const)(
    '$slug PIN $order plays once within its configured distance on its forward road trace',
    async ({ slug, order }) => {
      cleanup()
      localStorage.clear()
      const selectedRoute = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      if (slug === 'route-3') {
        expect(selectedRoute.pins.some((pin) => pin.sort_order === 12)).toBe(false)
        expect(selectedRoute.pins.some((pin) => pin.sort_order === 13)).toBe(true)
      }
      const geometry = prepareRouteGeometry(slug as ActiveRouteId, finishRoads[slug])
      const target = selectedRoute.pins.find((pin) => pin.sort_order === order)!
      const targetPosition: LatLng = [target.lat, target.lng]
      const expectedTargetCoordinate = slug === 'route-1'
        ? [41.9337286, 45.4779111]
        : slug === 'route-2'
          ? [41.9337191, 45.4779047]
          : slug === 'route-3'
            ? [41.931694, 45.476574]
            : [41.9337192, 45.4779046]
      expect([target.lat, target.lng]).toEqual(expectedTargetCoordinate)
      const targetProjection = projectPointToRoute(geometry, targetPosition)
      expect(targetProjection).not.toBeNull()
      const targetChainage = targetProjection!.chainageMeters
      const expectedTargetChainage = {
        'route-1': 8079.9,
        'route-2': 8832.8,
        'route-3': 9147.3,
        'route-4': 7906.7,
      }[slug]
      expect(targetChainage).toBeGreaterThan(expectedTargetChainage - 5)
      expect(targetChainage).toBeLessThan(expectedTargetChainage + 5)
      const expectedGpsRadius = slug === 'route-2' ? 20 : pinAudioTriggerDistanceMeters(slug, order)
      const triggerChainage = slug === 'route-2'
        ? targetChainage - 1
        : targetChainage - pinAudioApproachWindowMeters(slug, order) + 1
      expect(distanceToPinMeters(
        roadPointAt(geometry, triggerChainage),
        targetPosition,
      )).toBeLessThanOrEqual(expectedGpsRadius)
      const completedPins = selectedRoute.pins.filter((pin) => pin.sort_order < order)
      const completedOrders = completedPins.map((pin) => pin.sort_order)
      const previousPin = slug === 'route-2'
        ? selectedRoute.pins.find((pin) => pin.sort_order === 25)
        : null
      const initialChainage = previousPin
        ? projectOrderedPointsToRoute(
            geometry,
            selectedRoute.pins
              .filter((pin) => pin.sort_order <= previousPin.sort_order)
              .sort((first, second) => first.sort_order - second.sort_order)
              .map((pin) => [pin.lat, pin.lng] as const),
          )!.chainageMeters
        : targetChainage - 40
      saveRoutePinProgress(slug, completedOrders)
      saveActiveExam({
        routeId: selectedRoute.id,
        routeSlug: slug,
        routeName: selectedRoute.name_ka,
        phase: 'active',
        exam: createExamSession(selectedRoute.id, selectedRoute.name_ka),
        userPos: roadPointAt(geometry, initialChainage),
        heading: 288,
        speedKmh: 20,
        elapsedMs: 1000,
        triggeredPins: completedPins.map((pin) => pin.id),
        savedAt: Date.now(),
      })

      render(<ExamDriveSession route={selectedRoute} />)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })

      let previousChainage = initialChainage
      const emitAt = async (chainage: number) => {
        advanceGpsClock(Math.max(1_000, Math.ceil((chainage - previousChainage) / 20 * 1_000)))
        previousChainage = chainage
        const position = roadPointAt(geometry, chainage)
        await act(async () => {
          h.gpsCb!({
            latitude: position[0],
            longitude: position[1],
            accuracy: 3,
            heading: 288,
            speed: 10,
            timestamp: gpsClock,
          })
          await Promise.resolve()
        })
      }

      const triggerDistance = pinAudioApproachWindowMeters(slug, order)
      if (slug === 'route-2') {
        expect(initialChainage).toBeLessThan(targetChainage - triggerDistance)
        const wrongOccurrence = projectPointToRouteNearChainage(
          geometry,
          [target.lat, target.lng],
          targetChainage - 157,
          20,
        )
        expect(wrongOccurrence?.segmentIndex).toBe(239)
        expect(wrongOccurrence!.chainageMeters).toBeLessThan(targetChainage - triggerDistance)
        expect(distanceToPinMeters(
          [wrongOccurrence!.position[0], wrongOccurrence!.position[1]],
          [target.lat, target.lng],
        )).toBeGreaterThan(10)
        expect(distanceToPinMeters(
          [wrongOccurrence!.position[0], wrongOccurrence!.position[1]],
          [target.lat, target.lng],
        )).toBeLessThan(20)
        expect(targetChainage - wrongOccurrence!.chainageMeters).toBeCloseTo(157, 0)
        await emitAt(wrongOccurrence!.chainageMeters)
        expect(played()).toEqual([])
        await emitAt(targetChainage - 50)
        await emitAt(targetChainage - 6)
      } else {
        await emitAt(targetChainage - triggerDistance - 15)
        await emitAt(targetChainage - triggerDistance - 5)
      }
      expect(played()).toEqual([])
      if (slug === 'route-2') {
        vi.mocked(headingMatches).mockReturnValue(false)
        await emitAt(targetChainage - 4)
        expect(played()).toEqual([])
        vi.mocked(headingMatches).mockReturnValue(true)
        await emitAt(targetChainage - 1)
      } else {
        await emitAt(targetChainage - triggerDistance + 1)
      }
      expect(played()).toEqual([target.id])
      const expectedHeadingTolerance = 45
      expect(vi.mocked(headingMatches).mock.calls.every((call) => call[3] === expectedHeadingTolerance))
        .toBe(true)
      await emitAt(targetChainage - Math.max(triggerDistance - 2, 1))
      expect(played().filter((id) => id === target.id)).toHaveLength(1)
    },
  )

  it('preserves the start PIN special radius and plays it only once', async () => {
    await emit(100)
    expect(played()).toEqual([])
    await emit(182)
    expect(played()).toEqual(['pin-1'])
    await emit(185)
    await emit(190)
    expect(played()).toEqual(['pin-1'])
  })

  it('passes the 90° audio heading tolerance to headingMatches (map/nav default stays 55°)', async () => {
    await emit(192)
    const calls = vi.mocked(headingMatches).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c[3] === 90)).toBe(true)
  })

  it('shows elapsed time without labeling it as ETA and connects the volume slider to AudioEngine', () => {
    expect(screen.getByText('გავლილი დრო')).toBeTruthy()
    expect(screen.queryByText(/ETA|დარჩენილი დრო/)).toBeNull()

    fireEvent.change(screen.getByRole('slider', { name: 'ხმის დონე' }), {
      target: { value: '0.4' },
    })

    expect(audioEngine.setVolume).toHaveBeenCalledWith(0.4)
    expect(screen.getByText('40%')).toBeTruthy()
  })

  it('wrong heading while moving does not lose the voice: it is played right after passing the PIN', async () => {
    vi.mocked(headingMatches).mockReturnValue(false)
    await emit(185)
    await emit(195)
    expect(played()).toEqual([])
    await emit(205) // passed
    expect(played()).toEqual(['pin-1'])
  })

  it('route 2 does not skip a pin when GPS jumps ahead', async () => {
    await emit(150) // approached PIN 1 (50 m)
    const emitRapidFix = async (northM: number, elapsedMs: number) => {
      advanceGpsClock(elapsedMs)
      await act(async () => {
        h.gpsCb!(fix(northM))
        await Promise.resolve()
      })
      lastGpsNorthM = northM
    }
    await emitRapidFix(392, 1_000) // GPS jump is rejected by the movement guard
    expect(played()).toEqual([])
    await emitRapidFix(192, 5_000) // normal forward movement to PIN 1
    expect(played()).toEqual(['pin-1'])
  })

  it('route 1 also refuses lookahead so an earlier pin is not skipped', async () => {
    cleanup()
    const r1 = { ...route, id: 'r1', slug: 'route-1', name_ka: 'მარშრუტი 1' }
    saveActiveExam({
      routeId: r1.id,
      routeSlug: r1.slug,
      routeName: r1.name_ka,
      phase: 'active',
      exam: createExamSession(r1.id, r1.name_ka),
      userPos: [BASE_LAT, 45.4],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: [],
      savedAt: Date.now(),
    })
    render(<ExamDriveSession route={r1} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    await emit(150)
    await emit(392)
    expect(played()).toEqual([])
  })

  it('defers while another voice is playing, then catches up (nothing lost)', async () => {
    vi.useFakeTimers()
    h.busy = true
    await emit(192)
    expect(played()).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(1)
    h.busy = false
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(played()).toEqual(['pin-1'])
  })

  it('keeps pending progress unhandled until audio ends', async () => {
    h.autoEnd = false
    await emit(192)
    await emit(193)
    await emit(194)

    expect(played()).toEqual(['pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(1)

    await act(async () => {
      h.playOptions[0]?.onEnded?.()
    })
    await emit(392)

    expect(played()).toEqual(['pin-1', 'pin-2'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(2)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(2)
  })

  it('continues selecting sequential PINs when an audio completion callback never arrives', async () => {
    h.autoEnd = false
    await emit(192)
    await emit(392)
    await emit(592)
    await emit(593)

    expect(played()).toEqual(['pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.queuedPinSortOrders).toEqual([2, 3])

    await act(async () => {
      h.playOptions[0]?.onEnded?.()
    })
    expect(played()).toEqual(['pin-1', 'pin-2'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(2)
  })

  it('keeps the PIN pending after the watchdog and ignores late callbacks', async () => {
    vi.useFakeTimers()
    h.autoEnd = false
    await emit(192)
    await emit(392)

    expect(played()).toEqual(['pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.queuedPinSortOrders).toEqual([2])
    const lateEnded = h.playOptions[0]?.onEnded
    const lateFailure = h.playOptions[0]?.onFailure

    await act(async () => {
      await vi.advanceTimersByTimeAsync(13_000)
    })

    expect(played()).toEqual(['pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.queuedPinSortOrders).toEqual([2])

    await act(async () => {
      lateFailure?.('playback-timeout')
      lateEnded?.()
    })
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(played()).toEqual(['pin-1'])

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'აუდიოს ხელახლა ცდა' }))
      await Promise.resolve()
    })
    expect(played()).toEqual(['pin-1', 'pin-1'])
    await act(async () => {
      h.playOptions[1]?.onEnded?.()
    })
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(2)
  })

  it('restores the pending and queued voices after a remount', async () => {
    h.autoEnd = false
    await emit(192)
    await emit(392)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.queuedPinSortOrders).toEqual([2])

    cleanup()
    h.playOptions = []
    vi.mocked(audioEngine.playDetailed).mockClear()
    render(<ExamDriveSession route={route} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    expect(played()).toEqual(['pin-1'])
    await act(async () => {
      h.playOptions[0]?.onEnded?.()
    })
    expect(played()).toEqual(['pin-1', 'pin-2'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(2)
  })

  it('keeps a PIN pending when playback is rejected until the user retries and it ends', async () => {
    h.playStatus = 'failed'
    h.autoEnd = false
    await emit(192)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(played()).toEqual(['pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(1)

    h.playStatus = 'played'
    h.autoEnd = true
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'აუდიოს ხელახლა ცდა' }))
      await Promise.resolve()
    })
    expect(played()).toEqual(['pin-1', 'pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBeNull()
  })

  it('does not complete a failed PIN from a late callback, then completes it on retry ended', async () => {
    h.autoEnd = false
    await emit(192)
    expect(played()).toEqual(['pin-1'])

    const onFailure = h.playOptions[0]?.onFailure
    expect(onFailure).toBeTypeOf('function')
    await act(async () => {
      onFailure?.('media-error')
      h.playOptions[0]?.onEnded?.()
      onFailure?.('playback-timeout')
    })

    const saved = loadActiveExam(route.id, route.slug, route.name_ka)
    expect(saved?.triggeredSortOrders).toEqual([])
    expect(saved?.nextSortOrder).toBe(1)
    expect(saved?.pendingPinSortOrder).toBe(1)

    h.autoEnd = true
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'აუდიოს ხელახლა ცდა' }))
      await Promise.resolve()
    })
    expect(played()).toEqual(['pin-1', 'pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBeNull()
  })

  it('keeps a PIN with no audio URL pending instead of starting the following PIN', async () => {
    cleanup()
    localStorage.clear()
    h.playStatus = 'failed'
    h.autoEnd = false
    const missingAudioRoute = {
      ...route,
      pins: route.pins.map((pin, index) => index === 0 ? { ...pin, audio_url: null } : pin),
    }
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: [BASE_LAT, 45.4],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: [],
      savedAt: Date.now(),
    })
    render(<ExamDriveSession route={missingAudioRoute} />)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })

    await emit(192)

    expect(vi.mocked(audioEngine.playDetailed).mock.calls[0]?.[0]).toBeNull()
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)
  })

  it('keeps the pending PIN after a playback timeout', async () => {
    h.autoEnd = false
    await emit(192)
    expect(played()).toEqual(['pin-1'])

    await act(async () => {
      h.playOptions[0]?.onFailure?.('playback-timeout')
    })
    expect(played()).toEqual(['pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)
  })

  it('ignores a delayed failure callback after the session unmounts', async () => {
    await emit(192)
    const onFailure = h.playOptions[0]?.onFailure
    expect(onFailure).toBeTypeOf('function')

    cleanup()
    await act(async () => {
      onFailure?.('media-error')
    })

    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
  })

  it('waits for a busy engine and retries the pending pin automatically', async () => {
    vi.useFakeTimers()
    h.playStatus = 'busy'
    await emit(192)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.nextSortOrder).toBe(1)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)

    h.playStatus = 'played'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(played()).toEqual(['pin-1', 'pin-1'])
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
  })
})

describe('ExamDriveSession – pin list refresh must not cut voice', () => {
  beforeEach(() => {
    gpsClock = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => gpsClock)
    lastGpsNorthM = null
    h.playOptions = []
    h.autoEnd = false
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    h.playOptions = []
    vi.mocked(requestGpsOnce).mockReset()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not call stopAll when only the pins array identity changes', async () => {
    localStorage.clear()
    vi.clearAllMocks()
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam: createExamSession(route.id, route.name_ka),
      userPos: [BASE_LAT, 45.4],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: [],
      savedAt: Date.now(),
    })
    const { rerender } = render(<ExamDriveSession route={route} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    vi.mocked(audioEngine.stopAll).mockClear()
    h.autoEnd = false
    await emit(192)
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.pendingPinSortOrder).toBe(1)
    const refreshed = {
      ...route,
      pins: route.pins.map((pin) => ({ ...pin })),
    } as RouteWithPins
    rerender(<ExamDriveSession route={refreshed} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(audioEngine.stopAll).not.toHaveBeenCalled()
    await act(async () => {
      h.playOptions[0]?.onEnded?.()
    })
    expect(loadActiveExam(route.id, route.slug, route.name_ka)?.triggeredSortOrders).toEqual([1])
  })
})
