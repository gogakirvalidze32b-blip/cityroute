import React, { useEffect, useRef, useState, useCallback } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import type { PinRow, RouteWithPins } from '@/types/database'
import { NavigationStateManager, CameraStateManager, type CameraMode, type RawGpsUpdate } from '@/lib/navigation-state'

const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY || 'get_your_own_OpIi9ZULNHzrESv6T2vL'

// MapTiler styles - compatible with MapLibre
const MAP_STYLES = {
  streets: 'streets',      // Default OpenStreetMap style
  basic: 'basic',          // Minimalist, Google-like
  bright: 'bright',        // Light, clean - MOST Google Maps-like! ✅
  satellite: 'satellite',  // Satellite imagery
  hybrid: 'hybrid',        // Satellite + roads overlay
  outdoor: 'outdoor',      // Nature, hiking
} as const

// Choose your style here:
const SELECTED_STYLE = 'bright' // ← MapTiler bright (Google Maps-like)

// Zoom level
const NAVIGATION_ZOOM = 17

// Get MapTiler style URL
const getMapStyle = () => {
  return `https://api.maptiler.com/maps/${SELECTED_STYLE}/style.json?key=${MAPTILER_API_KEY}`
}

type Props = {
  route: RouteWithPins
  userPos: LatLng
  heading: number
  nextPin: PinRow | null
  mapBadge?: string
}

export function ExamLiveMapLibre({ route, userPos, heading, nextPin, mapBadge }: Props) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [cameraMode, setCameraMode] = useState<CameraMode>('FOLLOW')
  
  // Navigation state management
  const navManagerRef = useRef<NavigationStateManager | null>(null)
  const cameraManagerRef = useRef<CameraStateManager>(new CameraStateManager())
  const cameraModeRef = useRef<CameraMode>('FOLLOW')
  
  // Animation frame
  const rafRef = useRef<number | null>(null)
  const hasInitialized = useRef(false)

  const pins = route.pins
  const polyline = route.polyline as LatLng[]
  
  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  // Visual pulse starts at 30m
  const VISUAL_WARNING_DISTANCE_M = 30
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= VISUAL_WARNING_DISTANCE_M
  
  // Sync ref with state
  useEffect(() => {
    cameraModeRef.current = cameraMode
  }, [cameraMode])
  
  // Initialize navigation manager
  useEffect(() => {
    navManagerRef.current = new NavigationStateManager(polyline)
  }, [polyline])
  
  // Process GPS updates
  useEffect(() => {
    if (!navManagerRef.current) return
    
    const gpsUpdate: RawGpsUpdate = {
      position: userPos,
      accuracy: 20,
      speed: null,
      heading: heading,
      timestamp: Date.now(),
    }
    
    navManagerRef.current.processGpsUpdate(gpsUpdate)
  }, [userPos, heading])

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    console.log('🗺️ MapLibre: Initializing with Google Maps Navigation style')
    console.log('🗺️ MapTiler Style:', SELECTED_STYLE)
    console.log('🗺️ Style URL:', getMapStyle())

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: getMapStyle(),
      center: [userPos[1], userPos[0]],
      zoom: NAVIGATION_ZOOM,
      pitch: 0, // Keep flat for driving
      bearing: 0, // Will be updated by animation loop
      attributionControl: false,
      // Performance optimizations
      maxTileCacheSize: 100,
      renderWorldCopies: false,
    })

    map.current.on('load', () => {
      console.log('✅ MapLibre: Map loaded successfully!')
      
      // DIAGNOSTIC LOGGING - TEMPORARY
      const container = mapContainer.current
      const mapElement = map.current?.getContainer()
      const canvas = map.current?.getCanvas()
      
      console.log('📏 DIAGNOSTICS:')
      console.log('  Container rect:', container?.getBoundingClientRect())
      console.log('  Map element rect:', mapElement?.getBoundingClientRect())
      console.log('  Canvas rect:', canvas?.getBoundingClientRect())
      console.log('  Canvas dimensions:', canvas?.width, 'x', canvas?.height)
      console.log('  Style loaded:', map.current?.isStyleLoaded())
      console.log('  Map loaded:', map.current?.loaded())
      
      setMapLoaded(true)
    })

    map.current.on('error', (e) => {
      console.error('❌ MapLibre Error (FULL):', e)
      console.error('  Error type:', e.error?.constructor?.name)
      console.error('  Error message:', e.error?.message)
      console.error('  Error stack:', e.error?.stack)
    })
    
    // Drag detection → FREE mode
    map.current.on('dragstart', () => {
      if (cameraModeRef.current === 'FOLLOW') {
        console.log('[CAMERA] User dragged map → FREE mode')
        setCameraMode('FREE')
        cameraManagerRef.current.setMode('FREE')
      }
    })

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      map.current?.remove()
      map.current = null
    }
  }, [])
  
  // Camera animation loop - Google Maps Navigation style
  useEffect(() => {
    if (!map.current || !mapLoaded) return
    
    const animate = () => {
      const navState = navManagerRef.current?.getState()
      
      if (!navState) {
        rafRef.current = requestAnimationFrame(animate)
        return
      }
      
      // Initialize
      if (!hasInitialized.current) {
        map.current!.jumpTo({
          center: [navState.rawPosition[1], navState.rawPosition[0]],
          bearing: -navState.heading,
          zoom: NAVIGATION_ZOOM
        })
        hasInitialized.current = true
      }
      
      // Update camera target
      cameraManagerRef.current.updateTarget(navState.rawPosition, navState.heading)
      
      const currentMode = cameraModeRef.current
      
      if (currentMode === 'FOLLOW') {
        // FOLLOW MODE: GPS controls camera
        // Google Maps Navigation style: map rotates, vehicle stays centered
        map.current!.easeTo({
          center: [navState.rawPosition[1], navState.rawPosition[0]],  // RAW GPS
          bearing: -navState.heading,  // Rotate map (negative for north-up vehicle)
          zoom: NAVIGATION_ZOOM,
          duration: 200,
          easing: (t) => t  // Linear
        })
      }
      // FREE MODE: User controls camera, GPS does not interfere
      
      rafRef.current = requestAnimationFrame(animate)
    }
    
    rafRef.current = requestAnimationFrame(animate)
    
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [mapLoaded])

  // Add pins
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    // Remove existing pin markers
    const existingMarkers = document.querySelectorAll('.maplibre-pin-marker')
    existingMarkers.forEach((marker) => marker.remove())

    pins.forEach((pin) => {
      const isNext = nextPin?.id === pin.id
      const isPulse = isNext && nextPinPulse

      const el = document.createElement('div')
      el.className = 'maplibre-pin-marker'
      el.style.width = isPulse ? '42px' : '32px'
      el.style.height = isPulse ? '42px' : '32px'
      el.style.borderRadius = '50%'
      el.style.backgroundColor = isNext ? '#5eead4' : '#10b981'
      el.style.border = `${isPulse ? 3 : 3}px solid ${isNext ? '#0d9488' : '#047857'}`
      el.style.opacity = isPulse ? '0.9' : '1'
      el.style.transition = 'all 0.3s ease'
      el.style.boxShadow = isPulse ? '0 0 20px rgba(94, 234, 212, 0.6)' : 'none'

      new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map.current!)
    })
  }, [mapLoaded, pins, nextPin, nextPinPulse])

  const handleRecenter = useCallback(() => {
    const navState = navManagerRef.current?.getState()
    if (!navState || !map.current) return
    
    console.log('[CAMERA] Recenter button → FOLLOW mode')
    
    setCameraMode('FOLLOW')
    cameraManagerRef.current.setMode('FOLLOW')
    cameraManagerRef.current.recenter(navState.rawPosition, navState.heading)
    
    // Immediate recenter
    map.current.easeTo({
      center: [navState.rawPosition[1], navState.rawPosition[0]],
      bearing: -navState.heading,
      zoom: NAVIGATION_ZOOM,
      duration: 300
    })
  }, [])

  return (
    <div className="exam-live-map">
      {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}

      {/* Fixed center arrow overlay - NEVER moves, map rotates underneath
          Google Maps Navigation style: vehicle fixed, world rotates */}
      <div className="fixed-navigation-arrow-overlay">
        <div className="fixed-navigation-arrow-rotator">
          <div className="fixed-navigation-arrow-icon"></div>
          <div className="fixed-navigation-arrow-dot"></div>
        </div>
      </div>

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

      <div ref={mapContainer} className="exam-live-map__canvas" />
    </div>
  )
}

