/**
 * Live route odometer: accumulates real GPS path length for the current exam.
 *
 * Distance is haversine between consecutive accepted fixes (not full route length).
 * Jump / implied-speed guards reject GPS noise so totals stay usable later for
 * along-route features such as speed-limit sections keyed by progress meters.
 */

import type { LatLng } from './gps'

export type RouteOdometerConfig = {
  /** Ignore jitter smaller than this (meters). */
  minStepMeters: number
  /** Reject a single step larger than this (meters). */
  maxJumpMeters: number
  /** Reject steps whose implied speed exceeds this (m/s). */
  maxSpeedMps: number
}

const DEFAULT_CONFIG: RouteOdometerConfig = {
  minStepMeters: 1.5,
  maxJumpMeters: 80,
  maxSpeedMps: 45, // ~162 km/h
}

export type RouteOdometerObservation = {
  accepted: boolean
  addedMeters: number
  totalMeters: number
  reason: 'anchor' | 'step' | 'jitter' | 'jump' | 'speed' | 'stale' | null
}

export type RouteOdometer = {
  observe(position: LatLng, timestampMs: number): RouteOdometerObservation
  /** Keep total; clear last fix so resume does not invent a teleport step. */
  restore(totalMeters: number): void
  reset(): void
  getTotalMeters(): number
  getLastPosition(): LatLng | null
}

function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const φ1 = (a[0] * Math.PI) / 180
  const φ2 = (b[0] * Math.PI) / 180
  const Δφ = ((b[0] - a[0]) * Math.PI) / 180
  const Δλ = ((b[1] - a[1]) * Math.PI) / 180
  const sinΔφ = Math.sin(Δφ / 2)
  const sinΔλ = Math.sin(Δλ / 2)
  const h = sinΔφ * sinΔφ + Math.cos(φ1) * Math.cos(φ2) * sinΔλ * sinΔλ
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function createRouteOdometer(config: Partial<RouteOdometerConfig> = {}): RouteOdometer {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  let totalMeters = 0
  let lastPosition: LatLng | null = null
  let lastTimestampMs: number | null = null

  return {
    observe(position, timestampMs) {
      if (!Number.isFinite(position[0]) || !Number.isFinite(position[1]) || !Number.isFinite(timestampMs)) {
        return { accepted: false, addedMeters: 0, totalMeters, reason: 'stale' }
      }

      if (!lastPosition || lastTimestampMs == null) {
        lastPosition = position
        lastTimestampMs = timestampMs
        return { accepted: true, addedMeters: 0, totalMeters, reason: 'anchor' }
      }

      const dtMs = timestampMs - lastTimestampMs
      if (dtMs < 0) {
        return { accepted: false, addedMeters: 0, totalMeters, reason: 'stale' }
      }

      const step = haversineMeters(lastPosition, position)
      if (step < cfg.minStepMeters) {
        // Update timestamp so a long stationary pause does not inflate implied speed later.
        lastTimestampMs = timestampMs
        return { accepted: false, addedMeters: 0, totalMeters, reason: 'jitter' }
      }

      if (step > cfg.maxJumpMeters) {
        // Re-anchor after a teleport / signal loss gap — do not add the jump.
        lastPosition = position
        lastTimestampMs = timestampMs
        return { accepted: false, addedMeters: 0, totalMeters, reason: 'jump' }
      }

      const dtSec = Math.max(dtMs / 1000, 0.001)
      if (step / dtSec > cfg.maxSpeedMps) {
        lastPosition = position
        lastTimestampMs = timestampMs
        return { accepted: false, addedMeters: 0, totalMeters, reason: 'speed' }
      }

      totalMeters += step
      lastPosition = position
      lastTimestampMs = timestampMs
      return { accepted: true, addedMeters: step, totalMeters, reason: 'step' }
    },

    restore(meters) {
      totalMeters = Number.isFinite(meters) && meters > 0 ? meters : 0
      lastPosition = null
      lastTimestampMs = null
    },

    reset() {
      totalMeters = 0
      lastPosition = null
      lastTimestampMs = null
    },

    getTotalMeters() {
      return totalMeters
    },

    getLastPosition() {
      return lastPosition
    },
  }
}

/** Round metres to the nearest 0.1 კმ step (100 m). */
export function distanceKmTenths(meters: number): number {
  const safe = Number.isFinite(meters) && meters > 0 ? meters : 0
  return Math.round(safe / 100) / 10
}

/** Display helper: kilometres in 0.1 steps (e.g. `0.1 კმ`, `1.2 კმ`). */
export function formatDistanceKm(meters: number): string {
  return `${distanceKmTenths(meters).toFixed(1)} კმ`
}
