/**
 * Raw GPS trace recorder for field replay — development and Vercel Preview only.
 *
 * Every raw fix delivered to the exam session is kept in memory. Copy it from
 * the browser console (e.g. Chrome remote debugging) with:
 *   copy(JSON.stringify(window.__cityrouteGpsTrace))
 * and replay it in vitest through the ExamDriveSession replay harness.
 * Production builds never record (FIELD_DIAGNOSTICS_ENABLED folds to false).
 */
import type { GpsPosition } from './gps'
import { FIELD_DIAGNOSTICS_ENABLED } from './pin-chainage-flag'

const MAX_FIXES = 20_000

export type RecordedGpsFix = GpsPosition & { readonly routeSlug: string }

type TraceWindow = Window & { __cityrouteGpsTrace?: RecordedGpsFix[] }

export function recordGpsTraceFix(routeSlug: string, position: GpsPosition): void {
  if (!FIELD_DIAGNOSTICS_ENABLED || typeof window === 'undefined') return
  const target = window as TraceWindow
  const trace = (target.__cityrouteGpsTrace ??= [])
  if (trace.length >= MAX_FIXES) trace.shift()
  trace.push({
    routeSlug,
    lat: position.lat,
    lng: position.lng,
    accuracy: position.accuracy,
    heading: position.heading,
    speed: position.speed,
    timestamp: position.timestamp,
  })
}
