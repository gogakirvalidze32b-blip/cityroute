import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { CircleMarker, MapContainer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { RoutePolyline } from '@/components/RoutePolyline'
import { examRouteLine } from '@/lib/pin-route-line'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import { MAP_TILES } from '@/lib/map-tiles'
import { YANDEX_STREET_ZOOM } from '@/data/telavi-routes'
import type { PinRow, RouteWithPins } from '@/types/database'
import { mapRotationCssDeg } from '@/lib/map-rotation'
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
  courseRef,
  worldRef,
}: {
  navManager: React.MutableRefObject<NavigationStateManager | null>
  cameraManager: React.MutableRefObject<CameraStateManager>
  cameraModeRef: React.MutableRefObject<CameraMode>
  courseRef: React.MutableRefObject<number>
  worldRef: React.MutableRefObject<HTMLDivElement | null>
}) {
  const map = useMap()
  const rafRef = useRef<number | undefined>(undefined)
  const hasInitialized = useRef(false)
  const currentDisplayPosition = useRef<LatLng | null>(null)
  const currentDisplayHeading = useRef(0)
  const wasFree = useRef(false)

  useEffect(() => {
    const applyBearing = (headingDeg: number) => {
      const el = worldRef.current
      if (!el) return
      // Rotate the whole Leaflet stack together — never mapPane.style.transform.
      el.style.transform = `rotate(${mapRotationCssDeg(headingDeg)}deg)`
    }

    const animate = () => {
      const navState = navManager.current?.getState()

      if (!navState) {
        rafRef.current = requestAnimationFrame(animate)
        return
      }

      // Camera follows the REAL GPS position (camera only; PIN detection is unchanged and
      // uses the raw GPS in ExamDriveSession). The route-snapped position is not used here.
      const cameraPosition = navState.rawPosition

      if (!hasInitialized.current) {
        map.setView(cameraPosition, YANDEX_STREET_ZOOM, { animate: false })
        currentDisplayPosition.current = cameraPosition
        currentDisplayHeading.current = courseRef.current
        applyBearing(currentDisplayHeading.current)
        hasInitialized.current = true
      }

      cameraManager.current.updateTarget(cameraPosition, courseRef.current)

      const currentMode = cameraModeRef.current

      if (currentMode === 'FOLLOW') {
        if (wasFree.current) {
          // Coming back from FREE (north-up): resume heading-up without sweeping from 0°.
          wasFree.current = false
          currentDisplayHeading.current = courseRef.current
          applyBearing(currentDisplayHeading.current)
        }
        const targetPosition = cameraPosition

        if (currentDisplayPosition.current) {
          const [currentLat, currentLng] = currentDisplayPosition.current
          const [targetLat, targetLng] = targetPosition
          const smoothFactor = 0.15
          currentDisplayPosition.current = [
            currentLat + (targetLat - currentLat) * smoothFactor,
            currentLng + (targetLng - currentLng) * smoothFactor,
          ]
          map.panTo(currentDisplayPosition.current, {
            animate: false,
            noMoveStart: true,
            duration: 0,
          })
        }

        currentDisplayHeading.current = lerpAngle(
          currentDisplayHeading.current,
          courseRef.current,
          0.1,
        )
        applyBearing(currentDisplayHeading.current)
        cameraManager.current.updateCurrent(
          currentDisplayPosition.current || cameraPosition,
          currentDisplayHeading.current,
        )
      } else {
        // FREE: keep the container unrotated so finger-drag direction matches the screen.
        if (!wasFree.current) {
          wasFree.current = true
          currentDisplayHeading.current = 0
        }
        applyBearing(0)
        currentDisplayPosition.current = [map.getCenter().lat, map.getCenter().lng]
        cameraManager.current.updateCurrent(
          currentDisplayPosition.current,
          currentDisplayHeading.current,
        )
      }

      rafRef.current = requestAnimationFrame(animate)
    }

    rafRef.current = requestAnimationFrame(animate)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [map, navManager, cameraManager, cameraModeRef, courseRef, worldRef])

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
  const cameraModeRef = useRef<CameraMode>('FOLLOW')
  const navManagerRef = useRef<NavigationStateManager | null>(null)
  const cameraManagerRef = useRef<CameraStateManager>(new CameraStateManager())
  const courseRef = useRef(heading)
  const worldRef = useRef<HTMLDivElement | null>(null)

  // GPS movement course from parent (resolveHeading) — map bearing source
  useEffect(() => {
    courseRef.current = heading
  }, [heading])

  const pins = route.pins
  const polyline = route.polyline as LatLng[]
  const pinLine = useMemo(() => examRouteLine(route.slug, pins), [route.slug, pins])
  
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
    cameraManagerRef.current.recenter(navState.snappedPosition, courseRef.current)
    const el = worldRef.current
    if (el) el.style.transform = `rotate(${mapRotationCssDeg(courseRef.current)}deg)`
  }, [])
  
  const handleEnterFreeMode = useCallback(() => {
    console.log('[CAMERA] User dragged → FREE mode (GPS will not control camera)')
    // Un-rotate synchronously, before Leaflet applies the first drag offset.
    if (worldRef.current) worldRef.current.style.transform = 'rotate(0deg)'
    setCameraMode('FREE')
    cameraManagerRef.current.setMode('FREE')
  }, [])

  return (
    <div className="exam-live-map">
      {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}

      <button
        type="button"
        className={`map-recenter-btn exam-live-map__recenter ${cameraMode === 'FREE' ? 'map-recenter-btn--active' : ''}`}
        onClick={handleRecenter}
        title="ცენტრში დაბრუნება"
      >
        {cameraMode === 'FOLLOW' ? '🎯' : '📍'}
      </button>

      {nextPin && (
        <div className="exam-live-map__hud">
          <small>შემდეგი · {nextPinDist} მ</small>
          <strong>{nextPin.instruction_ka}</strong>
        </div>
      )}

      <div className="exam-live-map__world" ref={worldRef}>
        <MapContainer
          center={userPos}
          zoom={YANDEX_STREET_ZOOM}
          className="exam-live-map__canvas"
          zoomControl={false}
          attributionControl={false}
          touchZoom="center"
          scrollWheelZoom="center"
          doubleClickZoom="center"
        >
          <MapSizeFix />
          <MapBasemapLayers tiles={MAP_TILES} detectRetina />

          <RoutePolyline positions={pinLine} variant="pins" />

          {pins.map((pin) => {
            const isNext = nextPin?.id === pin.id
            const isPulse = isNext && nextPinPulse
            return (
              <CircleMarker
                key={pin.id}
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
            )
          })}

          <InteractionHandler cameraModeRef={cameraModeRef} onEnterFreeMode={handleEnterFreeMode} />

          <NavigationCameraController
            navManager={navManagerRef}
            cameraManager={cameraManagerRef}
            cameraModeRef={cameraModeRef}
            courseRef={courseRef}
            worldRef={worldRef}
          />
        </MapContainer>
      </div>

      {/* Fixed overlay: chevron points UP. Map rotates underneath. Anchor stays at the map centre. */}
      <div className="fixed-navigation-arrow-overlay">
        <div className="fixed-navigation-arrow-rotator">
          <svg className="fixed-navigation-arrow-icon" viewBox="0 0 64 72" aria-hidden="true">
            <path
              d="M32 3.5 L58 64.5 C42.5 50.5 21.5 50.5 6 64.5 Z"
              fill="#1a73e8"
              stroke="#ffffff"
              strokeWidth="4.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <div className="fixed-navigation-arrow-dot"></div>
        </div>
      </div>
    </div>
  )
}
