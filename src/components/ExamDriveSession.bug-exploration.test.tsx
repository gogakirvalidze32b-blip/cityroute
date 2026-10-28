/**
 * Bug Condition Exploration Test - Finish Button Clears Session Permanently
 * 
 * **CRITICAL**: This test encodes the EXPECTED BEHAVIOR
 * This test will FAIL on UNFIXED code (proving the bug exists)
 * This test will PASS on FIXED code (proving the fix works)
 * 
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.5**
 * 
 * Property 1: Bug Condition - Finish Button Permanently Clears Session
 * 
 * For any user action where the "დასრულება" (Finish) button is clicked during 
 * an active exam session, the fixed finishSession() function SHALL permanently 
 * clear the active exam session from localStorage AND set phase to 'summary' 
 * AND prevent any subsequent useEffect restoration logic from overriding the 
 * 'summary' phase by re-detecting or restoring the cleared session.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { ExamDriveSession } from './ExamDriveSession'
import { saveActiveExam, clearActiveExam } from '@/lib/exam-persistence'
import { createExamSession } from '@/lib/exam-session'
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

vi.mock('@/lib/audio', () => ({
  audioEngine: {
    play: vi.fn(),
    playDetailed: vi.fn(() => Promise.resolve('played')),
    unlock: vi.fn(),
    isBusy: vi.fn(() => false),
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
  watchGps: vi.fn(() => () => {}),
  getGpsEnvironmentIssue: vi.fn(() => null),
  distanceToPinMeters: vi.fn(() => 999),
  headingMatches: vi.fn(() => true),
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
  ExamSummary: ({
    onRestart,
    onContinue,
  }: {
    onRestart: () => void
    onContinue?: () => void
  }) => (
    <div data-testid="exam-summary">
      {onContinue && <button onClick={onContinue}>გაგრძელება</button>}
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

describe('Bug Condition Exploration - Finish Button Clears Session', () => {
  const mockRoute = {
    id: 'test-route-id',
    slug: 'route-1',
    name_ka: 'მარშრუტი 1',
    name_en: 'Route 1',
    name_ru: 'Маршрут 1',
    description_ka: null,
    description_en: null,
    description_ru: null,
    polyline: [
      [41.9, 45.4],
      [41.91, 45.41],
      [41.92, 45.42],
    ] as LatLng[],
    pins: [],
    start_location: null,
    finish_location: null,
    distance_km: 5,
    duration_minutes: 15,
    difficulty: 'medium',
    created_at: new Date().toISOString(),
  } as unknown as RouteWithPins

  const mockUserPos: LatLng = [41.9, 45.4]

  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('[BUG EXPLORATION] should permanently clear session when finish button is clicked', async () => {
    // SETUP: Create and save an active exam session
    const exam = createExamSession(mockRoute.id, mockRoute.name_ka)
    saveActiveExam({
      routeId: mockRoute.id,
      routeSlug: mockRoute.slug,
      routeName: mockRoute.name_ka,
      phase: 'active',
      exam,
      userPos: mockUserPos,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 5000,
      triggeredPins: [],
      savedAt: Date.now(),
    })

    // Verify session is saved
    const storedData = localStorage.getItem('cityroute-active-exam')
    expect(storedData).not.toBeNull()
    console.log('✅ Initial session saved to localStorage')

    // RENDER: Component should detect saved session and resume to 'active' phase
    const { rerender } = render(<ExamDriveSession route={mockRoute} />)

    // Wait for component to stabilize
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    // Verify we're in active phase (finish button should be visible)
    const finishButton = screen.getByText('დასრულება')
    expect(finishButton).toBeInTheDocument()
    console.log('✅ Finish button found - component in active phase')

    // ACT: Click the finish button
    const user = userEvent.setup()
    await act(async () => {
      await user.click(finishButton)
    })

    console.log('🔴 Finish button clicked - testing for bug condition...')

    // IMMEDIATE CHECK: localStorage should be cleared
    const clearedData = localStorage.getItem('cityroute-active-exam')
    expect(clearedData).toBeNull()
    console.log('✅ localStorage cleared immediately after finish')

    // CRITICAL TEST: Wait for any async effects to run
    // The bug occurs when useEffect runs after clearActiveExam() and re-detects session
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })

    // Force a re-render to trigger useEffect (simulating route change or component update)
    rerender(<ExamDriveSession route={mockRoute} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    // VERIFICATION: Phase should be 'summary' and stay 'summary'
    // This will FAIL on unfixed code because useEffect will force phase back to 'active'
    try {
      const summaryElement = screen.getByTestId('exam-summary')
      expect(summaryElement).toBeInTheDocument()
      console.log('✅ Summary phase maintained - bug does NOT exist (UNEXPECTED on unfixed code)')
    } catch (error) {
      // If summary is not found, we're likely back in active phase (the bug)
      const finishButtonAgain = screen.queryByText('დასრულება')
      if (finishButtonAgain) {
        console.log('🐛 BUG DETECTED: Finish button reappeared - phase reverted to active!')
        console.log('🐛 COUNTEREXAMPLE: Finish button clears localStorage, but useEffect restoration logic runs and forces phase back to active')
        
        // This assertion will fail, documenting the bug
        expect(finishButtonAgain).not.toBeInTheDocument()
      } else {
        // Re-throw if it's a different error
        throw error
      }
    }

    // ADDITIONAL CHECK: Verify localStorage stays cleared
    const finalData = localStorage.getItem('cityroute-active-exam')
    expect(finalData).toBeNull()
    console.log('✅ localStorage remains cleared after all effects')
  })

  it('[BUG EXPLORATION] should not restore session after intentional finish', async () => {
    // SETUP: Create active session
    const exam = createExamSession(mockRoute.id, mockRoute.name_ka)
    saveActiveExam({
      routeId: mockRoute.id,
      routeSlug: mockRoute.slug,
      routeName: mockRoute.name_ka,
      phase: 'active',
      exam,
      userPos: mockUserPos,
      heading: 90,
      speedKmh: 30,
      elapsedMs: 10000,
      triggeredPins: ['pin-1', 'pin-2'],
      savedAt: Date.now(),
    })

    // RENDER: Start in active phase
    const { unmount, rerender } = render(<ExamDriveSession route={mockRoute} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    // Find and click finish button
    const finishButton = screen.getByText('დასრულება')
    const user = userEvent.setup()
    await act(async () => {
      await user.click(finishButton)
    })

    console.log('🔴 Testing restoration after finish...')

    // Verify localStorage is cleared
    expect(localStorage.getItem('cityroute-active-exam')).toBeNull()

    // Wait for effects
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200))
    })

    // Simulate component unmount and remount (like navigating away and back)
    unmount()
    
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    const { rerender: rerender2 } = render(<ExamDriveSession route={mockRoute} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    // VERIFICATION: Should be in preview phase (no saved session)
    // The bug would cause it to restore the old session
    try {
      const previewMap = screen.getByTestId('preview-map')
      expect(previewMap).toBeInTheDocument()
      console.log('✅ Preview phase shown - no restoration after finish')
    } catch (error) {
      // If preview is not found, session was incorrectly restored
      const finishButtonAgain = screen.queryByText('დასრულება')
      if (finishButtonAgain) {
        console.log('🐛 BUG DETECTED: Session was restored after intentional finish!')
        console.log('🐛 COUNTEREXAMPLE: clearActiveExam() called but session restored on remount')
        expect(finishButtonAgain).not.toBeInTheDocument()
      } else {
        throw error
      }
    }
  })

  it('[BUG EXPLORATION] should maintain summary phase across re-renders', async () => {
    // SETUP: Active session
    const exam = createExamSession(mockRoute.id, mockRoute.name_ka)
    saveActiveExam({
      routeId: mockRoute.id,
      routeSlug: mockRoute.slug,
      routeName: mockRoute.name_ka,
      phase: 'active',
      exam,
      userPos: mockUserPos,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 5000,
      triggeredPins: [],
      savedAt: Date.now(),
    })

    const { rerender } = render(<ExamDriveSession route={mockRoute} />)

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })

    // Click finish
    const finishButton = screen.getByText('დასრულება')
    const user = userEvent.setup()
    await act(async () => {
      await user.click(finishButton)
    })

    console.log('🔴 Testing phase stability across re-renders...')

    // Trigger multiple re-renders (simulating route prop changes)
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })
      rerender(<ExamDriveSession route={mockRoute} />)
    }

    // VERIFICATION: Summary should still be visible
    try {
      const summaryElement = screen.getByTestId('exam-summary')
      expect(summaryElement).toBeInTheDocument()
      console.log('✅ Summary phase stable across re-renders')
    } catch (error) {
      const finishButtonAgain = screen.queryByText('დასრულება')
      if (finishButtonAgain) {
        console.log('🐛 BUG DETECTED: Phase reverted to active after re-render!')
        console.log('🐛 COUNTEREXAMPLE: Summary phase not maintained across useEffect runs')
        expect(finishButtonAgain).not.toBeInTheDocument()
      } else {
        throw error
      }
    }

    // Verify localStorage is still clear
    expect(localStorage.getItem('cityroute-active-exam')).toBeNull()
  })
})
