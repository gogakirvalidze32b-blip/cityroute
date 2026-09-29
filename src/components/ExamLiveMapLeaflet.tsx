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
// GOOGLE MAPS-STYLE NAVIGATION SYSTEM - CAMERA FIX
// ============================================================================
//
// ARCHITECTURE:
// 1. NavigationStateManager - Single source of truth for GPS/route state
// 2. CameraStateManager - Separate camera state (FOLLOW vs FREE mode)
// 3. Fixed arrow overlay - Never moves X/Y, only rotates
// 4. Map camera - Moves underneath fixed arrow
//
// CRITICAL FIXES:
// - GPS timestamps prevent old callbacks from corrupting state
// - Route progress is monotonic (never moves backward)
// - Camera state is separate from GPS state
// - FREE mode lets user inspect map without GPS interference
// - Dragging ALWAYS enabled, triggers FREE mode immediately
// - GPS cannot move camera in FREE mode (uses ref to avoid stale closures)
// - Animation loop stops fighting user in FREE mode
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
 * FREE MODE: Camera controlled by user - GPS MUST NOT INTERFERE
 * 
 * CRITICAL: Uses refs to avoid stale closures
 */
function NavigationCameraController({
  navManager,
  cameraManager,
  cameraModeRef,
  onCameraUpdate,
}: {
  navManager: React.MutableRefObject<NavigationStateManager | null>
  cameraManager: React.MutableRefObject<CameraStateManager>
  cameraModeRef: React.MutableRefObject<CameraMode>
  onCameraUpdate: (position: LatLng, heading: number) => void
}) {
  const map = useMap()
  const rafRef = useRef<number | undefined>(undefined)
  const hasInitialized = useRef(false)
  const currentDisplayPosition = useRef<LatLng | null>(null)
  const currentDisplayHeading = useRef(0)
  
  // Animation loop for smooth camera movement
  useEffect(() => {
    const animate = () => {
      const navState = navManager.current?.getState()
      
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
      
      // ============================================================
      // CRITICAL: Check CURRENT camera mode via ref (not stale closure)
      // ============================================================
      const currentMode = cameraModeRef.current
      
      if (currentMode === 'FOLLOW') {
        // FOLLOW MODE: GPS controls camera
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
      } else {
        // FREE MODE: User controls camera
        // GPS MUST NOT move camera
        // Only update heading for arrow rotation
        currentDisplayHeading.current = lerpAngle(
          currentDisplayHeading.current,
          navState.heading,
          0.1
        )
        
        // Keep current display position from map center
        currentDisplayPosition.current = [map.getCenter().lat, map.getCenter().lng]
        
        // Notify parent of heading update only
        onCameraUpdate(currentDisplayPosition.current, currentDisplayHeading.current)
      }
      
      rafRef.current = requestAnimationFrame(animate)
    }
    
    rafRef.current = requestAnimationFrame(animate)
    
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [map, navManager, cameraManager, cameraModeRef, onCameraUpdate])
  
  return null
}

/**
 * Interaction Handler
 * CRITICAL FIX: Dragging must ALWAYS be enabled
 * Drag immediately triggers FREE camera mode
 * Zoom does NOT trigger mode change
 */
function InteractionHandler({
  cameraModeRef,
  onEnterFreeMode,
}: {
  cameraModeRef: React.MutableRefObject<CameraMode>
  onEnterFreeMode: () => void
}) {
  const map = useMap()
  
  // ALWAYS enable all interactions
  useEffect(() => {
    map.dragging.enable() // ← CRITICAL: Must ALWAYS be enabled
    map.touchZoom.enable()
    map.scrollWheelZoom.enable()
    map.doubleClickZoom.enable()
    map.boxZoom.enable()
    map.keyboard.enable()
  }, [map])
  
  // Drag triggers FREE mode immediately
  useMapEvents({
    dragstart: () => {
      // Use ref to avoid stale closure
      if (cameraModeRef.current === 'FOLLOW') {
        console.log('[CAMERA] User dragged map → FREE mode')
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
  
  // CRITICAL: Use ref to avoid stale closures in callbacks
  const cameraModeRef = useRef<CameraMode>('FOLLOW')
  
  const navManagerRef = useRef<NavigationStateManager | null>(null)
  const cameraManagerRef = useRef<CameraStateManager>(new CameraStateManager())
  
  const pins = route.pins
  const polyline = route.polyline as LatLng[]
  
  // ============================================================================
  // DEBUG: Runtime pin verification
  // ============================================================================
  useEffect(() => {
    console.log('═══════════════════════════════════════════════════')
    console.log('[DEBUG] ExamLiveMapLeaflet - Route Data:')
    console.log('  Route ID:', route.id)
    console.log('  Route Name:', route.name_ka)
    console.log('  Route Slug:', route.slug)
    console.log('  Pins Length:', pins.length)
    console.log('  Polyline Length:', polyline.length)
    
    if (pins.length > 0) {
      console.log('  First Pin:', {
        id: pins[0].id,
        lat: pins[0].lat,
        lng: pins[0].lng,
        instruction: pins[0].instruction_ka
      })
      console.log('  Last Pin:', {
        id: pins[pins.length - 1].id,
        lat: pins[pins.length - 1].lat,
        lng: pins[pins.length - 1].lng,
        instruction: pins[pins.length - 1].instruction_ka
      })
    } else {
      console.log('  ⚠️ NO PINS FOUND!')
    }
    console.log('═══════════════════════════════════════════════════')
  }, [route.id, route.name_ka, route.slug, pins.length, pins, polyline.length])
  
  // Sync ref with state
  useEffect(() => {
    cameraModeRef.current = cameraMode
  }, [cameraMode])
  
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
    
    navManagerRef.current.processGpsUpdate(gpsUpdate)
  }, [userPos, heading])
  
  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  // Visual pulse starts at 30m, audio triggers at 5m (in ExamDriveSession)
  const VISUAL_WARNING_DISTANCE_M = 30
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= VISUAL_WARNING_DISTANCE_M
  
  const handleRecenter = useCallback(() => {
    const navState = navManagerRef.current?.getState()
    if (!navState) return
    
    console.log('[CAMERA] Red button pressed → FOLLOW mode, recentering to current vehicle')
    
    // Switch to FOLLOW mode
    setCameraMode('FOLLOW')
    cameraManagerRef.current.setMode('FOLLOW')
    cameraManagerRef.current.recenter(navState.snappedPosition, navState.heading)
  }, [])
  
  const handleEnterFreeMode = useCallback(() => {
    console.log('[CAMERA] User dragged → FREE mode (GPS will not control camera)')
    setCameraMode('FREE')
    cameraManagerRef.current.setMode('FREE')
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

          {/* All pins - visual markers only */}
          {(() => {
            console.log('[DEBUG] pins.map() executing, pins.length =', pins.length)
            return pins.map((pin) => {
              const isNext = nextPin?.id === pin.id
              const isPulse = isNext && nextPinPulse
              return (
                <React.Fragment key={pin.id}>
                  {/* Green pin marker - 25% larger for better mobile visibility */}
                  <CircleMarker
                    center={[pin.lat, pin.lng]}
                    radius={isPulse ? 18 : 13}
                    pathOptions={{
                      color: isNext ? '#0f766e' : '#047857',
                      fillColor: isNext ? '#5eead4' : '#10b981',
                      fillOpacity: 1,
                      weight: 3,
                      className: isPulse ? 'exam-pin-pulse' : undefined,
                    }}
                  />
                </React.Fragment>
              )
            })
          })()}

          {/* Interaction handler */}
          <InteractionHandler 
            cameraModeRef={cameraModeRef}
            onEnterFreeMode={handleEnterFreeMode}
          />
          
          {/* Navigation camera controller */}
          <NavigationCameraController
            navManager={navManagerRef}
            cameraManager={cameraManagerRef}
            cameraModeRef={cameraModeRef}
            onCameraUpdate={handleCameraUpdate}
          />
        </MapContainer>
      </div>
    </>
  )
}
