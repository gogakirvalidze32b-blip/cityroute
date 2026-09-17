/**
 * Exam session persistence - save/restore active exam state
 */

import type { ErrorCounts, ExamSession } from './exam-session'
import type { LatLng } from './gps'

export type SavedExamState = {
  routeId: string
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

/**
 * Save active exam state to localStorage
 */
export function saveActiveExam(state: SavedExamState): void {
  try {
    const data = JSON.stringify({ ...state, savedAt: Date.now() })
    localStorage.setItem(STORAGE_KEY, data)
    console.log('💾 Exam state saved:', state.routeName)
  } catch (err) {
    console.error('Failed to save exam state:', err)
  }
}

/**
 * Load active exam state from localStorage
 */
export function loadActiveExam(routeId: string): SavedExamState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const state = JSON.parse(raw) as SavedExamState
    
    // Check if expired (older than 24h)
    const age = Date.now() - state.savedAt
    if (age > MAX_AGE_MS) {
      console.log('🗑️ Saved exam expired (24h+), clearing')
      clearActiveExam()
      return null
    }

    // Check if same route
    if (state.routeId !== routeId) {
      console.log('⚠️ Saved exam is for different route')
      return null
    }

    console.log('✅ Loaded saved exam state:', state.routeName, `(${Math.round(age / 60000)}m ago)`)
    return state
  } catch (err) {
    console.error('Failed to load exam state:', err)
    return null
  }
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
export function hasSavedExam(routeId: string): boolean {
  const state = loadActiveExam(routeId)
  return state !== null
}
