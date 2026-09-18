import React, { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import type { PinRow, RouteWithPins } from '@/types/database'

const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY || 'get_your_own_OpIi9ZULNHzrESv6T2vL'
const MAPBOX_API_KEY = import.meta.env.VITE_MAPBOX_API_KEY || 'pk.eyJ1IjoiZHJ1bXN0aWNrIiwiYSI6ImNtdTdlMWM1dTBrMmMyeHNsZjdiOGtkaW4ifQ.W_M3-S-HKDgKsVIigf6Zjg'

// Map provider - switch between 'mapbox' or 'maptiler'
const MAP_PROVIDER = 'mapbox' as const

// MapTiler styles (for reference, not used with Mapbox)
const MAP_STYLES = {
  streets: 'streets',      // Default OpenStreetMap style
  basic: 'basic',          // Minimalist, Google-like
  bright: 'bright',        // Light, clean - MOST Google Maps-like! ✅
  satellite: 'satellite',  // Satellite imagery
  hybrid: 'hybrid',        // Satellite + roads overlay
  outdoor: 'outdoor',      // Nature, hiking
} as const

// Mapbox styles - vector tiles, 60fps rendering! 🚀
const MAPBOX_STYLES = {
  streets: 'mapbox://styles/mapbox/streets-v12',
  light: 'mapbox://styles/mapbox/light-v11',      // Google Maps-like ✅
  dark: 'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-v9',
  satelliteStreets: 'mapbox://styles/mapbox/satellite-streets-v12',
  outdoors: 'mapbox://styles/mapbox/outdoors-v12',
} as const

// Choose your style here:
const SELECTED_STYLE = 'light' // ← Mapbox light (Google Maps-like)

// Get map style URL based on provider
const getMapStyle = () => {
  if (MAP_PROVIDER === 'mapbox') {
    return MAPBOX_STYLES[SELECTED_STYLE as keyof typeof MAPBOX_STYLES] || MAPBOX_STYLES.light
  }
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

  const pins = route.pins
  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || map.current) return

    console.log('🗺️ Map Provider:', MAP_PROVIDER)
    console.log('🗺️ Mapbox Key:', MAPBOX_API_KEY ? 'EXISTS' : 'MISSING')
    console.log('🗺️ MapTiler Key:', MAPTILER_API_KEY ? 'EXISTS' : 'MISSING')
    console.log('🗺️ Selected Style:', SELECTED_STYLE)
    console.log('🗺️ Style URL:', getMapStyle())

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: getMapStyle(),
      accessToken: MAP_PROVIDER === 'mapbox' ? MAPBOX_API_KEY : undefined,
      center: [userPos[1], userPos[0]],
      zoom: 17,
      pitch: 0, // Keep flat for driving
      bearing: -heading, // Rotate map, not arrow
      attributionControl: false,
      // Performance optimizations
      maxTileCacheSize: 100,
      renderWorldCopies: false,
    })

    map.current.on('load', () => {
      console.log(`✅ ${MAP_PROVIDER === 'mapbox' ? 'Mapbox' : 'MapTiler'}: Map loaded successfully!`)
      setMapLoaded(true)
    })

    map.current.on('error', (e) => {
      console.error(`❌ ${MAP_PROVIDER === 'mapbox' ? 'Mapbox' : 'MapTiler'} Error:`, e)
    })

    return () => {
      map.current?.remove()
      map.current = null
    }
  }, [])

  // Update camera to follow user - smooth 60fps animation
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    // MapLibre handles smooth interpolation internally
    map.current.easeTo({
      center: [userPos[1], userPos[0]],
      bearing: -heading, // Rotate map to keep arrow pointing up
      duration: 200, // Smooth animation
      easing: (t) => t, // Linear easing
    })
  }, [mapLoaded, userPos, heading])

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
      el.style.width = isPulse ? '40px' : '28px'
      el.style.height = isPulse ? '40px' : '28px'
      el.style.borderRadius = '50%'
      el.style.backgroundColor = isNext ? '#5eead4' : '#10b981'
      el.style.border = `${isPulse ? 3 : 2}px solid ${isNext ? '#0d9488' : '#047857'}`
      el.style.opacity = isPulse ? '0.9' : '1'
      el.style.transition = 'all 0.3s ease'
      el.style.boxShadow = isPulse ? '0 0 20px rgba(94, 234, 212, 0.6)' : 'none'

      new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map.current!)
    })
  }, [mapLoaded, pins, nextPin, nextPinPulse])

  const handleRecenter = () => {
    if (!map.current || !mapLoaded) return
    map.current.easeTo({
      center: [userPos[1], userPos[0]],
      bearing: -heading,
      zoom: 17,
      duration: 300,
    })
  }

  return (
    <div className="exam-live-map">
      {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}

      {/* Fixed center arrow overlay - NEVER moves, always at screen center */}
      <div className="nav-arrow-overlay">
        <div className="nav-arrow-rotator">
          <div className="nav-arrow-fixed"></div>
          <div className="nav-arrow-dot-fixed"></div>
        </div>
      </div>

      <button
        type="button"
        className="map-recenter-btn exam-live-map__recenter"
        onClick={handleRecenter}
        title="ცენტრში დაბრუნება"
      >
        🎯
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
