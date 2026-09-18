import React, { useEffect, useMemo, useRef, useState } from 'react'
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

const USER_SCREEN_Y = 0.5 // GPS marker in center

// Arrow is now CSS overlay, no longer a Leaflet marker

function resetMapRotation(map: L.Map) {
  const pane = map.getPane('mapPane')
  if (!pane) return
  pane.style.transform = ''
  pane.style.transformOrigin = ''
  pane.style.willChange = ''
}

function MapSizeFix() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const id = window.setTimeout(() => map.invalidateSize(), 80)
    return () => window.clearTimeout(id)
  }, [map])
  return null
}

function DrivingCamera({
  position,
  heading,
  followPaused,
  onRecenter,
  polyline,
}: {
  position: LatLng
  heading: number
  followPaused: boolean
  onRecenter?: () => void
  polyline: LatLng[]
}) {
  const map = useMap()
  const interpolatorRef = useRef<GpsInterpolator | null>(null)
  const headingRef = useRef(heading)
  const hasInitialized = useRef(false)
  const forceCenterRef = useRef(false)
  const rafRef = useRef<number>()
  const currentPositionRef = useRef<LatLng>(position)

  // Initialize interpolator
  useEffect(() => {
    if (!interpolatorRef.current) {
      interpolatorRef.current = new GpsInterpolator()
      
      // Set up callback for interpolated updates
      interpolatorRef.current.setOnUpdate((state) => {
        if (followPaused && !forceCenterRef.current) return
        
        currentPositionRef.current = state.position
        headingRef.current = state.heading
        
        // Pan map to interpolated position
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          map.panTo(state.position, { animate: false, noMoveStart: true, duration: 0 })
          
          // Apply rotation
          const pane = map.getPane('mapPane')
          if (pane) {
            const anchor = map.latLngToContainerPoint(state.position)
            pane.style.transformOrigin = `${anchor.x}px ${anchor.y}px`
            pane.style.transform = `rotate(${-state.heading}deg)`
            pane.style.willChange = 'transform'
          }
        })
      })
    }

    return () => {
      interpolatorRef.current?.stop()
    }
  }, [map, followPaused])

  // Update interpolator when GPS position/heading changes
  useEffect(() => {
    if (!interpolatorRef.current) return
    
    // Snap position to route before interpolating
    const snappedPosition = snapToRoute(position, polyline, 50)
    
    const gpsState: GpsState = {
      position: snappedPosition,
      heading,
      speed: 0,
      timestamp: Date.now(),
    }
    
    interpolatorRef.current.updateTarget(gpsState)
  }, [position, heading, polyline])

  // Expose recenter function
  useEffect(() => {
    if (onRecenter) {
      (window as any).__mapRecenter = () => {
        forceCenterRef.current = true
        const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
        map.setView(currentPositionRef.current, zoom, { animate: false })
        
        // Block pan logic for 500ms after recenter
        setTimeout(() => {
          forceCenterRef.current = false
        }, 500)
      }
    }
    return () => {
      delete (window as any).__mapRecenter
    }
  }, [map, onRecenter])

  // Initialize zoom once
  useEffect(() => {
    if (!hasInitialized.current) {
      const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
      map.setView(position, zoom, { animate: false })
      
      // Increase padding to prevent black corners during rotation
      map.options.padding = [200, 200]
      
      hasInitialized.current = true
    }
  }, [map, position])

  // Handle follow pause
  useEffect(() => {
    if (followPaused && !forceCenterRef.current) {
      resetMapRotation(map)
      interpolatorRef.current?.stop()
    }
  }, [followPaused, map])

  useEffect(() => {
    return () => {
      resetMapRotation(map)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      interpolatorRef.current?.stop()
    }
  }, [map])

  return null
}

function MapFollowPause({ onPause }: { onPause: () => void }) {
  useMapEvents({
    dragstart: onPause,
    zoomstart: onPause,
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
  const [followPaused, setFollowPaused] = useState(false)
  const pins = route.pins // Get pins from route
  const polyline = route.polyline as LatLng[]

  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  // პინი იციმციმოს მხოლოდ როცა ძალიან ახლოს ხარ (trigger distance-ის ფარგლებში)
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m

  const handleRecenter = () => {
    // Force instant recenter
    if ((window as any).__mapRecenter) {
      (window as any).__mapRecenter()
    }
    // Resume following immediately after recenter
    setFollowPaused(false)
  }

  return (
    <div className="exam-live-map">
      {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}
      
      {/* Fixed center arrow overlay - CSS only, no Leaflet marker */}
      <div className="nav-arrow-overlay" style={{ transform: `rotate(${heading}deg)` }}>
        <div className="nav-arrow-fixed"></div>
        <div className="nav-arrow-dot-fixed"></div>
      </div>
      
      {/* Always show recenter button */}
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

      <MapContainer
        center={userPos}
        zoom={YANDEX_STREET_ZOOM}
        className="exam-live-map__canvas"
        zoomControl={false}
        attributionControl={false}
      >
        <MapSizeFix />
        <MapBasemapLayers tiles={MAP_TILES} detectRetina />

        {/* All pins - only center dot with pulse */}
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

        <MapFollowPause onPause={() => setFollowPaused(true)} />
        <DrivingCamera 
          position={userPos} 
          heading={heading} 
          followPaused={followPaused} 
          onRecenter={handleRecenter}
          polyline={polyline}
        />
      </MapContainer>
    </div>
  )
}
