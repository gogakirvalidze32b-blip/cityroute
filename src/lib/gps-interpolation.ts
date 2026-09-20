/**
 * GPS Interpolation Engine
 * 
 * Converts low-frequency GPS updates (1-2/sec) into smooth 60fps animations
 * using linear interpolation for position and angular interpolation for heading.
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
}

/**
 * Linear interpolation between two numbers
 */
function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t
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
 * Calculate angular difference between two headings
 */
function angleDifference(a: number, b: number): number {
  a = ((a % 360) + 360) % 360
  b = ((b % 360) + 360) % 360
  let diff = b - a
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return Math.abs(diff)
}

/**
 * GPS Interpolation Engine
 * 
 * Provides smooth 60fps animation between low-frequency GPS updates
 * with heading stabilization to prevent jitter when stationary
 */
export class GpsInterpolator {
  private currentState: GpsState | null = null
  private targetState: GpsState | null = null
  private interpolationStartTime = 0
  private interpolationDuration = 1000 // Default 1 second
  private rafId: number | null = null
  private onUpdate: ((state: InterpolatedState) => void) | null = null
  private lockedHeading: number | null = null // Locked heading when stationary

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
      this.notifyUpdate(state)
      return
    }

    // Check if vehicle is moving (stationary detection)
    const isStationary = state.speed < 1.5 // Below ~5 km/h

    // Heading stabilization
    let targetHeading = state.heading
    if (isStationary) {
      // When stationary, lock heading to prevent GPS noise rotation
      if (this.lockedHeading === null) {
        this.lockedHeading = this.currentState.heading
      }
      targetHeading = this.lockedHeading
    } else {
      // Moving - check if heading change is significant
      const headingChange = angleDifference(this.currentState.heading, state.heading)
      if (headingChange < 5) {
        // Small change - might be GPS noise, keep current heading
        targetHeading = this.currentState.heading
      } else {
        // Significant change - accept new heading
        this.lockedHeading = null
      }
    }

    // Calculate interpolation duration based on distance and speed
    const timeDelta = state.timestamp - this.currentState.timestamp
    
    // Use actual time delta, clamped between 100ms and 2000ms
    this.interpolationDuration = Math.max(100, Math.min(2000, timeDelta))
    
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

      // Smooth easing function (ease-out)
      const easedT = 1 - Math.pow(1 - t, 3)

      // Interpolate position
      const position: LatLng = [
        lerp(this.currentState.position[0], this.targetState.position[0], easedT),
        lerp(this.currentState.position[1], this.targetState.position[1], easedT),
      ]

      // Interpolate heading with angular interpolation
      const heading = lerpAngle(this.currentState.heading, this.targetState.heading, easedT)

      this.notifyUpdate({ position, heading })

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
  }
}
