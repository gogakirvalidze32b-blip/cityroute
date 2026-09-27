import React, { useEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import { MAP_TILES } from '@/lib/map-tiles'
import { YANDEX_STREET_ZOOM } from '@/data/telavi-routes'
import type { PinRow, RouteWithPins } from '@/types/database'
import { GpsInterpolator, type GpsState } from '@/lib/gps-interpolation'
import { snapToRoute } from '@/lib/route-snapping'

// ============================================================================
// GOOGLE MAPS-STYLE NAVIGATION ARCHITECTURE
// ============================================================================
// 
// CRITICAL RULES:
// 1. Vehicle arrow is FIXED to screen center - NEVER moves
// 2. Map camera moves underneath the arrow
// 3. Arrow is NOT a Leaflet marker - it's a pure CSS overlay
// 4. Arrow is OUTSIDE the Leaflet map container (sibling, not child)
// 5. NO rotation of mapPane.style.transform (causes black triangles)
// 6. Map stays north-up for stability (rotation removed to fix black corners)
// ============================================================================

function MapSizeFix() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const id = window.setTimeout(() => map.invalidateSize(), 80)
    return () => window.clearTimeout(id)
  }, [map])
  return null
}

/**
 * Smooth GPS Camera - moves map to follow vehicle position
 * NEVER touches the arrow - arrow is completely separate
 */
function SmoothGpsCamera({
  position,
  heading,
  isFollowing,
  polyline,
}: {
  position: LatLng
  heading: number
  isFollowing: boolean
  polyline: LatLng[]
}) {
  const map = useMap()
  const interpolatorRef = useRef<GpsInterpolator | null>(null)
  const hasInitialized = useRef(false)
  const rafRef = useRef<number | undefined>(undefined)

  // Initialize interpolator for smooth movement
  useEffect(() => {
    if (!interpolatorRef.current) {
      interpolatorRef.current = new GpsInterpolator()
      
      interpolatorRef.current.setOnUpdate((state) => {
        if (!isFollowing) return
        
        // Only move the map - arrow stays fixed
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          map.panTo(state.position, { 
            animate: false, 
            noMoveStart: true, 
            duration: 0 
          })
          
          // NO ROTATION - keeps map north-up to prevent black triangles
          // Map rotation via mapPane.style.transform causes:
          // - Black triangular corners (undersized rotated rectangle)
          // - Overwrites Leaflet's internal pan transform
          // - Arrow movement issues
        })
      })
    }

    return () => {
      interpolatorRef.current?.stop()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [map, isFollowing])

  // Update interpolator target when GPS changes
  useEffect(() => {
    if (!interpolatorRef.current) return
    
    // Snap to route for stability
    const snappedPosition = snapToRoute(position, polyline, 50)
    
    const gpsState: GpsState = {
      position: snappedPosition,
      heading,
      speed: 0,
      timestamp: Date.now(),
    }
    
    interpolatorRef.current.updateTarget(gpsState)
  }, [position, heading, polyline])

  // Initialize zoom once
  useEffect(() => {
    if (!hasInitialized.current) {
      const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
      map.setView(position, zoom, { animate: false })
      hasInitialized.current = true
    }
  }, [map, position])

  // Stop following when user manually pans
  useEffect(() => {
    if (!isFollowing && interpolatorRef.current) {
      interpolatorRef.current.stop()
    }
  }, [isFollowing])

  return null
}

/**
 * Detects manual map interaction
 */
function InteractionController({ 
  isFollowing, 
  onPause 
}: { 
  isFollowing: boolean
  onPause: () => void
}) {
  const map = useMap()
  
  // Enable/disable map interactions based on follow state
  useEffect(() => {
    if (isFollowing) {
      // Disable manual interaction during navigation
      map.dragging.disable()
      map.touchZoom.disable()
      map.doubleClickZoom.disable()
      map.scrollWheelZoom.disable()
      map.boxZoom.disable()
      map.keyboard.disable()
    } else {
      // Enable when paused
      map.dragging.enable()
      map.touchZoom.enable()
      map.doubleClickZoom.enable()
      map.scrollWheelZoom.enable()
      map.boxZoom.enable()
      map.keyboard.enable()
    }
  }, [map, isFollowing])
  
  // Detect user interaction
  useMapEvents({
    dragstart: () => {
      if (isFollowing) onPause()
    },
    zoomstart: () => {
      if (isFollowing) onPause()
    },
  })
  
  return null
}

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
  mapBadge?: string
}

export function ExamLiveMapLeaflet({ route, userPos, heading, nextPin, mapBadge }: Props) {
  const [isFollowing, setIsFollowing] = useState(true)
  const pins = route.pins
  const polyline = route.polyline as LatLng[]

  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m

  const handleRecenter = () => {
    setIsFollowing(true)
  }

  // ============================================================================
  // CRITICAL ARCHITECTURE:
  // Arrow overlay is OUTSIDE (sibling) of .exam-live-map container
  // This prevents any map transforms from affecting the arrow
  // ============================================================================
  
  return (
    <>
      {/* ==================== FIXED VEHICLE ARROW ====================
          CRITICAL: Arrow must be OUTSIDE the map container!
          - position: fixed (to viewport, not parent)
          - Sibling of map, NOT child
          - NEVER moves - only rotates
          - NOT affected by any map transforms */}
      <div className="fixed-navigation-arrow-overlay">
        <div className="fixed-navigation-arrow-rotator" style={{ transform: `rotate(${heading}deg)` }}>
          <div className="fixed-navigation-arrow-icon"></div>
          <div className="fixed-navigation-arrow-dot"></div>
        </div>
      </div>

      {/* ==================== MAP CONTAINER ==================== */}
      <div className="exam-live-map">
        {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}
        
        {/* Recenter button */}
        <button 
          type="button" 
          className={`map-recenter-btn exam-live-map__recenter ${!isFollowing ? 'map-recenter-btn--active' : ''}`}
          onClick={handleRecenter}
          title="ცენტრში დაბრუნება"
        >
          {isFollowing ? '🎯' : '📍'}
        </button>

        {/* Next instruction HUD */}
        {nextPin && (
          <div className="exam-live-map__hud">
            <small>შემდეგი · {nextPinDist} მ</small>
            <strong>{nextPin.instruction_ka}</strong>
          </div>
        )}

        {/* Leaflet Map */}
        <MapContainer
          center={userPos}
          zoom={YANDEX_STREET_ZOOM}
          className="exam-live-map__canvas"
          zoomControl={false}
          attributionControl={false}
        >
          <MapSizeFix />
          <MapBasemapLayers tiles={MAP_TILES} detectRetina />

          {/* Route pins */}
          {pins.map((pin) => {
            const isNext = nextPin?.id === pin.id
            const isPulse = isNext && nextPinPulse
            return (
              <CircleMarker
                key={pin.id}
                center={[pin.lat, pin.lng]}
                radius={isPulse ? 20 : 14}
                pathOptions={{
                  color: isNext ? '#0d9488' : '#047857',
                  fillColor: isNext ? '#5eead4' : '#10b981',
                  fillOpacity: isPulse ? 0.9 : 1,
                  weight: isPulse ? 3 : 2,
                  className: isPulse ? 'exam-pin-pulse' : undefined,
                }}
              />
            )
          })}

          {/* Interaction controller */}
          <InteractionController 
            isFollowing={isFollowing} 
            onPause={() => setIsFollowing(false)} 
          />
          
          {/* Smooth GPS camera */}
          <SmoothGpsCamera 
            position={userPos} 
            heading={heading} 
            isFollowing={isFollowing}
            polyline={polyline}
          />
        </MapContainer>
      </div>
    </>
  )
}
