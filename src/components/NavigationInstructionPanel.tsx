/**
 * Navigation Instruction Panel Component
 * 
 * Large, readable instruction display optimized for Android car displays
 * Shows:
 * - Distance to next instruction
 * - Current instruction text
 * - Maneuver icon (optional)
 */

import React from 'react'
import type { NavigationInstruction } from '@/lib/navigation-state'

interface NavigationInstructionPanelProps {
  instruction: NavigationInstruction | null
  distanceMeters: number | null
  className?: string
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} მ`
  }
  return `${(meters / 1000).toFixed(1)} კმ`
}

export function NavigationInstructionPanel({
  instruction,
  distanceMeters,
  className = '',
}: NavigationInstructionPanelProps) {
  if (!instruction) {
    return (
      <div className={`nav-instruction-panel nav-instruction-panel--empty ${className}`}>
        <div className="nav-instruction-panel__placeholder">
          ✅ ყველა მითითება დასრულებულია
        </div>
      </div>
    )
  }

  return (
    <div className={`nav-instruction-panel ${className}`}>
      {/* Distance indicator */}
      {distanceMeters !== null && (
        <div className="nav-instruction-panel__distance">
          <span className="nav-instruction-panel__distance-label">მანძილი:</span>
          <span className="nav-instruction-panel__distance-value">
            {formatDistance(distanceMeters)}
          </span>
        </div>
      )}

      {/* Instruction text - large and readable */}
      <div className="nav-instruction-panel__instruction">
        {instruction.instruction}
      </div>

      {/* Maneuver icon (if applicable) */}
      {instruction.maneuverType && (
        <div className="nav-instruction-panel__maneuver">
          <ManeuverIcon type={instruction.maneuverType} />
        </div>
      )}

      {/* State indicator (for debugging/testing) */}
      {instruction.state === 'triggered' && (
        <div className="nav-instruction-panel__state">
          🔊 მიმდინარეობს
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MANEUVER ICON COMPONENT
// ============================================================================

function ManeuverIcon({ type }: { type: string }) {
  const icons: Record<string, string> = {
    'turn-right': '➡️',
    'turn-left': '⬅️',
    'roundabout': '🔄',
    'straight': '⬆️',
    'u-turn': '↩️',
  }

  return (
    <div className="nav-maneuver-icon">
      {icons[type] || '📍'}
    </div>
  )
}
