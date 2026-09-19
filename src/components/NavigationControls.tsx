/**
 * Navigation Controls Component
 * 
 * Bottom/floating controls for navigation:
 * - Stop/End navigation button
 * - Recenter button (when map is panned)
 * - Roundabout/maneuver trigger button (when applicable)
 */

import React from 'react'

interface NavigationControlsProps {
  onStop: () => void
  onRecenter?: () => void
  onTriggerRoundabout?: () => void
  showRecenter?: boolean
  showRoundabout?: boolean
  isFollowing?: boolean
}

export function NavigationControls({
  onStop,
  onRecenter,
  onTriggerRoundabout,
  showRecenter = false,
  showRoundabout = false,
  isFollowing = true,
}: NavigationControlsProps) {
  return (
    <div className="nav-controls">
      {/* Recenter button - only visible when not following */}
      {showRecenter && onRecenter && !isFollowing && (
        <button
          type="button"
          className="nav-controls__recenter"
          onClick={onRecenter}
          title="ცენტრში დაბრუნება"
        >
          <span className="nav-controls__icon">🎯</span>
          <span className="nav-controls__label">ცენტრი</span>
        </button>
      )}

      {/* Roundabout trigger button */}
      {showRoundabout && onTriggerRoundabout && (
        <button
          type="button"
          className="nav-controls__roundabout"
          onClick={onTriggerRoundabout}
          title="წრიული მოძრაობა"
        >
          <span className="nav-controls__icon">🔄</span>
          <span className="nav-controls__label">წრიული</span>
        </button>
      )}

      {/* Stop button - always visible, prominent */}
      <button
        type="button"
        className="nav-controls__stop"
        onClick={onStop}
        title="ნავიგაციის დასრულება"
      >
        <span className="nav-controls__icon">⏹️</span>
        <span className="nav-controls__label">დასრულება</span>
      </button>
    </div>
  )
}
