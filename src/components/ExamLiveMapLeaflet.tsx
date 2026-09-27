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
// TWO CAMERA MODES:
// 1. FOLLOW MODE - GPS controls camera, map follows vehicle
// 2. FREE CAMERA MODE - User controls camera, can inspect freely
//
// CRITICAL RULES:
// - Vehicle arrow is FIXED to screen center - NEVER moves
// - Arrow is position:fixed CSS overlay OUTSIDE map container
// - Map camera moves underneath the fixed arrow
// - NO mapPane.style.transform rotation (causes black triangles)
// - Zoom works in BOTH modes
// - Only DRAG triggers FREE mode
// - Recenter button switches back to FOLLOW mode
// ============================================================================

type CameraMode = 'FOLLOW' | 'FREE'

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
 * Smooth heading interpolation to prevent arrow jitter
 */
function smoothHeading(current: number, target: number, smoothFactor: number = 0.15): number {
  // Handle 360° wraparound - always take shortest path
  let delta = target - current
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  
  return current + delta * smoothFactor
}

/**
 * Google Maps-style camera with FOLLOW and FREE modes
 */
function NavigationCamera({
  position,
  heading,
  mode,
  polyline,
  onRecenterComplete,
}: {
  position: LatLng
  heading: number
  mode: CameraMode
  polyline: LatLng[]
  onRecenterComplete?: () => void
}) {
  const map = useMap()
  const interpolatorRef = useRef<GpsInterpolator | null>(null)
  const hasInitialized = useRef(false)
  const rafRef = useRef<number | undefined>(undefined)
  const recenteringRef = useRef(false)

  // Initialize interpolator for smooth GPS following
  useEffect(() => {
    if (!interpolatorRef.current) {
      interpolatorRef.current = new GpsInterpolator()
      
      interpolatorRef.current.setOnUpdate((state) => {
        // Only follow GPS in FOLLOW mode or during recenter
        if (mode !== 'FOLLOW' && !recenteringRef.current) return
        
        // Smooth map movement - arrow stays fixed
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          map.panTo(state.position, { 
            animate: false, 
            noMoveStart: true, 
            duration: 0 
          })
          
          // NO MAP ROTATION to prevent black triangles
          // Arrow rotation is handled separately via CSS
        })
      })
    }

    return () => {
      interpolatorRef.current?.stop()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [map, mode])

  // Update GPS target when position/heading changes
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

  // Initialize map once
  useEffect(() => {
    if (!hasInitialized.current) {
      const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
      map.setView(position, zoom, { animate: false })
      hasInitialized.current = true
    }
  }, [map, position])

  // Stop interpolator in FREE mode
  useEffect(() => {
    if (mode === 'FREE' && interpolatorRef.current && !recenteringRef.current) {
      interpolatorRef.current.stop()
    }
  }, [mode])

  // Smooth recenter animation
  useEffect(() => {
    if (mode === 'FOLLOW' && !hasInitialized.current) {
      // User pressed recenter - smooth camera transition
      recenteringRef.current = true
      
      // Get current GPS position
      const snappedPosition = snapToRoute(position, polyline, 50)
      
      // Smooth flyTo animation
      map.flyTo(snappedPosition, map.getZoom(), {
        animate: true,
        duration: 0.8, // 800ms smooth transition
        easeLinearity: 0.25,
      })
      
      // Mark recenter complete after animation
      setTimeout(() => {
        recenteringRef.current = false
        if (onRecenterComplete) onRecenterComplete()
      }, 850)
    }
  }, [mode, map, position, polyline, onRecenterComplete])

  return null
}

/**
 * Detects manual map interaction (drag only - NOT zoom)
 * Zoom is allowed in both FOLLOW and FREE modes
 */
function InteractionDetector({ 
  mode,
  onEnterFreeMode 
}: { 
  mode: CameraMode
  onEnterFreeMode: () => void
}) {
  const map = useMap()
  
  // CRITICAL: Always keep zoom enabled
  // Only disable dragging in FOLLOW mode
  useEffect(() => {
    if (mode === 'FOLLOW') {
      // FOLLOW MODE: Disable drag but ALLOW zoom
      map.dragging.disable()
      map.touchZoom.enable() // ✅ Zoom allowed
      map.doubleClickZoom.enable() // ✅ Zoom allowed
      map.scrollWheelZoom.enable() // ✅ Zoom allowed
      map.boxZoom.enable()
      map.keyboard.enable()
    } else {
      // FREE MODE: Enable everything
      map.dragging.enable()
      map.touchZoom.enable()
      map.doubleClickZoom.enable()
      map.scrollWheelZoom.enable()
      map.boxZoom.enable()
      map.keyboard.enable()
    }
  }, [map, mode])
  
  // Detect drag ONLY (not zoom) to enter FREE mode
  useMapEvents({
    dragstart: () => {
      if (mode === 'FOLLOW') {
        onEnterFreeMode()
      }
    },
    // IMPORTANT: Do NOT listen to zoomstart
    // Zoom should work in FOLLOW mode without triggering FREE mode
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
  const [cameraMode, setCameraMode] = useState<CameraMode>('FOLLOW')
  const [smoothedHeading, setSmoothedHeading] = useState(heading)
  const pins = route.pins
  const polyline = route.polyline as LatLng[]

  // Smooth heading for arrow rotation (prevents jitter)
  useEffect(() => {
    setSmoothedHeading(prev => {
      // When stopped (low speed), maintain stable heading
      const newHeading = smoothHeading(prev, heading, 0.15)
      return newHeading
    })
  }, [heading])

  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m

  const handleRecenter = () => {
    // Switch to FOLLOW mode - camera will smoothly animate back
    setCameraMode('FOLLOW')
  }

  const handleEnterFreeMode = () => {
    // User started dragging - enter FREE camera
    setCameraMode('FREE')
  }

  // ============================================================================
  // CRITICAL ARCHITECTURE:
  // Arrow overlay is OUTSIDE (sibling) of .exam-live-map container
  // This prevents any map transforms from affecting the arrow
  // Arrow position is FIXED, only rotation changes based on smoothed heading
  // ============================================================================
  
  return (
    <>
      {/* ==================== FIXED VEHICLE ARROW ====================
          CRITICAL: Arrow must be OUTSIDE the map container!
          - position: fixed (to viewport, not parent)
          - Sibling of map, NOT child
          - NEVER moves X/Y - only rotates
          - NOT affected by any map transforms
          - Uses smoothed heading to prevent jitter */}
      <div className="fixed-navigation-arrow-overlay">
        <div className="fixed-navigation-arrow-rotator" style={{ transform: `rotate(${smoothedHeading}deg)` }}>
          <div className="fixed-navigation-arrow-icon"></div>
          <div className="fixed-navigation-arrow-dot"></div>
        </div>
      </div>

      {/* ==================== MAP CONTAINER ==================== */}
      <div className="exam-live-map">
        {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}
        
        {/* Recenter button - highlighted in FREE mode */}
        <button 
          type="button" 
          className={`map-recenter-btn exam-live-map__recenter ${cameraMode === 'FREE' ? 'map-recenter-btn--active' : ''}`}
          onClick={handleRecenter}
          title="ცენტრში დაბრუნება"
        >
          {cameraMode === 'FOLLOW' ? '🎯' : '📍'}
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

          {/* Interaction detector - only drag triggers FREE mode */}
          <InteractionDetector 
            mode={cameraMode} 
            onEnterFreeMode={handleEnterFreeMode} 
          />
          
          {/* Navigation camera - handles FOLLOW/FREE modes */}
          <NavigationCamera 
            position={userPos} 
            heading={heading} 
            mode={cameraMode}
            polyline={polyline}
            onRecenterComplete={() => {
              // Recenter animation complete
            }}
          />
        </MapContainer>
      </div>
    </>
  )
}
