/**
 * PIN AUDIO integration: ExamDriveSession wiring (GPS callback → decidePinAudio → audioEngine).
 * PIN detection / coordinates are untouched; this only checks WHEN the voice is requested.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { ExamDriveSession } from './ExamDriveSession'
import { saveActiveExam } from '@/lib/exam-persistence'
import { createExamSession } from '@/lib/exam-session'
import { audioEngine } from '@/lib/audio'
import { headingMatches } from '@/lib/gps'
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
  playStatus: 'played' as 'played' | 'failed',
  busy: false,
}))

vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(),
    playDetailed: vi.fn(() => Promise.resolve(h.playStatus)),
    unlock: vi.fn(),
    isBusy: vi.fn(() => h.busy),
    stopAll: vi.fn(),
    preloadAll: vi.fn(),
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
  EXAM_START_AUDIO: '/audio/exam-start.mp3',
  EXAM_START_TEXT: 'გამოცდა დაწყებულია',
  EXAM_SUCCESS_AUDIO: '/audio/exam-success.mp3',
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

function fix(northM: number, over: Record<string, number | null> = {}) {
  return { latitude: BASE_LAT + northM * LAT_PER_M, longitude: 45.4, accuracy: 5, heading: 0, speed: 10, timestamp: Date.now(), ...over }
}

async function emit(northM: number, over: Record<string, number | null> = {}) {
  await act(async () => {
    h.gpsCb!(fix(northM, over))
    await Promise.resolve()
  })
}

describe('ExamDriveSession – PIN audio wiring', () => {
  beforeEach(async () => {
    localStorage.clear()
    vi.clearAllMocks()
    vi.mocked(headingMatches).mockImplementation(() => true)
    h.gpsCb = null
    h.playStatus = 'played'
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
  afterEach(() => localStorage.clear())

  const played = () => vi.mocked(audioEngine.playDetailed as (...a: unknown[]) => unknown).mock.calls.map((c) => c[1])

  it('does not speak far from the PIN, speaks once at <= 20 m, never twice', async () => {
    await emit(100)
    expect(played()).toEqual([])
    await emit(182) // 18 m before PIN 1  (old 5 m trigger would have stayed silent)
    expect(played()).toEqual(['pin-1'])
    await emit(185)
    await emit(190)
    expect(played()).toEqual(['pin-1'])
  })

  it('passes the 90° audio heading tolerance to headingMatches (map/nav default stays 55°)', async () => {
    await emit(182)
    const calls = vi.mocked(headingMatches).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((c) => c[3] === 90)).toBe(true)
  })

  it('wrong heading while moving does not lose the voice: it is played right after passing the PIN', async () => {
    vi.mocked(headingMatches).mockReturnValue(false)
    await emit(185)
    await emit(195)
    expect(played()).toEqual([])
    await emit(215) // passed
    expect(played()).toEqual(['pin-1'])
  })

  it('route 2 does not skip a pin when GPS jumps ahead (Tbilisi sequential rule)', async () => {
    await emit(150) // approached PIN 1 (50 m)
    await emit(392) // 8 m from PIN 2 while PIN 1 is still next
    expect(played()).toEqual([])
    await emit(182) // at PIN 1
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
    h.busy = true
    await emit(190)
    expect(played()).toEqual([])
    h.busy = false
    await emit(192)
    expect(played()).toEqual(['pin-1'])
  })

  it('failed playback is retried (max 3 attempts), then given up', async () => {
    h.playStatus = 'failed'
    for (let i = 0; i < 6; i++) {
      await emit(190 + i)
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
    }
    expect(played()).toEqual(['pin-1', 'pin-1', 'pin-1'])
  })
})
