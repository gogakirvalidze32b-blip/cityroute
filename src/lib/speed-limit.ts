import { SPEED_LIMITS_BY_ROUTE } from '@/data/speed-limits'
import { recordExamError, type ExamSession } from '@/lib/exam-session'
import type { PinRow } from '@/types/database'

/** Error id of the „სიჩქარის ლიმიტის დარღვევა“ cell in EXAM_ERROR_GRID */
export const SPEED_LIMIT_ERROR_ID = 'speed-limit'

const COORD_EPS = 1e-5

/** Limit for one pin (null = unknown / NEEDS_VERIFICATION or no matching data). */
export function getPinSpeedLimit(routeSlug: string, pin: Pick<PinRow, 'sort_order' | 'lat' | 'lng'>): number | null {
  const entry = SPEED_LIMITS_BY_ROUTE[routeSlug]?.find((e) => e.n === pin.sort_order)
  if (!entry) return null
  if (Math.abs(entry.lat - pin.lat) > COORD_EPS || Math.abs(entry.lng - pin.lng) > COORD_EPS) return null
  return entry.speedLimitKmh
}

/**
 * Index of the pin whose road section the driver is currently on.
 * Pin N governs the road after pin N is reached, until pin N+1 is reached.
 * nextPin = first not-yet-triggered pin (strict sequence), so current section = nextPin - 1.
 * Before pin 1 is reached the first pin's limit applies. All pins reached -> last pin.
 */
export function currentSegmentIndex(pins: readonly Pick<PinRow, 'id'>[], nextPin: Pick<PinRow, 'id'> | null): number {
  if (!pins.length) return -1
  if (!nextPin) return pins.length - 1
  const nextIdx = pins.findIndex((p) => p.id === nextPin.id)
  if (nextIdx < 0) return -1
  return Math.max(0, nextIdx - 1)
}

export function getCurrentSpeedLimit(
  routeSlug: string,
  pins: readonly Pick<PinRow, 'id' | 'sort_order' | 'lat' | 'lng'>[],
  nextPin: Pick<PinRow, 'id'> | null,
): number | null {
  const idx = currentSegmentIndex(pins, nextPin)
  return idx < 0 ? null : getPinSpeedLimit(routeSlug, pins[idx])
}

/** Strictly greater than the limit. Speed is compared as displayed (rounded km/h). */
export function isSpeedLimitViolation(speedKmh: number, limitKmh: number | null): boolean {
  if (limitKmh == null || !Number.isFinite(limitKmh)) return false
  return Math.round(speedKmh) > limitKmh
}

/** Adds one „სიჩქარის ლიმიტის დარღვევა“ (minor) via the existing error system. */
export function recordSpeedLimitViolation(session: ExamSession): ExamSession {
  const base = session.counts[SPEED_LIMIT_ERROR_ID]
    ? session
    : { ...session, counts: { ...session.counts, [SPEED_LIMIT_ERROR_ID]: { minor: 0, severe: 0 } } }
  return recordExamError(base, SPEED_LIMIT_ERROR_ID, false)
}
