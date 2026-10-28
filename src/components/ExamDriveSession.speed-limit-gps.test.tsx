import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExamDriveSession } from './ExamDriveSession'
import { SPEED_ZONES } from '@/data/speed-limits'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRoadTrace } from '@/lib/pin-route-line'
import { roadPointAt } from '@/lib/speed-limit'
import type { GpsPosition } from '@/lib/gps'
import type { PinRow } from '@/types/database'

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
    watchGps: vi.fn((
      onFix: (pos: GpsPosition) => void,
      onError?: (err: GeolocationPositionError) => void,
    ) => {
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
  ExamLiveMap: ({ nextPin }: { nextPin: PinRow | null }) => (
    <div data-testid="next-pin">{nextPin?.sort_order ?? ''}</div>
  ),
}))
vi.mock('@/components/ExamScoreboard', () => ({
  ExamScoreboard: ({ speedLimitKmh }: { speedLimitKmh?: number | null }) => (
    <div data-testid="speed-limit">{speedLimitKmh ?? 'unknown'}</div>
  ),
}))
vi.mock('@/components/ExamErrorGrid', () => ({ ExamErrorGrid: () => null }))
vi.mock('@/components/ExamSummary', () => ({ ExamSummary: () => null }))
vi.mock('@/components/ExamViewSwitcher', () => ({ ExamViewSwitcher: () => null }))
vi.mock('@/components/GpsAccuracyBadge', () => ({ GpsAccuracyBadge: () => null }))
vi.mock('@/components/RoutePreviewMap', () => ({ RoutePreviewMap: () => <div data-testid="preview" /> }))

const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
const speedZone = SPEED_ZONES['route-1']![0]!
const road = examRoadTrace(route.slug, route.pins)!
const zonePoint = roadPointAt(road, (speedZone.from + speedZone.to) / 2)

async function settle(ms = 20) {
  if (vi.isFakeTimers()) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  } else {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms))
    })
  }
}

async function startSession() {
  gps.once = {
    lat: road[0][0],
    lng: road[0][1],
    accuracy: 5,
    heading: 0,
    speed: 0,
    timestamp: Date.now(),
  }
  render(<ExamDriveSession route={route} />)
  await settle()
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /გამოცდის დაწყება/ }))
  })
  await settle()
}

async function sendZoneFix() {
  expect(gps.onFix).not.toBeNull()
  await act(async () => {
    gps.onFix!({
      lat: zonePoint[0],
      lng: zonePoint[1],
      accuracy: 5,
      heading: 0,
      speed: 5,
      timestamp: Date.now(),
    })
  })
}

async function driveToZone() {
  const targetU = (speedZone.from + speedZone.to) / 2
  for (let u = 8; u < targetU; u += 8) {
    const point = roadPointAt(road, u)
    expect(gps.onFix).not.toBeNull()
    await act(async () => {
      gps.onFix!({
        lat: point[0],
        lng: point[1],
        accuracy: 5,
        heading: 0,
        speed: 5,
        timestamp: Date.now(),
      })
    })
  }
  await sendZoneFix()
}

describe('Speed Limit GPS freshness', () => {
  beforeEach(() => {
    localStorage.clear()
    gps.onFix = null
    gps.onError = null
    gps.once = null
    vi.useRealTimers()
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.useRealTimers()
  })

  it('hides the last posted limit on GPS error and restores it on the next fix', async () => {
    await startSession()
    await driveToZone()
    expect(screen.getByTestId('speed-limit').textContent).toBe(String(speedZone.limitKmh))

    await act(async () => {
      gps.onError?.({
        code: 2,
        message: 'GPS unavailable',
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError)
    })
    expect(screen.getByTestId('speed-limit').textContent).toBe('unknown')

    await sendZoneFix()
    expect(screen.getByTestId('speed-limit').textContent).toBe(String(speedZone.limitKmh))
  })

  it('hides the posted limit when no fresh GPS fix arrives before the stale timeout', async () => {
    vi.useFakeTimers()
    await startSession()
    await driveToZone()
    expect(screen.getByTestId('speed-limit').textContent).toBe(String(speedZone.limitKmh))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(screen.getByTestId('speed-limit').textContent).toBe('unknown')

    await sendZoneFix()
    expect(screen.getByTestId('speed-limit').textContent).toBe(String(speedZone.limitKmh))
  })
})
