/**
 * Navigation State Manager
 * 
 * Manages instruction state machine to prevent infinite loops and ensure
 * each instruction triggers exactly once per navigation session.
 * 
 * State transitions:
 * PENDING → TRIGGERED → COMPLETED
 * 
 * - PENDING: Instruction not yet reached
 * - TRIGGERED: Instruction triggered (audio playing/played)
 * - COMPLETED: Instruction fully processed
 * 
 * This prevents GPS fluctuations from replaying the same instruction.
 */

import type { LatLng } from './gps'
import type { PinRow } from '@/types/database'

export type InstructionState = 'pending' | 'triggered' | 'completed'

export interface NavigationInstruction {
  id: string
  pinId: string
  position: LatLng
  instruction: string
  audioUrl: string
  triggerDistanceM: number
  maneuverType?: string
  state: InstructionState
  triggeredAt?: number
}

export interface ManeuverState {
  id: string
  type: string
  state: 'pending' | 'active' | 'completed'
  triggeredAt?: number
  completedAt?: number
}

export interface NavigationStateSnapshot {
  instructions: Map<string, NavigationInstruction>
  maneuvers: Map<string, ManeuverState>
  currentInstructionIndex: number
  sessionStartTime: number
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
 * Calculate bearing from pos1 to pos2 in degrees [0-360)
 */
function calculateBearing(pos1: LatLng, pos2: LatLng): number {
  const [lat1, lon1] = pos1
  const [lat2, lon2] = pos2
  
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  
  const θ = Math.atan2(y, x)
  const bearing = ((θ * 180) / Math.PI + 360) % 360
  
  return bearing
}

/**
 * Check if heading matches expected bearing to target
 * Allows for some tolerance to handle GPS inaccuracies
 */
function headingMatches(
  currentPos: LatLng,
  targetPos: LatLng,
  currentHeading: number | null,
  toleranceDegrees = 90
): boolean {
  if (currentHeading === null) return true // No heading available, assume valid
  
  const expectedBearing = calculateBearing(currentPos, targetPos)
  let diff = Math.abs(currentHeading - expectedBearing)
  
  // Normalize difference to [0, 180]
  if (diff > 180) diff = 360 - diff
  
  return diff <= toleranceDegrees
}

/**
 * Navigation State Manager
 * 
 * Manages instruction states and maneuver states with proper state machine
 */
export class NavigationStateManager {
  private instructions: Map<string, NavigationInstruction> = new Map()
  private maneuvers: Map<string, ManeuverState> = new Map()
  private currentInstructionIndex = 0
  private sessionStartTime = Date.now()
  private onInstructionTrigger: ((instruction: NavigationInstruction) => void) | null = null
  private onManeuverStart: ((maneuver: ManeuverState) => void) | null = null
  private onManeuverComplete: ((maneuver: ManeuverState) => void) | null = null

  /**
   * Initialize navigation with pins
   */
  initialize(pins: PinRow[]): void {
    this.instructions.clear()
    this.maneuvers.clear()
    this.currentInstructionIndex = 0
    this.sessionStartTime = Date.now()
    
    // Sort pins by sort_order
    const sortedPins = [...pins].sort((a, b) => a.sort_order - b.sort_order)
    
    // Create instruction entries
    sortedPins.forEach((pin, index) => {
      const instruction: NavigationInstruction = {
        id: `instruction-${index}`,
        pinId: pin.id,
        position: [pin.lat, pin.lng],
        instruction: pin.instruction_ka,
        audioUrl: pin.audio_url || '',
        triggerDistanceM: pin.trigger_distance_m,
        maneuverType: pin.maneuver_type || undefined,
        state: 'pending',
      }
      
      this.instructions.set(instruction.id, instruction)
      
      // Create maneuver state if this pin represents a maneuver
      if (pin.maneuver_type) {
        const maneuver: ManeuverState = {
          id: `maneuver-${pin.id}`,
          type: pin.maneuver_type,
          state: 'pending',
        }
        this.maneuvers.set(maneuver.id, maneuver)
      }
    })
  }

  /**
   * Update navigation state based on current position
   * Returns the next pending instruction if any
   */
  update(
    currentPosition: LatLng,
    currentHeading: number | null
  ): NavigationInstruction | null {
    // Find next pending instruction
    const allInstructions = Array.from(this.instructions.values())
    const pendingInstructions = allInstructions.filter(i => i.state === 'pending')
    
    if (pendingInstructions.length === 0) {
      return null // All instructions completed
    }
    
    const nextInstruction = pendingInstructions[0]
    
    // Calculate distance to next instruction
    const distance = calculateDistance(currentPosition, nextInstruction.position)
    
    // Check if within trigger distance
    if (distance <= nextInstruction.triggerDistanceM) {
      // Check heading matches
      const headingOk = headingMatches(
        currentPosition,
        nextInstruction.position,
        currentHeading,
        90 // 90° tolerance
      )
      
      if (headingOk) {
        // Trigger instruction
        this.triggerInstruction(nextInstruction.id)
        return nextInstruction
      }
    }
    
    return nextInstruction // Return as "next" but not yet triggered
  }

  /**
   * Manually trigger an instruction (for testing or manual control)
   */
  triggerInstruction(instructionId: string): void {
    const instruction = this.instructions.get(instructionId)
    if (!instruction) {
      console.warn(`Instruction ${instructionId} not found`)
      return
    }
    
    if (instruction.state !== 'pending') {
      console.warn(`Instruction ${instructionId} already ${instruction.state}`)
      return
    }
    
    // Transition: PENDING → TRIGGERED
    instruction.state = 'triggered'
    instruction.triggeredAt = Date.now()
    
    console.log(`📍 Instruction triggered: ${instruction.instruction}`)
    
    // Notify callback
    if (this.onInstructionTrigger) {
      this.onInstructionTrigger(instruction)
    }
    
    // Auto-complete after a delay (to prevent immediate re-trigger)
    setTimeout(() => {
      this.completeInstruction(instructionId)
    }, 3000) // 3 seconds buffer
  }

  /**
   * Mark instruction as completed
   */
  completeInstruction(instructionId: string): void {
    const instruction = this.instructions.get(instructionId)
    if (!instruction) return
    
    if (instruction.state === 'triggered') {
      // Transition: TRIGGERED → COMPLETED
      instruction.state = 'completed'
      console.log(`✅ Instruction completed: ${instruction.instruction}`)
    }
  }

  /**
   * Trigger a maneuver (e.g., roundabout button press)
   */
  triggerManeuver(maneuverType: string): boolean {
    // Find pending maneuver of this type
    const maneuver = Array.from(this.maneuvers.values()).find(
      m => m.type === maneuverType && m.state === 'pending'
    )
    
    if (!maneuver) {
      console.warn(`No pending ${maneuverType} maneuver found`)
      return false
    }
    
    // Transition: PENDING → ACTIVE
    maneuver.state = 'active'
    maneuver.triggeredAt = Date.now()
    
    console.log(`🎯 Maneuver started: ${maneuverType}`)
    
    // Notify callback
    if (this.onManeuverStart) {
      this.onManeuverStart(maneuver)
    }
    
    // Auto-complete after delay
    setTimeout(() => {
      this.completeManeuver(maneuver.id)
    }, 5000) // 5 seconds for maneuver
    
    return true
  }

  /**
   * Complete a maneuver
   */
  completeManeuver(maneuverId: string): void {
    const maneuver = this.maneuvers.get(maneuverId)
    if (!maneuver) return
    
    if (maneuver.state === 'active') {
      // Transition: ACTIVE → COMPLETED
      maneuver.state = 'completed'
      maneuver.completedAt = Date.now()
      
      console.log(`✅ Maneuver completed: ${maneuver.type}`)
      
      // Notify callback
      if (this.onManeuverComplete) {
        this.onManeuverComplete(maneuver)
      }
    }
  }

  /**
   * Get next pending instruction
   */
  getNextInstruction(): NavigationInstruction | null {
    const pending = Array.from(this.instructions.values()).find(i => i.state === 'pending')
    return pending || null
  }

  /**
   * Get all instructions
   */
  getAllInstructions(): NavigationInstruction[] {
    return Array.from(this.instructions.values())
  }

  /**
   * Get instruction state
   */
  getInstructionState(instructionId: string): InstructionState | null {
    return this.instructions.get(instructionId)?.state || null
  }

  /**
   * Check if instruction has been triggered
   */
  isInstructionTriggered(pinId: string): boolean {
    const instruction = Array.from(this.instructions.values()).find(i => i.pinId === pinId)
    return instruction?.state !== 'pending'
  }

  /**
   * Get progress (percentage of completed instructions)
   */
  getProgress(): number {
    const total = this.instructions.size
    if (total === 0) return 100
    
    const completed = Array.from(this.instructions.values()).filter(
      i => i.state === 'completed'
    ).length
    
    return (completed / total) * 100
  }

  /**
   * Set callback for instruction trigger
   */
  setOnInstructionTrigger(callback: (instruction: NavigationInstruction) => void): void {
    this.onInstructionTrigger = callback
  }

  /**
   * Set callback for maneuver start
   */
  setOnManeuverStart(callback: (maneuver: ManeuverState) => void): void {
    this.onManeuverStart = callback
  }

  /**
   * Set callback for maneuver complete
   */
  setOnManeuverComplete(callback: (maneuver: ManeuverState) => void): void {
    this.onManeuverComplete = callback
  }

  /**
   * Reset navigation state (for new session)
   */
  reset(): void {
    // Reset all instructions to pending
    this.instructions.forEach(instruction => {
      instruction.state = 'pending'
      instruction.triggeredAt = undefined
    })
    
    // Reset all maneuvers to pending
    this.maneuvers.forEach(maneuver => {
      maneuver.state = 'pending'
      maneuver.triggeredAt = undefined
      maneuver.completedAt = undefined
    })
    
    this.currentInstructionIndex = 0
    this.sessionStartTime = Date.now()
  }

  /**
   * Get snapshot of current state (for persistence)
   */
  getSnapshot(): NavigationStateSnapshot {
    return {
      instructions: new Map(this.instructions),
      maneuvers: new Map(this.maneuvers),
      currentInstructionIndex: this.currentInstructionIndex,
      sessionStartTime: this.sessionStartTime,
    }
  }

  /**
   * Restore from snapshot (for persistence)
   */
  restoreFromSnapshot(snapshot: NavigationStateSnapshot): void {
    this.instructions = new Map(snapshot.instructions)
    this.maneuvers = new Map(snapshot.maneuvers)
    this.currentInstructionIndex = snapshot.currentInstructionIndex
    this.sessionStartTime = snapshot.sessionStartTime
  }

  /**
   * Get triggered pin IDs (for backward compatibility)
   */
  getTriggeredPinIds(): string[] {
    return Array.from(this.instructions.values())
      .filter(i => i.state !== 'pending')
      .map(i => i.pinId)
  }
}

/**
 * Create a navigation state manager
 */
export function createNavigationStateManager(): NavigationStateManager {
  return new NavigationStateManager()
}
