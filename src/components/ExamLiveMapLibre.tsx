import React, { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import type { PinRow, RouteWithPins } from '@/types/database'

const MAPTILER_API_KEY = import.meta.env.VITE_MAPTILER_API_KEY || 'DEMO_KEY'

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

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: `https://api.maptiler.com/maps/streets/style.json?key=${MAPTILER_API_KEY}`,
      center: [userPos[1], userPos[0]],
      zoom: 17,
      pitch: 0,
      bearing: 0,
      attributionControl: false,
    })

    map.current.on('load', () => {
      setMapLoaded(true)
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
