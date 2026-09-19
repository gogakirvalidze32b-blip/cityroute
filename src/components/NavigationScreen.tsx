/**
 * Navigation Screen Component
 * 
 * Complete navigation screen that combines:
 * - Navigation toolbar (top)
 * - Navigation map with fixed arrow
 * - Instruction panel (overlay or separate view)
 * - Navigation controls (bottom)
 * 
 * Matches the reference image design
 */

import React, { useState } from 'react'
import { NavigationMapLeaflet } from './NavigationMapLeaflet'
import { NavigationToolbar, type NavigationView } from './NavigationToolbar'
import { NavigationInstructionPanel } from './NavigationInstructionPanel'
import { NavigationControls } from './NavigationControls'
import type { LatLng } from '@/lib/gps'
import type { NavigationInstruction } from '@/lib/navigation-state'

interface NavigationScreenProps {
  // GPS data
  position: LatLng
  heading: number
  speed: number
  
  // Route data
  polyline: LatLng[]
  instructions: NavigationInstruction[]
  nextInstruction: NavigationInstruction | null
  distanceToNextM: number | null
  
  // Session data
  elapsedMs: number
  
  // Callbacks
  onStop: () => void
  onSettings?: () => void
  onTriggerRoundabout?: () => void
  
  // Options
  showViewSwitcher?: boolean
  enableInstructionsView?: boolean
  enableRoundaboutButton?: boolean
}

export function NavigationScreen({
  position,
  heading,
  speed,
  polyline,
  instructions,
  nextInstruction,
  distanceToNextM,
  elapsedMs,
  onStop,
  onSettings,
  onTriggerRoundabout,
  showViewSwitcher = false,
  enableInstructionsView = false,
  enableRoundaboutButton = false,
}: NavigationScreenProps) {
  const [view, setView] = useState<NavigationView>('map')
  const [isFollowing, setIsFollowing] = useState(true)

  const handleRecenter = () => {
    if ((window as any).__mapRecenter) {
      (window as any).__mapRecenter()
    }
    setIsFollowing(true)
  }

  const showMap = view === 'map' || !enableInstructionsView
  const showInstructions = view === 'instructions' && enableInstructionsView

  return (
    <div className="navigation-screen">
      {/* Top toolbar */}
      <NavigationToolbar
        elapsedMs={elapsedMs}
        speedKmh={speed}
        view={view}
        onViewChange={setView}
        onSettings={onSettings}
        showViewSwitcher={showViewSwitcher && enableInstructionsView}
      />

      {/* Main content area */}
      <div className="navigation-screen__content">
        {/* Map view */}
        {showMap && (
          <NavigationMapLeaflet
            position={position}
            heading={heading}
            speed={speed}
            polyline={polyline}
            instructions={instructions}
            nextInstruction={nextInstruction}
            showRecenterButton={true}
            className="navigation-screen__map"
          />
        )}

        {/* Instructions view */}
        {showInstructions && (
          <div className="navigation-screen__instructions">
            <NavigationInstructionPanel
              instruction={nextInstruction}
              distanceMeters={distanceToNextM}
            />
            
            {/* List of upcoming instructions */}
            <div className="navigation-screen__instruction-list">
              <h3 className="navigation-screen__instruction-list-title">
                მომავალი მითითებები
              </h3>
              {instructions
                .filter(i => i.state === 'pending')
                .slice(0, 5)
                .map((instruction, index) => (
                  <div key={instruction.id} className="navigation-screen__instruction-item">
                    <div className="navigation-screen__instruction-item-number">
                      {index + 1}
                    </div>
                    <div className="navigation-screen__instruction-item-text">
                      {instruction.instruction}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <NavigationControls
        onStop={onStop}
        onRecenter={handleRecenter}
        onTriggerRoundabout={onTriggerRoundabout}
        showRecenter={showMap}
        showRoundabout={enableRoundaboutButton}
        isFollowing={isFollowing}
      />

      {/* Completion status */}
      {instructions.length > 0 && (
        <div className="navigation-screen__progress">
          {instructions.filter(i => i.state === 'completed').length} / {instructions.length}
        </div>
      )}
    </div>
  )
}
