/**
 * Exam session persistence - save/restore active exam state
 */

import type { ExamSession } from './exam-session'
import type { LatLng } from './gps'

export type SavedExamState = {
  routeId: string
  /** Stable across local-route-* → Supabase UUID. Preferred match key. */
  routeSlug?: string
  routeName: string
  phase: 'active'
  exam: ExamSession
  userPos: LatLng | null
  heading: number
  speedKmh: number
  elapsedMs: number
  triggeredPins: string[]
  savedAt: number
}

const STORAGE_KEY = 'cityroute-active-exam'
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 საათი

function readSavedExam(): SavedExamState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const state = JSON.parse(raw) as SavedExamState

    const age = Date.now() - state.savedAt
    if (age > MAX_AGE_MS) {
      console.log('🗑️ Saved exam expired (24h+), clearing')
      clearActiveExam()
      return null
    }

    return state
  } catch (err) {
    console.error('Failed to load exam state:', err)
    return null
  }
}

function matchesRoute(
  state: SavedExamState,
  routeId: string,
  routeSlug?: string,
  routeName?: string,
): boolean {
  if (routeSlug && state.routeSlug && state.routeSlug === routeSlug) return true
  if (state.routeId === routeId) return true
  // Legacy saves (written before routeSlug existed) under a different id namespace
  // (local-route-N vs Supabase UUID): fall back to the route name, which is always the bundled one.
  if (!state.routeSlug && routeName && state.routeName === routeName) return true
  return false
}

/**
 * Save active exam state to localStorage
 */
export function saveActiveExam(state: SavedExamState): void {
  try {
    const data = JSON.stringify({ ...state, savedAt: Date.now() })
    localStorage.setItem(STORAGE_KEY, data)
    console.log('💾 Exam state saved:', state.routeName, state.routeSlug ?? state.routeId)
  } catch (err) {
    console.error('Failed to save exam state:', err)
  }
}

/**
 * Load active exam for this route.
 * Match by slug first (survives local ID → Supabase UUID), then by routeId (legacy saves).
 */
export function loadActiveExam(
  routeId: string,
  routeSlug?: string,
  routeName?: string,
): SavedExamState | null {
  const state = readSavedExam()
  if (!state) return null

  if (!matchesRoute(state, routeId, routeSlug, routeName)) {
    console.log('⚠️ Saved exam is for a different route')
    return null
  }

  const age = Date.now() - state.savedAt
  console.log('✅ Loaded saved exam state:', state.routeName, `(${Math.round(age / 60000)}m ago)`)
  return state
}

/**
 * True when localStorage has an unexpired active exam for this slug.
 * Used before Supabase ids are available (RoutePage first paint).
 */
export function hasSavedExamForSlug(routeSlug: string, routeName?: string): boolean {
  const state = readSavedExam()
  if (!state) return false
  if (state.routeSlug) return state.routeSlug === routeSlug
  return !!routeName && state.routeName === routeName
}

/**
 * Clear saved exam state
 */
export function clearActiveExam(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
    console.log('🗑️ Cleared saved exam state')
  } catch (err) {
    console.error('Failed to clear exam state:', err)
  }
}

/**
 * Check if there's a saved exam for this route
 */
export function hasSavedExam(routeId: string, routeSlug?: string, routeName?: string): boolean {
  return loadActiveExam(routeId, routeSlug, routeName) !== null
}

/**
 * Wall-clock origin of the exam clock.
 * Resume: savedAt - elapsedMs (includes time spent away after the last save).
 * Legacy fallback: Date.now() - elapsedMs.
 */
export function examSessionOriginMs(saved: SavedExamState): number {
  const elapsed = Number.isFinite(saved.elapsedMs) ? Math.max(0, saved.elapsedMs) : 0
  if (typeof saved.savedAt === 'number' && saved.savedAt > 0) {
    return saved.savedAt - elapsed
  }
  return Date.now() - elapsed
}

/** Elapsed ms right now for a saved session (saved elapsed + time since last save). */
export function examElapsedMsNow(saved: SavedExamState): number {
  return Math.max(0, Date.now() - examSessionOriginMs(saved))
}
