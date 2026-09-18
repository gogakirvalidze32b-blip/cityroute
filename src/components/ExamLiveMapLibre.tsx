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
  const userMarker = useRef<maplibregl.Marker | null>(null)
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
      pitch: 0,
      bearing: 0,
      attributionControl: false,
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

  // Add user marker with arrow
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    // Create custom arrow element
    const el = document.createElement('div')
    el.className = 'maptiler-user-marker'
    el.innerHTML = `
      <div class="nav-arrow-wrap" style="transform: rotate(${heading}deg); will-change: transform;">
        <div class="nav-arrow"></div>
        <div class="nav-arrow-dot"></div>
      </div>
    `

    if (userMarker.current) {
      userMarker.current.remove()
    }

    userMarker.current = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([userPos[1], userPos[0]])
      .addTo(map.current)

    return () => {
      userMarker.current?.remove()
    }
  }, [mapLoaded, userPos, heading])

  // Update camera to follow user
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    map.current.easeTo({
      center: [userPos[1], userPos[0]],
      bearing: -heading,
      duration: 0,
      easing: (t) => t,
    })
  }, [mapLoaded, userPos, heading])

  // Add pins
  useEffect(() => {
    if (!map.current || !mapLoaded) return

    // Remove existing pin markers
    const existingMarkers = document.querySelectorAll('.maptiler-pin-marker')
    existingMarkers.forEach((marker) => marker.remove())

    pins.forEach((pin) => {
      const isNext = nextPin?.id === pin.id
      const isPulse = isNext && nextPinPulse

      const el = document.createElement('div')
      el.className = 'maptiler-pin-marker'
      el.style.width = isPulse ? '40px' : '28px'
      el.style.height = isPulse ? '40px' : '28px'
      el.style.borderRadius = '50%'
      el.style.backgroundColor = isNext ? '#5eead4' : '#10b981'
      el.style.border = `${isPulse ? 3 : 2}px solid ${isNext ? '#0d9488' : '#047857'}`
      el.style.opacity = isPulse ? '0.9' : '1'
      el.style.transition = 'all 0.3s ease'

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
