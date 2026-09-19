/**
 * Navigation Map Component (Leaflet)
 * 
 * Professional navigation map with:
 * - Fixed-center vehicle arrow (CSS overlay, not Leaflet marker)
 * - Smooth GPS interpolation
 * - Camera follow mode with manual pan detection
 * - Route snapping
 * - No black triangles or tile gaps
 * - Optimized for Android tablets/car displays
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import type { LatLng } from '@/lib/gps'
import { MAP_TILES } from '@/lib/map-tiles'
import { YANDEX_STREET_ZOOM } from '@/data/telavi-routes'
import type { NavigationInstruction } from '@/lib/navigation-state'
import { GpsInterpolator, type GpsState } from '@/lib/gps-interpolation'
import { snapToRoute } from '@/lib/route-snapping'

// ============================================================================
// MAP UTILITIES
// ============================================================================

function resetMapRotation(map: L.Map): void {
  const pane = map.getPane('mapPane')
  if (!pane) return
  pane.style.transform = ''
  pane.style.transformOrigin = ''
  pane.style.willChange = ''
}

function setMapRotation(map: L.Map, heading: number): void {
  const pane = map.getPane('mapPane')
  if (!pane) return
  
  // Rotate around screen center (not GPS position)
  const center = map.getSize().divideBy(2)
  pane.style.transformOrigin = `${center.x}px ${center.y}px`
  pane.style.transform = `rotate(${-heading}deg)`
  pane.style.willChange = 'transform'
}

// ============================================================================
// MAP SIZE FIX COMPONENT
// ============================================================================

function MapSizeFix() {
  const map = useMap()
  
  useEffect(() => {
    // Initial invalidate
    map.invalidateSize()
    
    // Delayed invalidate to handle transitions
    const id = window.setTimeout(() => map.invalidateSize(), 80)
    
    return () => window.clearTimeout(id)
  }, [map])
  
  return null
}

// ============================================================================
// CAMERA FOLLOW CONTROLLER
// ============================================================================

interface CameraFollowProps {
  position: LatLng
  heading: number
  speed: number
  isFollowing: boolean
  polyline: LatLng[]
  onFollowPause: () => void
  onRecenterRequest: () => void
}

function CameraFollowController({
  position,
  heading,
  speed,
  isFollowing,
  polyline,
  onFollowPause,
  onRecenterRequest,
}: CameraFollowProps) {
  const map = useMap()
  const interpolatorRef = useRef<GpsInterpolator | null>(null)
  const rafRef = useRef<number>()
  const hasInitialized = useRef(false)
  const isRecenteringRef = useRef(false)
  const userIsDraggingRef = useRef(false)

  // Initialize interpolator
  useEffect(() => {
    if (!interpolatorRef.current) {
      interpolatorRef.current = new GpsInterpolator()
      
      // Set up callback for interpolated updates
      interpolatorRef.current.setOnUpdate((state) => {
        // Only update camera if following mode is active
        if (!isFollowing || userIsDraggingRef.current) return
        
        // Pan map to interpolated position (vehicle arrow stays fixed at center)
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          map.panTo(state.position, { 
            animate: false, 
            noMoveStart: true, 
            duration: 0 
          })
          
          // Apply smooth rotation
          setMapRotation(map, state.heading)
        })
      })
    }

    return () => {
      interpolatorRef.current?.stop()
    }
  }, [map, isFollowing])

  // Update interpolator when GPS position/heading/speed changes
  useEffect(() => {
    if (!interpolatorRef.current) return
    
    // Snap position to route before interpolating
    const snappedPosition = snapToRoute(position, polyline, 50)
    
    const gpsState: GpsState = {
      position: snappedPosition,
      heading,
      speed,
      timestamp: Date.now(),
    }
    
    interpolatorRef.current.updateTarget(gpsState)
  }, [position, heading, speed, polyline])

  // Initialize map on first mount
  useEffect(() => {
    if (!hasInitialized.current) {
      const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
      map.setView(position, zoom, { animate: false })
      
      // Increase padding to prevent black corners during rotation
      map.options.padding = [200, 200]
      
      hasInitialized.current = true
    }
  }, [map, position])

  // Handle follow mode changes
  useEffect(() => {
    if (!isFollowing && !isRecenteringRef.current) {
      // Follow paused - reset rotation
      resetMapRotation(map)
      interpolatorRef.current?.stop()
    } else if (isFollowing) {
      // Follow resumed - unlock heading
      interpolatorRef.current?.unlockHeading()
    }
  }, [isFollowing, map])

  // Detect user drag to pause follow mode
  useEffect(() => {
    const handleDragStart = () => {
      if (isFollowing && !isRecenteringRef.current) {
        userIsDraggingRef.current = true
        onFollowPause()
      }
    }
    
    const handleDragEnd = () => {
      userIsDraggingRef.current = false
    }
    
    const handleZoomStart = () => {
      if (isFollowing && !isRecenteringRef.current) {
        onFollowPause()
      }
    }
    
    map.on('dragstart', handleDragStart)
    map.on('dragend', handleDragEnd)
    map.on('zoomstart', handleZoomStart)
    
    return () => {
      map.off('dragstart', handleDragStart)
      map.off('dragend', handleDragEnd)
      map.off('zoomstart', handleZoomStart)
    }
  }, [map, isFollowing, onFollowPause])

  // Expose recenter function
  useEffect(() => {
    (window as any).__mapRecenter = () => {
      isRecenteringRef.current = true
      
      // Get current interpolated position or fall back to prop
      const currentState = interpolatorRef.current?.getCurrentState()
      const targetPos = currentState?.position || position
      
      // Smooth recenter animation
      const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
      map.setView(targetPos, zoom, { 
        animate: true,
        duration: 0.5,
      })
      
      // Resume following
      onRecenterRequest()
      
      // Reset flag after animation
      setTimeout(() => {
        isRecenteringRef.current = false
      }, 600)
    }
    
    return () => {
      delete (window as any).__mapRecenter
    }
  }, [map, position, onRecenterRequest])

  // Cleanup
  useEffect(() => {
    return () => {
      resetMapRotation(map)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      interpolatorRef.current?.stop()
    }
  }, [map])

  return null
}

// ============================================================================
// MAIN NAVIGATION MAP COMPONENT
// ============================================================================

interface NavigationMapLeafletProps {
  position: LatLng
  heading: number
  speed: number
  polyline: LatLng[]
  instructions: NavigationInstruction[]
  nextInstruction: NavigationInstruction | null
  showRecenterButton?: boolean
  className?: string
}

export function NavigationMapLeaflet({
  position,
  heading,
  speed,
  polyline,
  instructions,
  nextInstruction,
  showRecenterButton = true,
  className = '',
}: NavigationMapLeafletProps) {
  const [isFollowing, setIsFollowing] = useState(true)

  const handleRecenter = () => {
    if ((window as any).__mapRecenter) {
      (window as any).__mapRecenter()
    }
  }

  const handleFollowPause = () => {
    setIsFollowing(false)
  }

  const handleRecenterRequest = () => {
    setIsFollowing(true)
  }

  // Calculate distance to next instruction
  const nextInstructionDistance = useMemo(() => {
    if (!nextInstruction) return null
    
    const R = 6371000 // Earth radius in meters
    const [lat1, lon1] = position
    const [lat2, lon2] = nextInstruction.position
    
    const φ1 = (lat1 * Math.PI) / 180
    const φ2 = (lat2 * Math.PI) / 180
    const Δφ = ((lat2 - lat1) * Math.PI) / 180
    const Δλ = ((lon2 - lon1) * Math.PI) / 180
    
    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    
    return Math.round(R * c)
  }, [position, nextInstruction])

  // Determine if next instruction should pulse
  const shouldPulse = nextInstruction && nextInstructionDistance !== null && 
    nextInstructionDistance <= nextInstruction.triggerDistanceM

  return (
    <div className={`navigation-map ${className}`}>
      {/* Fixed-center vehicle arrow - CSS overlay only, never moves */}
      <div className="nav-arrow-overlay">
        <div 
          className="nav-arrow-rotator" 
          style={{ transform: `rotate(${heading}deg)` }}
        >
          <div className="nav-arrow-fixed" />
          <div className="nav-arrow-dot-fixed" />
        </div>
      </div>

      {/* Next instruction HUD */}
      {nextInstruction && nextInstructionDistance !== null && (
        <div className="nav-instruction-hud">
          <div className="nav-instruction-distance">
            {nextInstructionDistance < 1000 
              ? `${nextInstructionDistance} მ` 
              : `${(nextInstructionDistance / 1000).toFixed(1)} კმ`}
          </div>
          <div className="nav-instruction-text">
            {nextInstruction.instruction}
          </div>
        </div>
      )}

      {/* Recenter button - shows follow state */}
      {showRecenterButton && (
        <button
          type="button"
          className={`nav-recenter-btn ${!isFollowing ? 'nav-recenter-btn--active' : ''}`}
          onClick={handleRecenter}
          title="ცენტრში დაბრუნება"
          aria-label="ცენტრში დაბრუნება"
        >
          {isFollowing ? '🎯' : '📍'}
        </button>
      )}

      {/* Leaflet map */}
      <MapContainer
        center={position}
        zoom={YANDEX_STREET_ZOOM}
        className="navigation-map__canvas"
        zoomControl={false}
        attributionControl={false}
        dragging={true}
        touchZoom={true}
        doubleClickZoom={false}
        scrollWheelZoom={true}
        boxZoom={false}
        keyboard={false}
      >
        <MapSizeFix />
        <MapBasemapLayers tiles={MAP_TILES} detectRetina />

        {/* Route polyline */}
        <Polyline
          positions={polyline}
          pathOptions={{
            color: '#2563eb',
            weight: 6,
            opacity: 0.8,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />

        {/* Instruction markers */}
        {instructions.map((instruction) => {
          const isNext = nextInstruction?.id === instruction.id
          const isPulse = isNext && shouldPulse
          const isCompleted = instruction.state === 'completed'
          const isTriggered = instruction.state === 'triggered'
          
          return (
            <CircleMarker
              key={instruction.id}
              center={instruction.position}
              radius={isPulse ? 20 : 14}
              pathOptions={{
                color: isCompleted 
                  ? '#6b7280' 
                  : isTriggered 
                    ? '#f59e0b' 
                    : isNext 
                      ? '#0d9488' 
                      : '#047857',
                fillColor: isCompleted
                  ? '#9ca3af'
                  : isTriggered
                    ? '#fbbf24'
                    : isNext 
                      ? '#5eead4' 
                      : '#10b981',
                fillOpacity: isPulse ? 0.9 : isCompleted ? 0.5 : 1,
                weight: isPulse ? 3 : 2,
                className: isPulse ? 'nav-pin-pulse' : undefined,
              }}
            />
          )
        })}

        <CameraFollowController
          position={position}
          heading={heading}
          speed={speed}
          isFollowing={isFollowing}
          polyline={polyline}
          onFollowPause={handleFollowPause}
          onRecenterRequest={handleRecenterRequest}
        />
      </MapContainer>
    </div>
  )
}
