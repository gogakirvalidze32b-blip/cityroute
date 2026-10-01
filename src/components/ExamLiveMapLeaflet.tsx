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
// GOOGLE MAPS-STYLE NAVIGATION SYSTEM - CAMERA FIX + COMPASS ARROW
// ============================================================================
//
// ARCHITECTURE:
// 1. NavigationStateManager - Single source of truth for GPS/route state
// 2. CameraStateManager - Separate camera state (FOLLOW vs FREE mode)
// 3. Fixed arrow overlay - Never moves X/Y, rotates with device compass
// 4. Map camera - Moves underneath fixed arrow
//
// COMPASS INTEGRATION:
// - DeviceOrientation API reads device compass heading
// - Arrow rotates based on compass (not GPS heading)
// - Works when stationary and moving
// - Fallback to GPS heading if compass unavailable
// - iOS requires permission, Android works directly
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
 * Device Compass Hook
 * Returns compass heading from DeviceOrientation API
 * 0° = North, 90° = East, 180° = South, 270° = West
 */
function useDeviceCompass(): number | null {
  const [compassHeading, setCompassHeading] = useState<number | null>(null)
  const [permissionGranted, setPermissionGranted] = useState(false)
  const lastHeadingRef = useRef<number | null>(null)

  useEffect(() => {
    let mounted = true

    const requestPermission = async () => {
      console.log('[COMPASS DEBUG] 🔍 Starting permission check...')
      console.log('[COMPASS DEBUG] DeviceOrientationEvent available:', typeof DeviceOrientationEvent !== 'undefined')
      console.log('[COMPASS DEBUG] requestPermission function exists:', typeof (DeviceOrientationEvent as any).requestPermission === 'function')
      
      // iOS 13+ requires permission
      if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
        console.log('[COMPASS DEBUG] iOS detected - requesting permission...')
        try {
          const permission = await (DeviceOrientationEvent as any).requestPermission()
          console.log('[COMPASS DEBUG] iOS permission result:', permission)
          if (permission === 'granted' && mounted) {
            console.log('[COMPASS DEBUG] ✅ iOS permission GRANTED')
            setPermissionGranted(true)
          }
        } catch (err) {
          console.warn('[COMPASS] Permission denied:', err)
        }
      } else {
        // Android and older iOS - no permission needed
        console.log('[COMPASS DEBUG] ✅ Android/older iOS - no permission needed')
        setPermissionGranted(true)
      }
    }

    void requestPermission()

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!permissionGranted) {
      console.log('[COMPASS DEBUG] ❌ Permission not granted yet, waiting...')
      return
    }

    console.log('[COMPASS DEBUG] 🎯 Setting up deviceorientation listener...')
    let eventCount = 0

    const handleOrientation = (event: DeviceOrientationEvent) => {
      eventCount++
      
      // Log first 5 events for debugging
      if (eventCount <= 5) {
        console.log(`[COMPASS DEBUG] 📡 Event #${eventCount} received:`, {
          alpha: event.alpha,
          beta: event.beta,
          gamma: event.gamma,
          absolute: event.absolute,
          webkitCompassHeading: (event as any).webkitCompassHeading,
        })
      }

      let heading: number | null = null

      // Try webkitCompassHeading first (iOS)
      if (typeof (event as any).webkitCompassHeading === 'number') {
        heading = (event as any).webkitCompassHeading
        if (eventCount <= 5) console.log('[COMPASS DEBUG] 🍎 Using webkitCompassHeading (iOS):', heading)
      }
      // Try alpha with absolute reference (Android)
      else if (event.absolute && typeof event.alpha === 'number') {
        // alpha: 0° = North, increases clockwise
        heading = event.alpha
        if (eventCount <= 5) console.log('[COMPASS DEBUG] 🤖 Using alpha with absolute=true (Android):', heading)
      }
      // Fallback to alpha without absolute (less reliable)
      else if (typeof event.alpha === 'number') {
        heading = event.alpha
        if (eventCount <= 5) console.log('[COMPASS DEBUG] ⚠️ Using alpha WITHOUT absolute (unreliable):', heading)
      }

      if (heading !== null && !Number.isNaN(heading)) {
        // Normalize to 0-360
        heading = ((heading % 360) + 360) % 360
        lastHeadingRef.current = heading
        setCompassHeading(heading)
        
        if (eventCount <= 5) {
          console.log('[COMPASS DEBUG] ✅ Compass heading set:', heading.toFixed(1) + '°')
        }
      } else {
        if (eventCount <= 5) {
          console.log('[COMPASS DEBUG] ❌ No valid heading found in event')
        }
      }
    }

    window.addEventListener('deviceorientation', handleOrientation, true)
    console.log('[COMPASS DEBUG] ✅ Listener added')
    
    return () => {
      console.log('[COMPASS DEBUG] 🛑 Removing listener')
      window.removeEventListener('deviceorientation', handleOrientation, true)
    }
  }, [permissionGranted])

  return compassHeading
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
        // Start camera at SNAPPED position (keeps vehicle on route)
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
        // CRITICAL: Use SNAPPED position for camera to keep vehicle on route
        // This prevents visual drift when GPS is inaccurate
        const targetPosition = navState.snappedPosition // ← Snapped to route!
        
        // Smooth position interpolation
        if (currentDisplayPosition.current) {
          const [currentLat, currentLng] = currentDisplayPosition.current
          const [targetLat, targetLng] = targetPosition
          
          // Interpolate position (smooth factor 0.15 = ~6-7 frames to reach target)
          const smoothFactor = 0.15
          const newLat = currentLat + (targetLat - currentLat) * smoothFactor
          const newLng = currentLng + (targetLng - currentLng) * smoothFactor
          
          currentDisplayPosition.current = [newLat, newLng]
          
          // Move map camera to RAW position
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
  
  // ============================================================================
  // COMPASS HEADING - Device orientation for arrow rotation
  // ============================================================================
  const compassHeading = useDeviceCompass()
  const [arrowRotation, setArrowRotation] = useState(heading + 180)
  const lastArrowRotation = useRef(heading + 180)
  
  // Update arrow rotation with compass or fallback to GPS heading
  useEffect(() => {
    const targetHeading = compassHeading !== null ? compassHeading : displayHeading
    const targetRotation = targetHeading + 180 // +180° offset: CSS arrow points DOWN
    
    console.log('[ARROW DEBUG] 🧭 Arrow rotation update:', {
      compassHeading: compassHeading !== null ? compassHeading.toFixed(1) + '°' : 'null',
      displayHeading: displayHeading.toFixed(1) + '°',
      targetHeading: targetHeading.toFixed(1) + '°',
      targetRotation: targetRotation.toFixed(1) + '°',
      currentArrowRotation: lastArrowRotation.current.toFixed(1) + '°',
    })
    
    // Smooth rotation using lerpAngle to avoid 359°→0° jumps
    const smoothRotation = lerpAngle(lastArrowRotation.current, targetRotation, 0.15)
    lastArrowRotation.current = smoothRotation
    setArrowRotation(smoothRotation)
    
    console.log('[ARROW DEBUG] ✅ New arrow rotation:', smoothRotation.toFixed(1) + '°')
  }, [compassHeading, displayHeading])
  
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
          - Only rotates based on device compass heading
          - Compass heading used when available
          - Falls back to GPS heading when compass unavailable
          - +180° offset: CSS arrow points DOWN, compass 0° = NORTH
          - Smooth rotation prevents 359°→0° jumps
          - Represents device physical orientation */}
      <div className="fixed-navigation-arrow-overlay">
        <div className="fixed-navigation-arrow-rotator" style={{ transform: `rotate(${arrowRotation}deg)` }}>
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
