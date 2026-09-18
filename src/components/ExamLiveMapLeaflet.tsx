import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import { MAP_TILES } from '@/lib/map-tiles'
import { YANDEX_STREET_ZOOM } from '@/data/telavi-routes'
import type { PinRow, RouteWithPins } from '@/types/database'

const USER_SCREEN_Y = 0.5 // GPS marker in center

function createNavArrowIcon(counterHeading: number) {
  return L.divIcon({
    className: 'nav-arrow-marker',
    html: `<div class="nav-arrow-wrap" style="transform:rotate(${counterHeading}deg)"><div class="nav-arrow"></div><div class="nav-arrow-dot"></div></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 22],
  })
}

function resetMapRotation(map: L.Map) {
  const pane = map.getPane('mapPane')
  if (!pane) return
  pane.style.transform = ''
  pane.style.transformOrigin = ''
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
}: {
  position: LatLng
  heading: number
  followPaused: boolean
  onRecenter?: () => void
}) {
  const map = useMap()
  const headingRef = useRef(heading)
  const hasInitialized = useRef(false)
  const forceCenterRef = useRef(false)

  useEffect(() => {
    headingRef.current = heading
  }, [heading])

  // Expose recenter function
  useEffect(() => {
    if (onRecenter) {
      (window as any).__mapRecenter = () => {
        forceCenterRef.current = true
        const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
        map.setView(position, zoom, { animate: false })
        // Block ALL pan logic for 500ms after recenter
        setTimeout(() => {
          forceCenterRef.current = false
        }, 500)
      }
    }
    return () => {
      delete (window as any).__mapRecenter
    }
  }, [map, position, onRecenter])

  useEffect(() => {
    if (followPaused && !forceCenterRef.current) {
      resetMapRotation(map)
      return
    }

    // Initialize zoom only once
    if (!hasInitialized.current || forceCenterRef.current) {
      const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
      map.setView(position, zoom, { animate: false })
      hasInitialized.current = true
      
      // If force centering, skip pan logic entirely
      if (forceCenterRef.current) {
        const applyRotation = () => {
          const pane = map.getPane('mapPane')
          if (!pane) return
          const anchor = map.latLngToContainerPoint(position)
          pane.style.transformOrigin = `${anchor.x}px ${anchor.y}px`
          pane.style.transform = `rotate(${-headingRef.current}deg)`
        }
        applyRotation()
        return // Exit early - no pan logic
      }
    } else {
      // After initialization, ONLY pan - NEVER call setView
      // This keeps the marker perfectly centered without jumping
      const currentCenter = map.getCenter()
      const distance = map.distance(currentCenter, position)
      
      // Only pan if position changed significantly (> 0.5 meters)
      if (distance > 0.5) {
        map.panTo(position, { animate: false, noMoveStart: true, duration: 0 })
      }
    }

    const applyRotation = () => {
      const pane = map.getPane('mapPane')
      if (!pane) return
      const anchor = map.latLngToContainerPoint(position)
      pane.style.transformOrigin = `${anchor.x}px ${anchor.y}px`
      pane.style.transform = `rotate(${-headingRef.current}deg)`
    }

    applyRotation()
    map.on('move', applyRotation)
    map.on('moveend', applyRotation)
    return () => {
      map.off('move', applyRotation)
      map.off('moveend', applyRotation)
    }
  }, [map, position, followPaused])

  useEffect(() => () => resetMapRotation(map), [map])

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
  const navArrowIcon = useMemo(() => createNavArrowIcon(heading), [heading])
  const pins = route.pins // Get pins from route

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

        <Marker position={userPos} icon={navArrowIcon} zIndexOffset={1000} />

        <MapFollowPause onPause={() => setFollowPaused(true)} />
        <DrivingCamera position={userPos} heading={heading} followPaused={followPaused} onRecenter={handleRecenter} />
      </MapContainer>
    </div>
  )
}
