import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExamDriveSession } from './ExamDriveSession'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import type { GpsPosition } from '@/lib/gps'
import type { RouteWithPins } from '@/types/database'

const remoteSessionMocks = vi.hoisted(() => ({
  listRequests: [] as Array<(sessions: never[]) => void>,
  listRemoteExamSessions: vi.fn(
    () => new Promise<never[]>((resolve) => remoteSessionMocks.listRequests.push(resolve)),
  ),
}))

vi.mock('@/lib/exam-session-edge', () => ({
  REMOTE_EXAM_SESSION_BACKEND_ENABLED: true,
  abandonRemoteExamSession: vi.fn(),
  createRemoteExamSession: vi.fn(),
  getRemoteExamSession: vi.fn(),
  listRemoteExamSessions: remoteSessionMocks.listRemoteExamSessions,
  newExamSessionMigrationKey: vi.fn(() => 'migration-key'),
  releaseExamTabLease: vi.fn(),
  RemoteExamSessionWriter: class {},
  toJson: (value: unknown) => value,
}))

vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true }))
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
    preload: vi.fn(),
    preloadAll: vi.fn(),
  },
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
    requestGpsOnce: vi.fn(() => Promise.resolve({
      lat: 41.9,
      lng: 45.4,
      accuracy: 5,
      heading: 0,
      speed: 0,
      timestamp: Date.now(),
    } satisfies GpsPosition)),
    watchGps: vi.fn(() => () => {}),
  }
})
vi.mock('@/lib/gps-filter', () => ({
  createGpsFilter: () => ({ filter: (reading: unknown) => reading, reset: () => {} }),
}))
vi.mock('@/lib/route-nav', () => ({
  createSpeedTracker: () => ({}),
  gpsToLatLng: (position: GpsPosition) => [position.lat, position.lng],
  resolveHeading: () => 0,
  stabilizeRoadArrowHeading: (_prev: number, target: number) => target,
  resolveExamSpeedKmh: () => 5,
  formatDuration: (milliseconds: number) => `${Math.floor(milliseconds / 1000)}s`,
  routeLengthMeters: () => 5000,
  seedAlongRouteMeters: () => 0,
}))
vi.mock('@/components/ExamLiveMap', () => ({ ExamLiveMap: () => null }))
vi.mock('@/components/ExamErrorGrid', () => ({ ExamErrorGrid: () => null }))
vi.mock('@/components/ExamScoreboard', () => ({ ExamScoreboard: () => null }))
vi.mock('@/components/ExamSummary', () => ({ ExamSummary: () => null }))
vi.mock('@/components/ExamViewSwitcher', () => ({ ExamViewSwitcher: () => null }))
vi.mock('@/components/GpsAccuracyBadge', () => ({ GpsAccuracyBadge: () => null }))
vi.mock('@/components/RoutePreviewMap', () => ({ RoutePreviewMap: () => null }))

const route = TELAVI_ROUTES_FALLBACK.find((candidate) => candidate.slug === 'route-1')!
const identity = { userId: 'user-1', deviceId: 'device-1', tabId: 'tab-1' }

function routeWithRemoteId(source: RouteWithPins): RouteWithPins {
  return {
    ...source,
    id: '11111111-1111-4111-8111-111111111111',
    pins: source.pins.map((pin) => ({ ...pin, id: `remote-${pin.sort_order}` })),
  }
}

async function resolveListRequest(index: number) {
  await act(async () => {
    remoteSessionMocks.listRequests[index]([])
  })
}

describe('ExamDriveSession remote session loading', () => {
  beforeEach(() => {
    remoteSessionMocks.listRequests.length = 0
    remoteSessionMocks.listRemoteExamSessions.mockClear()
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('restarts loading when the route changes from its local ID to its Supabase ID', async () => {
    const { rerender } = render(
      <ExamDriveSession route={route} {...identity} debugPanels={false} />,
    )
    await waitFor(() => expect(remoteSessionMocks.listRequests).toHaveLength(1))

    rerender(
      <ExamDriveSession route={routeWithRemoteId(route)} {...identity} debugPanels={false} />,
    )
    await waitFor(() => expect(remoteSessionMocks.listRequests).toHaveLength(2))

    await resolveListRequest(0)
    await resolveListRequest(1)

    await waitFor(() => {
      expect(screen.queryByText('სერვერული გამოცდის სესია იტვირთება...')).toBeNull()
      expect(screen.getByRole('button', { name: /გამოცდის დაწყება/ }).hasAttribute('disabled')).toBe(false)
    })
  })

  it('shows a timeout error and lets the user retry the remote session load', async () => {
    vi.useFakeTimers()
    render(<ExamDriveSession route={route} {...identity} debugPanels={false} />)
    await act(async () => {
      await Promise.resolve()
    })
    expect(remoteSessionMocks.listRequests).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(25_000)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('25 წამზე მეტი')
    expect(screen.queryByText('სერვერული გამოცდის სესია იტვირთება...')).toBeNull()

    await act(async () => {
      screen.getByRole('button', { name: 'ხელახლა ცდა' }).click()
    })
    expect(remoteSessionMocks.listRequests).toHaveLength(2)
    await resolveListRequest(1)

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /გამოცდის დაწყება/ }).hasAttribute('disabled')).toBe(false)
  })
})
