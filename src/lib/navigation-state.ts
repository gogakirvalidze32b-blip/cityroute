/**
 * Navigation State Manager
 * 
 * CRITICAL ARCHITECTURE:
 * This is the single source of truth for navigation state.
 * Prevents backward GPS jumps, stale callbacks, and position corruption.
 * 
 * KEY PRINCIPLES:
 * 1. GPS updates are timestamped and sequenced
 * 2. Old GPS data NEVER overwrites newer state
 * 3. Route progress is monotonic (never moves backward from GPS noise)
 * 4. Position is always snapped to active route segment
 * 5. Heading is stable and based on actual movement
 * 6. Camera state is separate from GPS state
 */

import type { LatLng } from './gps'
import { snapToRoute, distanceToRoute } from './route-snapping'
import bearing from '@turf/bearing'
import { point } from '@turf/helpers'
import distance from '@turf/distance'

// ============================================================================
// TYPES
// ============================================================================

export interface RawGpsUpdate {
  position: LatLng
  accuracy: number
  speed: number | null
  heading: number | null
  timestamp: number
}

export interface NavigationState {
  // Raw GPS (last accepted)
  rawPosition: LatLng
  rawAccuracy: number
  rawSpeed: number
  rawTimestamp: number
  
  // Validated & Snapped Position
  snappedPosition: LatLng
  routeProgress: number // meters from route start (monotonic)
  routeSegmentIndex: number
  distanceFromRoute: number
  
  // Heading (stable, based on actual movement)
  heading: number
  lastMovementHeading: number
  
  // State flags
  isOnRoute: boolean
  isMoving: boolean
  
  // Sequence tracking
  updateSequence: number
  lastProcessedTimestamp: number
}

export type CameraMode = 'FOLLOW' | 'FREE'

export interface CameraState {
  mode: CameraMode
  targetPosition: LatLng | null
  targetHeading: number
  currentPosition: LatLng | null
  currentHeading: number
}

// ============================================================================
// NAVIGATION STATE MANAGER
// ============================================================================

export class NavigationStateManager {
  private state: NavigationState | null = null
  private route: LatLng[] = []
  private routeLength = 0
  private updateSequence = 0
  
  // GPS validation thresholds
  private readonly MAX_ACCURACY = 50 // meters
  private readonly MAX_SPEED = 50 // m/s (180 km/h)
  private readonly MAX_JUMP = 100 // meters
  private readonly MIN_MOVEMENT_FOR_HEADING = 3 // meters
  private readonly STATIONARY_SPEED = 1.5 // m/s (~5 km/h)
  private readonly MAX_OFF_ROUTE = 50 // meters
  private readonly MAX_BACKWARD_TOLERANCE = 5 // meters (allow tiny fluctuations)
  
  constructor(route: LatLng[]) {
    this.setRoute(route)
  }
  
  // ============================================================================
  // ROUTE MANAGEMENT
  // ============================================================================
  
  setRoute(route: LatLng[]): void {
    this.route = route
    this.routeLength = this.calculateRouteLength(route)
  }
  
  private calculateRouteLength(route: LatLng[]): number {
    let totalMeters = 0
    for (let i = 0; i < route.length - 1; i++) {
      const [lat1, lng1] = route[i]
      const [lat2, lng2] = route[i + 1]
      const dist = distance(point([lng1, lat1]), point([lng2, lat2]), { units: 'meters' })
      totalMeters += dist
    }
    return totalMeters
  }
  
  // ============================================================================
  // GPS UPDATE PROCESSING
  // ============================================================================
  
  /**
   * Process a GPS update
   * 
   * CRITICAL: This is the ONLY way to update navigation state
   * Returns null if the update is rejected
   */
  processGpsUpdate(update: RawGpsUpdate): NavigationState | null {
    this.updateSequence++
    
    // RULE 1: Reject stale GPS data
    if (this.state && update.timestamp <= this.state.lastProcessedTimestamp) {
      console.warn('[NAV] Rejected: Stale GPS (timestamp older than last processed)')
      return null
    }
    
    // RULE 2: Validate GPS quality
    if (!this.isGpsUpdateValid(update)) {
      return null
    }
    
    // RULE 3: Initialize or update state
    if (!this.state) {
      return this.initializeState(update)
    } else {
      return this.updateState(update)
    }
  }
  
  private isGpsUpdateValid(update: RawGpsUpdate): boolean {
    // Check accuracy
    if (update.accuracy > this.MAX_ACCURACY) {
      console.warn(`[NAV] Rejected: Poor accuracy (${update.accuracy.toFixed(1)}m)`)
      return false
    }
    
    // Check speed
    const speed = update.speed ?? 0
    if (speed > this.MAX_SPEED) {
      console.warn(`[NAV] Rejected: Impossible speed (${speed.toFixed(1)} m/s)`)
      return false
    }
    
    // Check position jump (if we have previous state)
    if (this.state) {
      const timeDelta = update.timestamp - this.state.rawTimestamp
      const dist = this.calculateDistance(this.state.rawPosition, update.position)
      
      // Reject impossible jumps
      if (dist > this.MAX_JUMP && timeDelta < 2000) {
        const impliedSpeed = dist / (timeDelta / 1000)
        console.warn(`[NAV] Rejected: Impossible jump (${dist.toFixed(1)}m in ${timeDelta}ms, implied speed: ${impliedSpeed.toFixed(1)} m/s)`)
        return false
      }
    }
    
    return true
  }
  
  private initializeState(update: RawGpsUpdate): NavigationState {
    // Snap to route
    const snappedPosition = snapToRoute(update.position, this.route, this.MAX_OFF_ROUTE)
    const distFromRoute = distanceToRoute(update.position, this.route)
    const isOnRoute = distFromRoute <= this.MAX_OFF_ROUTE
    
    // Calculate initial progress
    const progress = this.calculateRouteProgress(snappedPosition)
    
    // Initial heading from route direction
    const routeHeading = this.calculateRouteHeading(snappedPosition, progress.segmentIndex)
    
    this.state = {
      rawPosition: update.position,
      rawAccuracy: update.accuracy,
      rawSpeed: update.speed ?? 0,
      rawTimestamp: update.timestamp,
      
      snappedPosition,
      routeProgress: progress.meters,
      routeSegmentIndex: progress.segmentIndex,
      distanceFromRoute: distFromRoute,
      
      heading: routeHeading,
      lastMovementHeading: routeHeading,
      
      isOnRoute,
      isMoving: false,
      
      updateSequence: this.updateSequence,
      lastProcessedTimestamp: update.timestamp,
    }
    
    console.log('[NAV] Initialized:', {
      position: snappedPosition,
      progress: progress.meters.toFixed(1) + 'm',
      heading: this.state.heading.toFixed(1) + '°',
    })
    
    return this.state
  }
  
  private updateState(update: RawGpsUpdate): NavigationState {
    if (!this.state) throw new Error('State not initialized')
    
    const prevState = this.state
    
    // Calculate time and distance deltas
    const timeDelta = update.timestamp - prevState.rawTimestamp
    const rawDistance = this.calculateDistance(prevState.rawPosition, update.position)
    
    // Snap new position to route
    const snappedPosition = snapToRoute(update.position, this.route, this.MAX_OFF_ROUTE)
    const distFromRoute = distanceToRoute(update.position, this.route)
    const isOnRoute = distFromRoute <= this.MAX_OFF_ROUTE
    
    // Calculate new route progress
    const newProgress = this.calculateRouteProgress(snappedPosition, prevState.routeProgress, prevState.routeSegmentIndex)
    
    // CRITICAL: Enforce monotonic progress (never move backward)
    let acceptedProgress = newProgress.meters
    if (acceptedProgress < prevState.routeProgress - this.MAX_BACKWARD_TOLERANCE) {
      // Progress moved backward - likely GPS noise
      // Keep previous progress
      acceptedProgress = prevState.routeProgress
      console.warn(`[NAV] Progress clamped: ${newProgress.meters.toFixed(1)}m → ${acceptedProgress.toFixed(1)}m (prevented backward)`)
    }
    
    // Determine if vehicle is moving
    const speed = update.speed ?? 0
    const isMoving = speed >= this.STATIONARY_SPEED
    
    // Calculate heading
    let newHeading = prevState.heading
    const movementDistance = Math.abs(acceptedProgress - prevState.routeProgress)
    
    if (isMoving && movementDistance >= this.MIN_MOVEMENT_FOR_HEADING) {
      // Calculate heading from actual movement on route
      const routeHeading = this.calculateRouteHeading(snappedPosition, newProgress.segmentIndex)
      newHeading = routeHeading
    } else if (!isMoving) {
      // When stationary, keep last heading (don't let GPS noise rotate arrow)
      newHeading = prevState.heading
    }
    // else: moving but distance too small - keep previous heading
    
    // Update state
    this.state = {
      rawPosition: update.position,
      rawAccuracy: update.accuracy,
      rawSpeed: speed,
      rawTimestamp: update.timestamp,
      
      snappedPosition,
      routeProgress: acceptedProgress,
      routeSegmentIndex: newProgress.segmentIndex,
      distanceFromRoute: distFromRoute,
      
      heading: newHeading,
      lastMovementHeading: isMoving && movementDistance >= this.MIN_MOVEMENT_FOR_HEADING ? newHeading : prevState.lastMovementHeading,
      
      isOnRoute,
      isMoving,
      
      updateSequence: this.updateSequence,
      lastProcessedTimestamp: update.timestamp,
    }
    
    console.log('[NAV] Updated:', {
      rawDist: rawDistance.toFixed(1) + 'm',
      progress: acceptedProgress.toFixed(1) + 'm',
      heading: newHeading.toFixed(1) + '°',
      speed: speed.toFixed(1) + 'm/s',
      moving: isMoving,
    })
    
    return this.state
  }
  
  // ============================================================================
  // ROUTE PROGRESS CALCULATION
  // ============================================================================
  
  private calculateRouteProgress(
    position: LatLng,
    prevProgress?: number,
    prevSegmentIndex?: number
  ): { meters: number; segmentIndex: number } {
    if (this.route.length < 2) {
      return { meters: 0, segmentIndex: 0 }
    }
    
    // Find nearest segment (prioritize segments near previous progress)
    let nearestSegmentIndex = 0
    let nearestDistance = Infinity
    let nearestProgress = 0
    
    const searchStart = prevSegmentIndex !== undefined ? Math.max(0, prevSegmentIndex - 2) : 0
    const searchEnd = prevSegmentIndex !== undefined ? Math.min(this.route.length - 1, prevSegmentIndex + 5) : this.route.length - 1
    
    let cumulativeDistance = 0
    for (let i = 0; i < this.route.length - 1; i++) {
      const segmentDist = this.calculateDistance(this.route[i], this.route[i + 1])
      
      // Only consider segments in search window
      if (i >= searchStart && i <= searchEnd) {
        const distToSegment = this.distanceToSegment(position, this.route[i], this.route[i + 1])
        if (distToSegment < nearestDistance) {
          nearestDistance = distToSegment
          nearestSegmentIndex = i
          
          // Calculate progress along this segment
          const projectedDist = this.projectOntoSegment(position, this.route[i], this.route[i + 1])
          nearestProgress = cumulativeDistance + projectedDist
        }
      }
      
      cumulativeDistance += segmentDist
    }
    
    return {
      meters: nearestProgress,
      segmentIndex: nearestSegmentIndex,
    }
  }
  
  private calculateRouteHeading(position: LatLng, segmentIndex: number): number {
    if (this.route.length < 2) return 0
    
    const idx = Math.min(segmentIndex, this.route.length - 2)
    const from = this.route[idx]
    const to = this.route[idx + 1]
    
    return bearing(point([from[1], from[0]]), point([to[1], to[0]]))
  }
  
  // ============================================================================
  // GEOMETRY UTILITIES
  // ============================================================================
  
  private calculateDistance(pos1: LatLng, pos2: LatLng): number {
    const [lat1, lng1] = pos1
    const [lat2, lng2] = pos2
    return distance(point([lng1, lat1]), point([lng2, lat2]), { units: 'meters' })
  }
  
  private distanceToSegment(point: LatLng, segStart: LatLng, segEnd: LatLng): number {
    // Calculate perpendicular distance to segment
    const d = this.calculateDistance(segStart, segEnd)
    if (d === 0) return this.calculateDistance(point, segStart)
    
    // Project point onto segment
    const t = Math.max(0, Math.min(1, 
      ((point[0] - segStart[0]) * (segEnd[0] - segStart[0]) + 
       (point[1] - segStart[1]) * (segEnd[1] - segStart[1])) / (d * d)
    ))
    
    const projection: LatLng = [
      segStart[0] + t * (segEnd[0] - segStart[0]),
      segStart[1] + t * (segEnd[1] - segStart[1])
    ]
    
    return this.calculateDistance(point, projection)
  }
  
  private projectOntoSegment(point: LatLng, segStart: LatLng, segEnd: LatLng): number {
    const segmentLength = this.calculateDistance(segStart, segEnd)
    if (segmentLength === 0) return 0
    
    const t = Math.max(0, Math.min(1,
      ((point[0] - segStart[0]) * (segEnd[0] - segStart[0]) +
       (point[1] - segStart[1]) * (segEnd[1] - segStart[1])) / (segmentLength * segmentLength)
    ))
    
    return t * segmentLength
  }
  
  // ============================================================================
  // STATE ACCESS
  // ============================================================================
  
  getState(): NavigationState | null {
    return this.state
  }
  
  getUpdateSequence(): number {
    return this.updateSequence
  }
}

// ============================================================================
// CAMERA STATE MANAGER
// ============================================================================

export class CameraStateManager {
  private state: CameraState = {
    mode: 'FOLLOW',
    targetPosition: null,
    targetHeading: 0,
    currentPosition: null,
    currentHeading: 0,
  }
  
  getState(): CameraState {
    return this.state
  }
  
  setMode(mode: CameraMode): void {
    this.state.mode = mode
  }
  
  updateTarget(position: LatLng, heading: number): void {
    this.state.targetPosition = position
    this.state.targetHeading = heading
  }
  
  updateCurrent(position: LatLng, heading: number): void {
    this.state.currentPosition = position
    this.state.currentHeading = heading
  }
  
  recenter(position: LatLng, heading: number): void {
    this.state.mode = 'FOLLOW'
    this.state.targetPosition = position
    this.state.targetHeading = heading
  }
}
