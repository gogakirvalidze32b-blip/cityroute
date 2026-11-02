import type { LatLng } from '@/lib/gps'
import { chooseStartPin, isMovingFix, type StartFix, type StartPinInput } from '@/lib/start-pin'

/** Temporary safety limit: GPS may move an Auto start at most this many PINs past the saved progress. */
export const AUTO_GPS_MAX_SKIP_PINS = 3

export type AutoStartFix = {
  lat: number
  lng: number
  accuracy: number
  heading: number | null
  speed: number | null
}

export type AutoStartResult<T extends StartPinInput> = {
  /** PIN the Auto start will actually use. */
  pin: T | null
  /** Reliable GPS fix further ahead than the limit: not applied, kept for a future user choice. */
  aheadSuggestion: { pin: T; skippedOrders: number[] } | null
}

/**
 * Auto start = first PIN after the saved progress (PIN 1 on a new or fully completed route).
 * GPS may move it forward only for a reliable fix: accurate (chooseStartPin), moving with a heading
 * that matches the route, not the agency start, and at most AUTO_GPS_MAX_SKIP_PINS ahead.
 * In every other case the saved progress is used and no PIN is marked passed.
 */
export function resolveAutoStart<T extends StartPinInput>(
  sortedPins: readonly T[],
  completed: ReadonlySet<number>,
  fix: AutoStartFix | null,
  roadTrace: readonly LatLng[] | null,
): AutoStartResult<T> {
  const saved = sortedPins.find((pin) => !completed.has(pin.sort_order)) ?? sortedPins[0] ?? null
  const keep: AutoStartResult<T> = { pin: saved, aheadSuggestion: null }
  if (!saved || completed.size === 0 || !fix) return keep

  const startFix: StartFix = {
    position: [fix.lat, fix.lng],
    accuracyM: fix.accuracy,
    headingDeg: fix.heading,
    speedMps: fix.speed,
  }
  if (!isMovingFix(startFix)) return keep
  const decision = chooseStartPin(sortedPins, startFix, roadTrace)
  if (decision.kind !== 'start' || decision.basis === 'agency') return keep

  const savedIndex = sortedPins.indexOf(saved)
  const gpsIndex = sortedPins.findIndex((pin) => pin.sort_order === decision.sortOrder)
  if (gpsIndex <= savedIndex) return keep

  const skippedOrders = sortedPins.slice(savedIndex, gpsIndex).map((pin) => pin.sort_order)
  if (gpsIndex - savedIndex > AUTO_GPS_MAX_SKIP_PINS) {
    return { pin: saved, aheadSuggestion: { pin: sortedPins[gpsIndex], skippedOrders } }
  }
  return { pin: sortedPins[gpsIndex], aheadSuggestion: null }
}
