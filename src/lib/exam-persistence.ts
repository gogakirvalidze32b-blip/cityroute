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
  /** Last pin already passed, in sort_order. Restored with the session; not chosen from GPS. */
  lastPassedPinId?: string | null
  /** Next pin to approach, in sort_order. */
  nextPinId?: string | null
  /** Handled pins by sort_order. Survives local `p1-*` ids versus Supabase UUIDs. */
  triggeredSortOrders?: number[]
  lastPassedSortOrder?: number | null
  nextSortOrder?: number | null
  /** New exam saved before its starting pin was chosen (nothing handled yet). */
  startPending?: boolean
  savedAt: number
}

const STORAGE_KEY = 'cityroute-active-exam'
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 საათი

export type StoredExam =
  | { status: 'empty' }
  | { status: 'corrupt' }
  | { status: 'expired' }
  | { status: 'ok'; state: SavedExamState }

function isSavedExamState(value: unknown): value is SavedExamState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<SavedExamState>
  return typeof state.routeId === 'string' && Array.isArray(state.triggeredPins)
}

/** Empty, expired, and unreadable storage stay distinct. A bad save is not "no exam". */
export function readStoredExam(): StoredExam {
  let raw: string | null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch (err) {
    console.error('Failed to load exam state:', err)
    return { status: 'corrupt' }
  }
  if (!raw) return { status: 'empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error('Failed to load exam state:', err)
    return { status: 'corrupt' }
  }
  if (!isSavedExamState(parsed)) return { status: 'corrupt' }

  const age = Date.now() - parsed.savedAt
  if (!Number.isFinite(parsed.savedAt) || age > MAX_AGE_MS) {
    console.log('🗑️ Saved exam expired (24h+), clearing')
    clearActiveExam()
    return { status: 'expired' }
  }
  return { status: 'ok', state: parsed }
}

function readSavedExam(): SavedExamState | null {
  const stored = readStoredExam()
  return stored.status === 'ok' ? stored.state : null
}

export type DescribedExam =
  | { kind: 'none' }
  | { kind: 'other-route' }
  | { kind: 'corrupt' }
  | { kind: 'ok'; state: SavedExamState }

/** What this route should do with the single saved exam slot. */
export function describeSavedExam(routeId: string, routeSlug?: string, routeName?: string): DescribedExam {
  const stored = readStoredExam()
  if (stored.status === 'corrupt') return { kind: 'corrupt' }
  if (stored.status !== 'ok') return { kind: 'none' }
  if (!matchesRoute(stored.state, routeId, routeSlug, routeName)) return { kind: 'other-route' }
  return { kind: 'ok', state: stored.state }
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
