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
  /** Instructions queued behind the current PIN audio, in playback order. */
  queuedPinSortOrders?: number[]
  lastPassedSortOrder?: number | null
  nextSortOrder?: number | null
  /** Canonical ID for the PIN represented by nextSortOrder. */
  nextPinId?: string | null
  savedAt: number
}

const STORAGE_KEY = 'cityroute-active-exam'
const ROUTE_STORAGE_PREFIX = `${STORAGE_KEY}:`
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 საათი

function routeStorageKeys(routeId: string, routeSlug?: string): string[] {
  return [...new Set(
    [routeSlug, routeId]
      .filter((value): value is string => Boolean(value))
      .map((value) => `${ROUTE_STORAGE_PREFIX}${encodeURIComponent(value)}`),
  )]
}

function isSavedExamState(value: unknown): value is SavedExamState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<SavedExamState>
  return (
    typeof state.routeId === 'string' &&
    typeof state.routeName === 'string' &&
    state.phase === 'active' &&
    typeof state.savedAt === 'number' &&
    Number.isFinite(state.savedAt)
  )
}

function readSavedExam(storageKey = STORAGE_KEY): SavedExamState | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null

    const parsed: unknown = JSON.parse(raw)
    if (!isSavedExamState(parsed)) {
      console.error('Failed to load exam state: invalid saved exam data')
      return null
    }
    const state = parsed

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
  if (legacyState && matchesRoute(legacyState, routeId, routeSlug, routeName)) {
    const routeKey = routeStorageKeys(routeId, routeSlug)[0]
    if (routeKey) {
      try {
        localStorage.setItem(routeKey, JSON.stringify(legacyState))
      } catch (err) {
        console.error('Failed to migrate exam state:', err)
      }
    }
    return legacyState
  }
  return null
}

function matchesRoute(
  state: SavedExamState,
  routeId: string,
  routeSlug?: string,
  routeName?: string,
): boolean {
  if (routeSlug && state.routeSlug) return state.routeSlug === routeSlug
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
 * Keep each route's richer progress in its own slot.
 */
export function mergeExamSave(previous: SavedExamState | null, incoming: SavedExamState): SavedExamState {
  if (!previous || !sameRoute(previous, incoming)) return incoming
  const prevCount = orderCount(previous)
  const nextCount = orderCount(incoming)
  const mergePendingAudio = (state: SavedExamState): SavedExamState => {
    let merged = state
    if (!('pendingPinSortOrder' in incoming) && 'pendingPinSortOrder' in previous) {
      merged = { ...merged, pendingPinSortOrder: previous.pendingPinSortOrder }
    }
    if (!('queuedPinSortOrders' in incoming) && 'queuedPinSortOrders' in previous) {
      merged = { ...merged, queuedPinSortOrders: previous.queuedPinSortOrders }
    }
    if (incoming.nextPinId === undefined && previous.nextPinId !== undefined) {
      merged = { ...merged, nextPinId: previous.nextPinId }
    }
    return merged
  }
  if (prevCount > 0 && nextCount === 0) {
    return mergePendingAudio({
      ...incoming,
      triggeredSortOrders: previous.triggeredSortOrders,
      lastPassedSortOrder: previous.lastPassedSortOrder ?? incoming.lastPassedSortOrder,
      nextSortOrder: previous.nextSortOrder ?? incoming.nextSortOrder,
    })
  }
  if (prevCount > nextCount) return mergePendingAudio(previous)
  return mergePendingAudio(incoming)
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
    if (!routeKey) throw new Error('Cannot save exam state without a route identifier')
    const legacyState = readSavedExam()
    if (legacyState && !sameRoute(legacyState, incoming)) {
      const legacyRouteKey = routeStorageKeys(legacyState.routeId, legacyState.routeSlug)[0]
      if (legacyRouteKey && !readSavedExam(legacyRouteKey)) {
        localStorage.setItem(legacyRouteKey, JSON.stringify(legacyState))
      }
    }
    const previous =
      readSavedExamForRoute(incoming.routeId, incoming.routeSlug, incoming.routeName) ??
      (legacyState && sameRoute(legacyState, incoming) ? legacyState : null)
    const merged = options.allowProgressRollback ? incoming : mergeExamSave(previous, incoming)
    localStorage.setItem(routeKey, JSON.stringify(merged))
    // Keep a legacy latest-session entry for older app versions; route-keyed records are authoritative.
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
  const routeKey = `${ROUTE_STORAGE_PREFIX}${encodeURIComponent(routeSlug)}`
  const state = readSavedExam(routeKey) ?? readSavedExam()
  if (!state) return false
  if (state.routeSlug) return state.routeSlug === routeSlug
  return !!routeName && state.routeName === routeName
}

/**
 * Clear one route's save, or all saves when called without a route.
 */
export function clearActiveExam(routeId?: string, routeSlug?: string, routeName?: string): void {
  try {
    if (!routeId && !routeSlug) {
      const keys: string[] = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key === STORAGE_KEY || key?.startsWith(ROUTE_STORAGE_PREFIX)) keys.push(key)
      }
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
