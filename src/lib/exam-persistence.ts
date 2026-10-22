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
  /** Handled pins by sort_order. Survives local `p2-*` ids versus Supabase UUIDs. */
  triggeredSortOrders?: number[]
  /** The instruction that was selected but whose audio has not ended yet. */
  pendingPinSortOrder?: number | null
  lastPassedSortOrder?: number | null
  nextSortOrder?: number | null
  savedAt: number
}

const STORAGE_KEY = 'cityroute-active-exam'
const ROUTE_STORAGE_PREFIX = `${STORAGE_KEY}:`
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 საათი

function routeStorageKeys(routeId: string, routeSlug?: string): string[] {
  const keys = [routeSlug, routeId]
    .filter((value): value is string => Boolean(value))
    .map((value) => `${ROUTE_STORAGE_PREFIX}${encodeURIComponent(value)}`)
  return [...new Set(keys)]
}

function readSavedExam(storageKey = STORAGE_KEY): SavedExamState | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null

    const state = JSON.parse(raw) as SavedExamState

    const age = Date.now() - state.savedAt
    if (age > MAX_AGE_MS) {
      console.log('🗑️ Saved exam expired (24h+), clearing')
      localStorage.removeItem(storageKey)
      return null
    }

    return state
  } catch (err) {
    console.error('Failed to load exam state:', err)
    return null
  }
}

function readSavedExamForRoute(
  routeId: string,
  routeSlug?: string,
  routeName?: string,
): SavedExamState | null {
  for (const key of routeStorageKeys(routeId, routeSlug)) {
    const state = readSavedExam(key)
    if (state && matchesRoute(state, routeId, routeSlug, routeName)) return state
  }

  const legacyState = readSavedExam()
  return legacyState && matchesRoute(legacyState, routeId, routeSlug, routeName) ? legacyState : null
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

function sameRoute(previous: SavedExamState, incoming: SavedExamState): boolean {
  if (previous.routeSlug && incoming.routeSlug) return previous.routeSlug === incoming.routeSlug
  return previous.routeId === incoming.routeId
}

function orderCount(state: SavedExamState): number {
  return Array.isArray(state.triggeredSortOrders) ? state.triggeredSortOrders.length : 0
}

/**
 * Keep the richer sort-order progress when a later write is empty or older.
 * Each route is persisted independently; the legacy slot remains the most recently saved route.
 */
export function mergeExamSave(previous: SavedExamState | null, incoming: SavedExamState): SavedExamState {
  if (!previous || !sameRoute(previous, incoming)) return incoming
  const prevCount = orderCount(previous)
  const nextCount = orderCount(incoming)
  const mergePendingPin = (state: SavedExamState): SavedExamState => {
    if ('pendingPinSortOrder' in incoming) return state
    if (!('pendingPinSortOrder' in previous)) return state
    return { ...state, pendingPinSortOrder: previous.pendingPinSortOrder }
  }
  if (prevCount > 0 && nextCount === 0) {
    return mergePendingPin({
      ...incoming,
      triggeredSortOrders: previous.triggeredSortOrders,
      lastPassedSortOrder: previous.lastPassedSortOrder ?? incoming.lastPassedSortOrder,
      nextSortOrder: previous.nextSortOrder ?? incoming.nextSortOrder,
    })
  }
  if (prevCount > nextCount) return previous
  return mergePendingPin(incoming)
}

/**
 * Save active exam state to localStorage
 */
export function saveActiveExam(
  state: SavedExamState,
  options: { allowProgressRollback?: boolean } = {},
): void {
  try {
    const incoming = { ...state, savedAt: Date.now() }
    const routeKey = routeStorageKeys(incoming.routeId, incoming.routeSlug)[0]
    const legacyState = readSavedExam()
    if (legacyState && !sameRoute(legacyState, incoming)) {
      const legacyRouteKey = routeStorageKeys(legacyState.routeId, legacyState.routeSlug)[0]
      if (!readSavedExam(legacyRouteKey)) {
        localStorage.setItem(legacyRouteKey, JSON.stringify(legacyState))
      }
    }
    const previous =
      readSavedExamForRoute(incoming.routeId, incoming.routeSlug, incoming.routeName) ??
      (legacyState && sameRoute(legacyState, incoming) ? legacyState : null)
    const merged = options.allowProgressRollback ? incoming : mergeExamSave(previous, incoming)
    localStorage.setItem(routeKey, JSON.stringify(merged))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
    console.log('💾 Exam state saved:', merged.routeName, merged.routeSlug ?? merged.routeId)
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
  const state = readSavedExamForRoute(routeId, routeSlug, routeName)
  if (!state) return null

  const age = Date.now() - state.savedAt
  console.log('✅ Loaded saved exam state:', state.routeName, `(${Math.round(age / 60000)}m ago)`)
  return state
}

/**
 * True when localStorage has an unexpired active exam for this slug.
 * Used before Supabase ids are available (RoutePage first paint).
 */
export function hasSavedExamForSlug(routeSlug: string, routeName?: string): boolean {
  const state = readSavedExam(`${ROUTE_STORAGE_PREFIX}${encodeURIComponent(routeSlug)}`) ?? readSavedExam()
  if (!state) return false
  if (state.routeSlug) return state.routeSlug === routeSlug
  return !!routeName && state.routeName === routeName
}

/**
 * Clear one route's saved exam, or all saved exams when called without a route.
 */
export function clearActiveExam(routeId?: string, routeSlug?: string, routeName?: string): void {
  try {
    if (!routeId && !routeSlug) {
      const keys = Object.keys(localStorage).filter(
        (key) => key === STORAGE_KEY || key.startsWith(ROUTE_STORAGE_PREFIX),
      )
      keys.forEach((key) => localStorage.removeItem(key))
    } else {
      const id = routeId ?? routeSlug!
      routeStorageKeys(id, routeSlug).forEach((key) => localStorage.removeItem(key))
      const legacyState = readSavedExam()
      if (legacyState && matchesRoute(legacyState, id, routeSlug, routeName)) {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
    console.log('🗑️ Cleared saved exam state', routeSlug ?? routeId ?? '')
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
