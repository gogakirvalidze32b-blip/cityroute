/**
 * Navigation Toolbar Component
 * 
 * Top toolbar with:
 * - Timer (elapsed time)
 * - Speed indicator
 * - View tabs (Map / Instructions)
 * - Settings button
 */

import React from 'react'

export type NavigationView = 'map' | 'instructions'

interface NavigationToolbarProps {
  elapsedMs: number
  speedKmh: number
  view: NavigationView
  onViewChange: (view: NavigationView) => void
  onSettings?: () => void
  showViewSwitcher?: boolean
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function NavigationToolbar({
  elapsedMs,
  speedKmh,
  view,
  onViewChange,
  onSettings,
  showViewSwitcher = true,
}: NavigationToolbarProps) {
  return (
    <div className="nav-toolbar">
      {/* Left: Timer and Speed */}
      <div className="nav-toolbar__left">
        <div className="nav-toolbar__timer">
          {formatDuration(elapsedMs)}
        </div>
        <div className="nav-toolbar__speed">
          <span className="nav-toolbar__speed-value">{Math.round(speedKmh)}</span>
          <span className="nav-toolbar__speed-unit">კმ/სთ</span>
        </div>
      </div>

      {/* Center: View Tabs */}
      {showViewSwitcher && (
        <div className="nav-toolbar__tabs">
          <button
            type="button"
            className={`nav-toolbar__tab ${view === 'map' ? 'nav-toolbar__tab--active' : ''}`}
            onClick={() => onViewChange('map')}
          >
            🗺️ რუკა
          </button>
          <button
            type="button"
            className={`nav-toolbar__tab ${view === 'instructions' ? 'nav-toolbar__tab--active' : ''}`}
            onClick={() => onViewChange('instructions')}
          >
            📋 მითითებები
          </button>
        </div>
      )}

      {/* Right: Settings */}
      {onSettings && (
        <button
          type="button"
          className="nav-toolbar__settings"
          onClick={onSettings}
          aria-label="პარამეტრები"
        >
          ⚙️
        </button>
      )}
    </div>
  )
}
