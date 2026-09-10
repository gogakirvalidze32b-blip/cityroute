import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import { MAP_TILES } from '@/lib/map-tiles'
import { YANDEX_STREET_ZOOM } from '@/data/telavi-routes'
import type { PinRow, RouteWithPins } from '@/types/database'

const USER_SCREEN_Y = 0.74

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
}: {
  position: LatLng
  heading: number
  followPaused: boolean
}) {
  const map = useMap()
  const headingRef = useRef(heading)

  useEffect(() => {
    headingRef.current = heading
  }, [heading])

  useEffect(() => {
    if (followPaused) {
      resetMapRotation(map)
      return
    }

    const zoom = Math.max(map.getZoom(), YANDEX_STREET_ZOOM)
    const size = map.getSize()
    if (size.x === 0 || size.y === 0) {
      map.invalidateSize()
      return
    }

    const projected = map.project(position, zoom)
    projected.y += size.y * (0.5 - USER_SCREEN_Y)
    map.setView(map.unproject(projected, zoom), zoom, { animate: true, duration: 0.2 })

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

  const nextPinDist =
    nextPin != null ? Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng])) : null
  
  // პინი იციმციმოს მხოლოდ როცა ძალიან ახლოს ხარ (trigger distance-ის ფარგლებში)
  const nextPinPulse = nextPin != null && nextPinDist != null && nextPinDist <= nextPin.trigger_distance_m

  return (
    <div className="exam-live-map">
      {mapBadge && <span className="exam-live-map__badge">{mapBadge}</span>}
      {followPaused && (
        <button type="button" className="map-recenter-btn exam-live-map__recenter" onClick={() => setFollowPaused(false)}>
          ⊕ ცენტრში
        </button>
      )}

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

        {nextPin && (
          <>
            <Circle
              center={[nextPin.lat, nextPin.lng]}
              radius={nextPin.trigger_distance_m}
              pathOptions={{ color: '#14b8a6', fillColor: '#14b8a6', fillOpacity: 0.12, weight: 2 }}
            />
            <CircleMarker
              center={[nextPin.lat, nextPin.lng]}
              radius={nextPinPulse ? 14 : 10}
              pathOptions={{
                color: '#0f766e',
                fillColor: '#5eead4',
                fillOpacity: 1,
                weight: 2,
                className: nextPinPulse ? 'exam-pin-pulse' : undefined,
              }}
            />
          </>
        )}

        <Marker position={userPos} icon={navArrowIcon} zIndexOffset={1000} />

        <MapFollowPause onPause={() => setFollowPaused(true)} />
        <DrivingCamera position={userPos} heading={heading} followPaused={followPaused} />
      </MapContainer>
    </div>
  )
}
