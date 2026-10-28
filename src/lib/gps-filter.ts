/**
 * GPS Filtering Library
 * 
 * Filters out GPS noise, jumps, and invalid data to provide
 * clean position updates for navigation.
 */

import type { LatLng } from './gps'

export interface GpsReading {
  position: LatLng
  accuracy: number
  speed: number
  timestamp: number
}

export interface FilterConfig {
  maxAccuracyMeters: number // Reject readings with worse accuracy
  maxSpeedMps: number // Reject impossible speeds (m/s)
  maxJumpMeters: number // Reject position jumps larger than this
  minTimeDeltaMs: number // Minimum time between readings
}

const DEFAULT_CONFIG: FilterConfig = {
  maxAccuracyMeters: 50, // Reject if accuracy > 50m
  maxSpeedMps: 50, // 180 km/h max (50 m/s)
  maxJumpMeters: 100, // 100m max jump
  minTimeDeltaMs: 100, // At least 100ms between readings
}

/**
 * Calculate distance between two positions in meters
 * Using haversine formula
 */
function calculateDistance(pos1: LatLng, pos2: LatLng): number {
  const R = 6371000 // Earth radius in meters
  const [lat1, lon1] = pos1
  const [lat2, lon2] = pos2
  
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  
  return R * c
}

/**
 * GPS Filter
 * 
 * Filters GPS readings to remove noise and invalid data
 */
export class GpsFilter {
  private config: FilterConfig
  private lastReading: GpsReading | null = null
  /** Why the most recent reading was rejected; null when it was accepted. */
  lastRejection: string | null = null

  constructor(config: Partial<FilterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Filter a GPS reading
   * 
   * @returns The reading if valid, null if rejected
   */
  filter(reading: GpsReading): GpsReading | null {
    this.lastRejection = null

    // Check accuracy
    if (reading.accuracy > this.config.maxAccuracyMeters) {
      this.lastRejection = `poor accuracy (${reading.accuracy.toFixed(1)}m > ${this.config.maxAccuracyMeters}m)`
      console.warn(`GPS: Rejected - poor accuracy (${reading.accuracy.toFixed(1)}m)`)
      return null
    }

    // Check speed
    if (reading.speed > this.config.maxSpeedMps) {
      this.lastRejection = `impossible speed (${reading.speed.toFixed(1)} m/s)`
      console.warn(`GPS: Rejected - impossible speed (${reading.speed.toFixed(1)} m/s)`)
      return null
    }

    // Check against last reading if available
    if (this.lastReading) {
      const timeDelta = reading.timestamp - this.lastReading.timestamp
      
      // Check minimum time delta
      if (timeDelta < this.config.minTimeDeltaMs) {
        this.lastRejection = `too soon (${timeDelta}ms)`
        console.warn(`GPS: Rejected - too soon (${timeDelta}ms)`)
        return null
      }

      // Check for position jumps
      const distance = calculateDistance(this.lastReading.position, reading.position)
      const timeDeltaSec = timeDelta / 1000
      const impliedSpeed = distance / timeDeltaSec

      if (distance > this.config.maxJumpMeters && timeDeltaSec < 2) {
        this.lastRejection = `jump too large (${distance.toFixed(1)}m in ${timeDeltaSec.toFixed(1)}s)`
        console.warn(`GPS: Rejected - jump too large (${distance.toFixed(1)}m in ${timeDeltaSec.toFixed(1)}s)`)
        return null
      }

      if (impliedSpeed > this.config.maxSpeedMps && timeDeltaSec < 2) {
        this.lastRejection = `implied speed too high (${impliedSpeed.toFixed(1)} m/s)`
        console.warn(`GPS: Rejected - implied speed too high (${impliedSpeed.toFixed(1)} m/s)`)
        return null
      }
    }

    // Reading is valid, update last reading
    this.lastReading = reading
    return reading
  }

  /**
   * Reset the filter state
   */
  reset(): void {
    this.lastReading = null
    this.lastRejection = null
  }

  /**
   * Get the last valid reading
   */
  getLastReading(): GpsReading | null {
    return this.lastReading
  }

  /**
   * Update filter configuration
   */
  updateConfig(config: Partial<FilterConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

/**
 * Create a GPS filter with default or custom configuration
 */
export function createGpsFilter(config?: Partial<FilterConfig>): GpsFilter {
  return new GpsFilter(config)
}
