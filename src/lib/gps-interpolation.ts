/**
 * GPS Interpolation Engine
 * 
 * Converts low-frequency GPS updates (1-2/sec) into smooth 60fps animations
 * using linear interpolation for position and angular interpolation for heading.
 * 
 * Features:
 * - Speed-based smoothing (slower at low speeds, faster at high speeds)
 * - Heading stabilization (prevents jitter when stationary)
 * - Smooth transitions with easing
 * - 60fps animation loop
 */

import type { LatLng } from './gps'

export interface GpsState {
  position: LatLng
  heading: number
  speed: number
  timestamp: number
}

export interface InterpolatedState {
  position: LatLng
  heading: number
  speed: number
}

interface InterpolatorConfig {
  minSpeed: number // Below this speed (m/s), heading is locked
  headingStabilizationThreshold: number // Degrees - ignore heading changes below this
  maxInterpolationDuration: number // Max duration for interpolation (ms)
  minInterpolationDuration: number // Min duration for interpolation (ms)
}

const DEFAULT_CONFIG: InterpolatorConfig = {
  minSpeed: 1.5, // ~5 km/h - below this, lock heading
  headingStabilizationThreshold: 5, // Ignore heading changes < 5°
  maxInterpolationDuration: 2000,
  minInterpolationDuration: 100,
}

/**
 * Linear interpolation between two numbers
 */
function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
}

/**
 * Calculate angular distance between two angles
 */
function angleDifference(a: number, b: number): number {
  // Normalize to [0, 360)
  a = ((a % 360) + 360) % 360
  b = ((b % 360) + 360) % 360
  
  let diff = b - a
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  
  return Math.abs(diff)
}

/**
 * Angular interpolation with 360° wraparound handling
 * Always takes the shortest path between angles
 */
function lerpAngle(start: number, end: number, t: number): number {
  // Normalize angles to [0, 360)
  start = ((start % 360) + 360) % 360
  end = ((end % 360) + 360) % 360
  
  // Calculate the shortest angular distance
  let diff = end - start
  
  if (diff > 180) {
    diff -= 360
  } else if (diff < -180) {
    diff += 360
  }
  
  const result = start + diff * t
  return ((result % 360) + 360) % 360
}

/**
 * Calculate distance between two positions in meters
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
 * GPS Interpolation Engine
 * 
 * Provides smooth 60fps animation between low-frequency GPS updates
 * with speed-based smoothing and heading stabilization
 */
export class GpsInterpolator {
  private config: InterpolatorConfig
  private currentState: GpsState | null = null
  private targetState: GpsState | null = null
  private interpolationStartTime = 0
  private interpolationDuration = 1000
  private rafId: number | null = null
  private onUpdate: ((state: InterpolatedState) => void) | null = null
  private lockedHeading: number | null = null // Locked heading when stationary
  private headingHistory: number[] = [] // Recent headings for smoothing

  constructor(config: Partial<InterpolatorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Update the target GPS state
   * The interpolator will smoothly animate from current to this new state
   */
  updateTarget(state: GpsState): void {
    // If no current state, jump directly
    if (!this.currentState) {
      this.currentState = state
      this.targetState = state
      this.lockedHeading = state.heading
      this.notifyUpdate({ ...state })
      return
    }

    // Check if vehicle is stationary or moving very slowly
    const isStationary = state.speed < this.config.minSpeed

    // Calculate heading change
    const headingChange = angleDifference(this.currentState.heading, state.heading)
    
    // Decide whether to update heading
    let targetHeading = state.heading
    
    if (isStationary) {
      // When stationary, lock heading to prevent GPS noise rotation
      if (this.lockedHeading === null) {
        this.lockedHeading = this.currentState.heading
      }
      targetHeading = this.lockedHeading
    } else {
      // Moving - update heading, but apply stabilization
      if (headingChange < this.config.headingStabilizationThreshold) {
        // Small change - might be GPS noise, smooth it out
        this.headingHistory.push(state.heading)
        if (this.headingHistory.length > 3) {
          this.headingHistory.shift()
        }
        
        // Use average of recent headings
        if (this.headingHistory.length >= 2) {
          const sum = this.headingHistory.reduce((acc, h) => acc + h, 0)
          targetHeading = sum / this.headingHistory.length
        }
      } else {
        // Significant change - accept it
        this.headingHistory = [state.heading]
        targetHeading = state.heading
      }
      
      // Unlock heading when moving
      this.lockedHeading = null
    }

    // Calculate interpolation duration based on distance and speed
    const timeDelta = state.timestamp - this.currentState.timestamp
    const distance = calculateDistance(this.currentState.position, state.position)
    
    // Adaptive duration based on speed
    let duration: number
    if (isStationary) {
      // Very slow interpolation when stationary
      duration = this.config.maxInterpolationDuration
    } else if (state.speed > 10) {
      // Faster interpolation at high speeds
      duration = this.config.minInterpolationDuration
    } else {
      // Scale with speed
      duration = lerp(
        this.config.maxInterpolationDuration,
        this.config.minInterpolationDuration,
        state.speed / 10
      )
    }
    
    // Clamp to time delta if smaller
    this.interpolationDuration = Math.max(
      this.config.minInterpolationDuration,
      Math.min(duration, timeDelta * 1.5)
    )
    
    // Set new target with stabilized heading
    this.targetState = {
      ...state,
      heading: targetHeading,
    }
    this.interpolationStartTime = Date.now()
    
    // Start animation loop if not running
    if (this.rafId === null) {
      this.startAnimation()
    }
  }

  /**
   * Set the callback for interpolated state updates
   */
  setOnUpdate(callback: (state: InterpolatedState) => void): void {
    this.onUpdate = callback
  }

  /**
   * Start the animation loop
   */
  private startAnimation(): void {
    const animate = () => {
      if (!this.currentState || !this.targetState) {
        this.rafId = null
        return
      }

      const elapsed = Date.now() - this.interpolationStartTime
      const t = Math.min(1, elapsed / this.interpolationDuration)

      // Smooth easing function (ease-out cubic)
      const easedT = 1 - Math.pow(1 - t, 3)

      // Interpolate position
      const position: LatLng = [
        lerp(this.currentState.position[0], this.targetState.position[0], easedT),
        lerp(this.currentState.position[1], this.targetState.position[1], easedT),
      ]

      // Interpolate heading with angular interpolation
      const heading = lerpAngle(this.currentState.heading, this.targetState.heading, easedT)

      // Interpolate speed
      const speed = lerp(this.currentState.speed, this.targetState.speed, easedT)

      this.notifyUpdate({ position, heading, speed })

      // Continue animation if not finished
      if (t < 1) {
        this.rafId = requestAnimationFrame(animate)
      } else {
        // Animation complete, update current state
        this.currentState = this.targetState
        this.rafId = null
      }
    }

    this.rafId = requestAnimationFrame(animate)
  }

  /**
   * Notify the callback with interpolated state
   */
  private notifyUpdate(state: InterpolatedState): void {
    if (this.onUpdate) {
      this.onUpdate(state)
    }
  }

  /**
   * Stop the animation loop
   */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  /**
   * Get current interpolated state
   */
  getCurrentState(): InterpolatedState | null {
    if (!this.currentState) return null
    return {
      position: this.currentState.position,
      heading: this.currentState.heading,
      speed: this.currentState.speed,
    }
  }

  /**
   * Reset the interpolator
   */
  reset(): void {
    this.stop()
    this.currentState = null
    this.targetState = null
    this.lockedHeading = null
    this.headingHistory = []
  }

  /**
   * Force unlock heading (useful when resuming navigation)
   */
  unlockHeading(): void {
    this.lockedHeading = null
  }
}
