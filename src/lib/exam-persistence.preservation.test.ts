/**
 * Preservation Property Tests - Home → Return Resume Behavior
 *
 * These tests use happy-dom's localStorage and the real exam-persistence
 * module. They check that a saved exam is restored for the same route.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createExamSession, type ExamSession } from '@/lib/exam-session'
import {
  clearActiveExam,
  examElapsedMsNow,
  examSessionOriginMs,
  hasSavedExamForSlug,
  loadActiveExam,
  saveActiveExam,
  type SavedExamState,
} from '@/lib/exam-persistence'
import type { LatLng } from '@/lib/gps'

const STORAGE_KEY = 'cityroute-active-exam'

describe('Preservation Property Tests - Home → Return Resume', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  test('Property 2.1: Restores exact session state on return to route', () => {
    const routeId = 'route-1-uuid'
    const routeSlug = 'route-1'
    const routeName = 'მარშრუტი 1'

    const originalExam: ExamSession = createExamSession(routeId, routeName)
    originalExam.minorTotal = 2
    originalExam.severeTotal = 1
    originalExam.counts['left-turn'] = { minor: 1, severe: 1 }
    originalExam.counts['speed-control'] = { minor: 1, severe: 0 }

    const originalUserPos: LatLng = [41.9183, 45.4784]
    const originalHeading = 135
    const originalSpeedKmh = 25
    const originalElapsedMs = 120000
    const originalTriggeredPins = ['pin-1', 'pin-2', 'pin-3']

    const savedState: SavedExamState = {
      routeId,
      routeSlug,
      routeName,
      phase: 'active',
      exam: originalExam,
      userPos: originalUserPos,
      heading: originalHeading,
      speedKmh: originalSpeedKmh,
      elapsedMs: originalElapsedMs,
      triggeredPins: originalTriggeredPins,
      savedAt: Date.now(),
    }

    saveActiveExam(savedState)

    const restored = loadActiveExam(routeId, routeSlug)

    expect(restored).not.toBeNull()
    expect(restored!.routeId).toBe(routeId)
    expect(restored!.routeSlug).toBe(routeSlug)
    expect(restored!.routeName).toBe(routeName)
    expect(restored!.phase).toBe('active')
    expect(restored!.exam.minorTotal).toBe(2)
    expect(restored!.exam.severeTotal).toBe(1)
    expect(restored!.exam.counts).toEqual(originalExam.counts)
    expect(restored!.userPos).toEqual(originalUserPos)
    expect(restored!.heading).toBe(originalHeading)
    expect(restored!.speedKmh).toBe(originalSpeedKmh)
    expect(restored!.triggeredPins).toEqual(originalTriggeredPins)
    expect(restored!.elapsedMs).toBe(originalElapsedMs)
  })

  test('Property 2.2: Valid sessions (< 24h) automatically resume', () => {
    const routeId = 'route-2-uuid'
    const routeSlug = 'route-2'
    const oneHourAgo = Date.now() - 60 * 60 * 1000

    const savedState: SavedExamState = {
      routeId,
      routeSlug,
      routeName: 'მარშრუტი 2',
      phase: 'active',
      exam: createExamSession(routeId, 'მარშრუტი 2'),
      userPos: [41.9183, 45.4784],
      heading: 90,
      speedKmh: 30,
      elapsedMs: 60000,
      triggeredPins: ['pin-1'],
      savedAt: oneHourAgo,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState))

    const restored = loadActiveExam(routeId, routeSlug)

    expect(restored).not.toBeNull()
    expect(restored!.phase).toBe('active')
    expect(hasSavedExamForSlug(routeSlug)).toBe(true)
  })

  test('Property 2.3: Expired sessions (> 24h) are cleared and not resumed', () => {
    const routeId = 'route-3-uuid'
    const routeSlug = 'route-3'
    const twentyFiveHoursAgo = Date.now() - 25 * 60 * 60 * 1000

    const savedState: SavedExamState = {
      routeId,
      routeSlug,
      routeName: 'მარშრუტი 3',
      phase: 'active',
      exam: createExamSession(routeId, 'მარშრუტი 3'),
      userPos: [41.9183, 45.4784],
      heading: 90,
      speedKmh: 30,
      elapsedMs: 60000,
      triggeredPins: [],
      savedAt: twentyFiveHoursAgo,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState))

    const restored = loadActiveExam(routeId, routeSlug)

    expect(restored).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  test('Property 2.4: Slug match survives route ID changes', () => {
    const localRouteId = 'local-route-1'
    const routeSlug = 'route-1'
    const supabaseRouteId = 'abc-123-uuid'

    const savedState: SavedExamState = {
      routeId: localRouteId,
      routeSlug,
      routeName: 'მარშრუტი 1',
      phase: 'active',
      exam: createExamSession(localRouteId, 'მარშრუტი 1'),
      userPos: [41.9183, 45.4784],
      heading: 45,
      speedKmh: 20,
      elapsedMs: 30000,
      triggeredPins: ['pin-1'],
      savedAt: Date.now(),
    }

    saveActiveExam(savedState)

    const restored = loadActiveExam(supabaseRouteId, routeSlug)

    expect(restored).not.toBeNull()
    expect(restored!.routeSlug).toBe(routeSlug)
    expect(restored!.routeId).toBe(localRouteId)
    expect(hasSavedExamForSlug(routeSlug)).toBe(true)
  })

  test('Property 2.5: Different route sessions are not restored', () => {
    const route1Id = 'route-1-uuid'
    const route1Slug = 'route-1'
    const route2Id = 'route-2-uuid'
    const route2Slug = 'route-2'

    const savedState: SavedExamState = {
      routeId: route1Id,
      routeSlug: route1Slug,
      routeName: 'მარშრუტი 1',
      phase: 'active',
      exam: createExamSession(route1Id, 'მარშრუტი 1'),
      userPos: [41.9183, 45.4784],
      heading: 90,
      speedKmh: 25,
      elapsedMs: 45000,
      triggeredPins: ['pin-1', 'pin-2'],
      savedAt: Date.now(),
    }

    saveActiveExam(savedState)

    expect(loadActiveExam(route2Id, route2Slug)).toBeNull()
    expect(hasSavedExamForSlug(route2Slug)).toBe(false)
  })

  test('Property 2.6: Elapsed time continues after resume', () => {
    const routeId = 'route-4-uuid'
    const routeSlug = 'route-4'
    const elapsedBeforePause = 60000
    const timeAwaySinceLastSave = 5000

    const savedState: SavedExamState = {
      routeId,
      routeSlug,
      routeName: 'მარშრუტი 4',
      phase: 'active',
      exam: createExamSession(routeId, 'მარშრუტი 4'),
      userPos: [41.9183, 45.4784],
      heading: 180,
      speedKmh: 20,
      elapsedMs: elapsedBeforePause,
      triggeredPins: [],
      savedAt: Date.now() - timeAwaySinceLastSave,
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedState))

    const restored = loadActiveExam(routeId, routeSlug)
    expect(restored).not.toBeNull()

    const sessionOrigin = examSessionOriginMs(restored!)
    const currentElapsed = examElapsedMsNow(restored!)
    const expectedMinElapsed = elapsedBeforePause + timeAwaySinceLastSave - 100

    expect(currentElapsed).toBeGreaterThanOrEqual(expectedMinElapsed)
    expect(sessionOrigin).toBeLessThan(Date.now())
  })

  test('Property 2.7: Multiple save cycles preserve latest state', () => {
    const routeId = 'route-5-uuid'
    const routeSlug = 'route-5'
    const routeName = 'მარშრუტი 5'

    const state1: SavedExamState = {
      routeId,
      routeSlug,
      routeName,
      phase: 'active',
      exam: createExamSession(routeId, routeName),
      userPos: [41.9183, 45.4784],
      heading: 90,
      speedKmh: 25,
      elapsedMs: 10000,
      triggeredPins: ['pin-1'],
      savedAt: Date.now() - 10000,
    }
    saveActiveExam(state1)

    const state2: SavedExamState = {
      ...state1,
      elapsedMs: 20000,
      triggeredPins: ['pin-1', 'pin-2'],
      savedAt: Date.now() - 5000,
    }
    saveActiveExam(state2)

    const exam3 = createExamSession(routeId, routeName)
    exam3.minorTotal = 1
    exam3.counts['speed-control'] = { minor: 1, severe: 0 }

    const state3: SavedExamState = {
      ...state2,
      exam: exam3,
      elapsedMs: 30000,
      triggeredPins: ['pin-1', 'pin-2', 'pin-3'],
      savedAt: Date.now(),
    }
    saveActiveExam(state3)

    const restored = loadActiveExam(routeId, routeSlug)

    expect(restored).not.toBeNull()
    expect(restored!.triggeredPins).toEqual(['pin-1', 'pin-2', 'pin-3'])
    expect(restored!.elapsedMs).toBe(30000)
    expect(restored!.exam.minorTotal).toBe(1)
  })

  test('Property 2.8: Clear operation removes session completely', () => {
    const routeId = 'route-6-uuid'
    const routeSlug = 'route-6'

    const savedState: SavedExamState = {
      routeId,
      routeSlug,
      routeName: 'მარშრუტი 6',
      phase: 'active',
      exam: createExamSession(routeId, 'მარშრუტი 6'),
      userPos: [41.9183, 45.4784],
      heading: 45,
      speedKmh: 30,
      elapsedMs: 15000,
      triggeredPins: ['pin-1'],
      savedAt: Date.now(),
    }

    saveActiveExam(savedState)
    expect(loadActiveExam(routeId, routeSlug)).not.toBeNull()

    clearActiveExam()

    expect(loadActiveExam(routeId, routeSlug)).toBeNull()
    expect(hasSavedExamForSlug(routeSlug)).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
