import React, { useEffect, useRef, useState, useCallback } from 'react'
import { CircleMarker, MapContainer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import { MAP_TILES } from '@/lib/map-tiles'
import { YANDEX_STREET_ZOOM } from '@/data/telavi-routes'
import type { PinRow, RouteWithPins } from '@/types/database'
import { NavigationStateManager, CameraStateManager, type RawGpsUpdate, type CameraMode } from '@/lib/navigation-state'

// ============================================================================
// GOOGLE MAPS-STYLE NAVIGATION SYSTEM
// ============================================================================
//
// ARCHITECTURE:
// 1. NavigationStateManager - Single source of truth for GPS/route state
// 2. CameraStateManager - Separate camera state (FOLLOW vs FREE mode)
// 3. Fixed arrow overlay - Never moves X/Y, only rotates
// 4. Map camera - Moves underneath fixed arrow
//
// KEY FIX for PROBLEMS:
// - GPS timestamps prevent old callbacks from corrupting state
// - Route progress is monotonic (never moves backward)
// - Camera state is separate from GPS state
// - FREE mode lets user inspect map without GPS interference
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
 * Smooth angle interpolation - shortest path around circle
 */
function lerpAngle(current: number, target: number, factor: number): number {
  current = ((current % 360) + 360) % 360
  target = ((target % 360) + 360) % 360
  
  let delta = target - current
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  
  return current + delta * factor
}

/**
 * Navigation Camera Controller
 * 
 * FOLLOW MODE: Camera follows GPS navigation state
 * FREE MODE: Camera controlled by user, GPS doesn't interfere
 */
function NavigationCameraController({
  navManager,
  cameraManager,
  onCameraUpdate,
}: {
  navManager: React.MutableRefObject<NavigationStateManager | null>
  cameraManager: React.MutableRefObject<CameraStateManager>
  onCameraUpdate: (position: LatLng, heading: number) => void
}) {
  const map = useMap()
  const rafRef = useRef<number>()
  const hasInitialized = useRef(false)
  const currentDisplayPosition = useRef<LatLng | null>(null)
  const currentDisplayHeading = useRef(0)
  
  // Animation loop for smooth camera movement
  useEffect(() => {
    const animate = () => {
      const navState = navManager.current?.getState()
      const cameraState = cameraManager.current.getState()
      
      if (!navState) {
        rafRef.current = requestAnimationFrame(animate)
        return
      }
      
      // Initialize if needed
      if (!hasInitialized.current) {
        map.setView(navState.snappedPosition, YANDEX_STREET_ZOOM, { animate: false })
        currentDisplayPosition.current = navState.snappedPosition
        currentDisplayHeading.current = navState.heading
        hasInitialized.current = true
      }
      
      // Update camera target from navigation state
      cameraManager.current.updateTarget(navState.snappedPosition, navState.heading)
      
      // In FOLLOW mode: smoothly move camera to navigation position
      if (cameraState.mode === 'FOLLOW') {
        // Smooth position interpolation
        if (currentDisplayPosition.current) {
          const [currentLat, currentLng] = currentDisplayPosition.current
          const [targetLat, targetLng] = navState.snappedPosition
          
          // Interpolate position (smooth factor 0.15 = ~6-7 frames to reach target)
          const smoothFactor = 0.15
          const newLat = currentLat + (targetLat - currentLat) * smoothFactor
          const newLng = currentLng + (targetLng - currentLng) * smoothFactor
          
          currentDisplayPosition.current = [newLat, newLng]
          
          // Move map camera
          map.panTo(currentDisplayPosition.current, {
            animate: false,
            noMoveStart: true,
            duration: 0,
          })
        }
        
        // Smooth heading interpolation
        currentDisplayHeading.current = lerpAngle(
          currentDisplayHeading.current,
          navState.heading,
          0.1
        )
        
        // Notify parent of camera update
        onCameraUpdate(currentDisplayPosition.current || navState.snappedPosition, currentDisplayHeading.current)
      }
      // In FREE mode: do nothing, user controls camera
      
      rafRef.current = requestAnimationFrame(animate)
    }
    
    rafRef.current = requestAnimationFrame(animate)
    
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [map, navManager, cameraManager, onCameraUpdate])
  
  return null
}

/**
 * Interaction Handler
 * Switches to FREE camera mode on drag
 * Zoom does NOT trigger mode change
 */
function InteractionHandler({
  cameraMode,
  onEnterFreeMode,
}: {
  cameraMode: CameraMode
  onEnterFreeMode: () => void
}) {
  const map = useMap()
  
  // Always enable zoom regardless of mode
  useEffect(() => {
    map.touchZoom.enable()
    map.scrollWheelZoom.enable()
    map.doubleClickZoom.enable()
    map.boxZoom.enable()
    map.keyboard.enable()
    
    if (cameraMode === 'FOLLOW') {
      map.dragging.disable()
    } else {
      map.dragging.enable()
    }
  }, [map, cameraMode])
  
  // Only drag triggers FREE mode
  useMapEvents({
    dragstart: () => {
      if (cameraMode === 'FOLLOW') {
        onEnterFreeMode()
      }
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
  onGpsUpdate?: (update: RawGpsUpdate) => void // For parent to send GPS updates
}

export function ExamLiveMapLeaflet({ route, userPos, heading, nextPin, mapBadge, onGpsUpdate }: Props) {
  const [cameraMode, setCameraMode] = useState<CameraMode>('FOLLOW')
  const [displayHeading, setDisplayHeading] = useState(heading)
  
  const navManagerRef = useRef<NavigationStateManager | null>(null)
  const cameraManagerRef = useRef<CameraStateManager>(new CameraStateManager())
  
  const pins = route.pins
  const polyline = route.polyline as LatLng[]
  
  // Initialize navigation manager
  useEffect(() => {
    navManagerRef.current = new NavigationStateManager(polyline)
  }, [polyline])
  
  // Process GPS updates from parent
  useEffect(() => {
    if (!navManagerRef.current) return
    
    const gpsUpdate: RawGpsUpdate = {
      position: userPos,
      accuracy: 20, // TODO: Get real accuracy from parent
      speed: null,
      heading: heading,
      timestamp: Date.now(),
    }
    
    const navState = navManagerRef.current.processGpsUpdate(gpsUpdate)
    
    if (navState) {
      // Navigation state updated successfully
      console.log('[NAV] State updated:', navState)
    }
  }, [userPos, heading])
  
  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m
  
  const handleRecenter = useCallback(() => {
    const navState = navManagerRef.current?.getState()
    if (!navState) return
    
    // Switch to FOLLOW mode and recenter camera
    setCameraMode('FOLLOW')
    cameraManagerRef.current.recenter(navState.snappedPosition, navState.heading)
    
    console.log('[CAMERA] Recentered to vehicle')
  }, [])
  
  const handleEnterFreeMode = useCallback(() => {
    setCameraMode('FREE')
    cameraManagerRef.current.setMode('FREE')
    console.log('[CAMERA] Entered FREE mode')
  }, [])
  
  const handleCameraUpdate = useCallback((position: LatLng, heading: number) => {
    setDisplayHeading(heading)
    cameraManagerRef.current.updateCurrent(position, heading)
  }, [])
  
  // ============================================================================
  // RENDER
  // ============================================================================
  
  return (
    <>
      {/* ==================== FIXED VEHICLE ARROW ====================
          CRITICAL: Arrow is OUTSIDE map container
          - position: fixed (viewport-relative)
          - Never moves X/Y
          - Only rotates based on navigation heading
          - Represents current vehicle direction */}
      <div className="fixed-navigation-arrow-overlay">
        <div className="fixed-navigation-arrow-rotator" style={{ transform: `rotate(${displayHeading}deg)` }}>
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

          {/* Interaction handler */}
          <InteractionHandler 
            cameraMode={cameraMode}
            onEnterFreeMode={handleEnterFreeMode}
          />
          
          {/* Navigation camera controller */}
          <NavigationCameraController
            navManager={navManagerRef}
            cameraManager={cameraManagerRef}
            onCameraUpdate={handleCameraUpdate}
          />
        </MapContainer>
      </div>
    </>
  )
}
