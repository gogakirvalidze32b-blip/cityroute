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
// - Vehicle arrow is FIXED to screen center - NEVER moves X/Y
// - Arrow is position:fixed CSS overlay OUTSIDE map container
// - Map camera moves independently underneath the fixed arrow
// - NO mapPane.style.transform rotation (causes black triangles)
// - Zoom works in BOTH modes WITHOUT triggering mode change
// - ONLY DRAG triggers FREE mode
// - Recenter button is the ONLY way back to FOLLOW mode
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
 * Smooth heading interpolation - prevents arrow jitter
 * Handles 360° wraparound correctly
 */
function smoothHeading(current: number, target: number, smoothFactor: number = 0.15): number {
  // Shortest path around circle
  let delta = target - current
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  
  return current + delta * smoothFactor
}

/**
 * Google Maps-style Navigation Camera
 * 
 * FOLLOW MODE:
 * - GPS controls camera via interpolated panTo
 * - Map follows vehicle smoothly
 * - Arrow stays fixed at screen center
 * 
 * FREE CAMERA MODE:
 * - User controls camera (drag/zoom)
 * - GPS continues running but does NOT move camera
 * - No automatic return to vehicle
 * - Arrow stays fixed at screen center
 * 
 * RECENTER:
 * - Smooth flyTo animation back to vehicle
 * - Switches from FREE → FOLLOW
 * - Arrow stays fixed during animation
 */
function NavigationCamera({
  position,
  heading,
  mode,
  polyline,
  triggerRecenter,
}: {
  position: LatLng
  heading: number
  mode: CameraMode
  polyline: LatLng[]
  triggerRecenter: number // Increment to trigger recenter
}) {
  const map = useMap()
  const interpolatorRef = useRef<GpsInterpolator | null>(null)
  const hasInitialized = useRef(false)
  const rafRef = useRef<number | undefined>(undefined)
  const lastRecenterTrigger = useRef(0)

  // Initialize interpolator once
  useEffect(() => {
    if (!interpolatorRef.current) {
      interpolatorRef.current = new GpsInterpolator()
      
      // Callback for smooth GPS following
      interpolatorRef.current.setOnUpdate((state) => {
        // CRITICAL: Only follow GPS in FOLLOW mode
        if (mode !== 'FOLLOW') return
        
        // Smooth map movement - arrow stays fixed
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          map.panTo(state.position, { 
            animate: false, 
            noMoveStart: true, 
            duration: 0 
          })
          
          // NO MAP ROTATION - prevents black triangles
          // Arrow rotation is handled separately via CSS
        })
      })
    }

    return () => {
      interpolatorRef.current?.stop()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [map, mode])

  // Update GPS target when position changes
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

  // Initialize map once on mount
  useEffect(() => {
    if (!hasInitialized.current) {
      const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
      map.setView(position, zoom, { animate: false })
      hasInitialized.current = true
    }
  }, [map, position])

  // Stop interpolator in FREE mode to prevent camera fighting
  useEffect(() => {
    if (mode === 'FREE' && interpolatorRef.current) {
      interpolatorRef.current.stop()
    }
  }, [mode])

  // Handle recenter trigger
  useEffect(() => {
    if (triggerRecenter > lastRecenterTrigger.current) {
      lastRecenterTrigger.current = triggerRecenter
      
      // Get current GPS position
      const snappedPosition = snapToRoute(position, polyline, 50)
      
      // Smooth animation back to vehicle
      map.flyTo(snappedPosition, map.getZoom(), {
        animate: true,
        duration: 0.8,
        easeLinearity: 0.25,
      })
      
      // Note: Mode switch to FOLLOW is handled by parent component
    }
  }, [triggerRecenter, map, position, polyline])

  return null
}

/**
 * Interaction Detector
 * 
 * CRITICAL: Only DRAG triggers FREE mode
 * Zoom is allowed in BOTH modes without triggering mode change
 */
function InteractionDetector({ 
  mode,
  onEnterFreeMode 
}: { 
  mode: CameraMode
  onEnterFreeMode: () => void
}) {
  const map = useMap()
  
  // CRITICAL: ALWAYS enable zoom regardless of mode
  // Only dragging behavior changes between modes
  useEffect(() => {
    // Zoom is ALWAYS enabled
    map.touchZoom.enable()
    map.doubleClickZoom.enable()
    map.scrollWheelZoom.enable()
    map.boxZoom.enable()
    map.keyboard.enable()
    
    if (mode === 'FOLLOW') {
      // FOLLOW MODE: Disable drag only
      map.dragging.disable()
    } else {
      // FREE MODE: Enable everything
      map.dragging.enable()
    }
  }, [map, mode])
  
  // Detect ONLY drag (not zoom) to enter FREE mode
  useMapEvents({
    dragstart: () => {
      if (mode === 'FOLLOW') {
        onEnterFreeMode()
      }
    },
    // IMPORTANT: Do NOT listen to zoomstart/zoomend
    // Zoom must work in FOLLOW mode without triggering FREE mode
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
  const [recenterTrigger, setRecenterTrigger] = useState(0)
  
  const pins = route.pins
  const polyline = route.polyline as LatLng[]

  // Smooth heading for arrow rotation (prevents jitter)
  useEffect(() => {
    setSmoothedHeading(prev => smoothHeading(prev, heading, 0.15))
  }, [heading])

  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m

  const handleRecenter = () => {
    // CRITICAL: This is the ONLY way to return to FOLLOW mode
    // Trigger recenter animation
    setRecenterTrigger(prev => prev + 1)
    // Switch to FOLLOW mode
    setCameraMode('FOLLOW')
  }

  const handleEnterFreeMode = () => {
    // User started dragging - enter FREE camera
    setCameraMode('FREE')
  }

  // ============================================================================
  // CRITICAL ARCHITECTURE:
  // Arrow overlay is OUTSIDE (sibling) of .exam-live-map container
  // Arrow position is FIXED to viewport - NEVER changes X/Y
  // Only rotation changes based on smoothed heading
  // Map camera moves independently underneath the arrow
  // ============================================================================
  
  return (
    <>
      {/* ==================== FIXED VEHICLE ARROW ====================
          REPRESENTS: Current real vehicle GPS location
          POSITION: Fixed at screen center - NEVER moves X/Y
          ROTATION: Based on smoothed vehicle heading
          DOM: Sibling of map (not child) to avoid transform context issues
          CSS: position:fixed (viewport-relative, immune to map transforms) */}
      <div className="fixed-navigation-arrow-overlay">
        <div className="fixed-navigation-arrow-rotator" style={{ transform: `rotate(${smoothedHeading}deg)` }}>
          <div className="fixed-navigation-arrow-icon"></div>
          <div className="fixed-navigation-arrow-dot"></div>
        </div>
      </div>

      {/* ==================== MAP CONTAINER ==================== */}
      <div className="exam-live-map">
        {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}
        
        {/* Recenter button - ONLY way to return to FOLLOW mode */}
        <button 
          type="button" 
          className={`map-recenter-btn exam-live-map__recenter ${cameraMode === 'FREE' ? 'map-recenter-btn--active' : ''}`}
          onClick={handleRecenter}
          title="დაბრუნება ცენტრში"
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

          {/* Interaction detector - ONLY drag triggers FREE mode */}
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
            triggerRecenter={recenterTrigger}
          />
        </MapContainer>
      </div>
    </>
  )
}
