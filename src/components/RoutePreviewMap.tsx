import { useEffect } from 'react'
import { CircleMarker, MapContainer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { RoutePolyline } from '@/components/RoutePolyline'
import { getRouteOfficialPreviewMap } from '@/data/route-preview-maps'
import { OfficialRoutePreviewZoom } from '@/components/OfficialRoutePreviewZoom'
import { MAP_TILES } from '@/lib/map-tiles'
import { examRouteLine } from '@/lib/pin-route-line'
import type { LatLng } from '@/lib/gps'
import type { RouteWithPins } from '@/types/database'

type Props = {
  route: RouteWithPins
  selectedPinOrder?: number | null
  onPinSelect?: (sortOrder: number) => void
}

function MapSizeFix() {
  const map = useMap()
  useEffect(() => {
    let frame = 0
    const invalidate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false, debounceMoveend: true })
      })
    }
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(invalidate)
      : null

    observer?.observe(map.getContainer())
    window.addEventListener('resize', invalidate, { passive: true })
    window.visualViewport?.addEventListener('resize', invalidate, { passive: true })
    document.addEventListener('fullscreenchange', invalidate)
    invalidate()

    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', invalidate)
      window.visualViewport?.removeEventListener('resize', invalidate)
      document.removeEventListener('fullscreenchange', invalidate)
    }
  }, [map])
  return null
}

function FitRoutePreview({ positions }: { positions: LatLng[] }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length < 2) return
    map.fitBounds(L.latLngBounds(positions.map(([lat, lng]) => [lat, lng])), {
      padding: [36, 36],
      maxZoom: 16,
      animate: false,
    })
  }, [map, positions])
  return null
}

function RoutePin({
  position,
  order,
  selected,
  onSelect,
}: {
  position: LatLng
  order: number
  selected: boolean
  onSelect?: (sortOrder: number) => void
}) {
  return (
    <CircleMarker
      center={position}
      radius={selected ? 9 : 6}
      pathOptions={{
        color: '#ffffff',
        fillColor: selected ? '#f59e0b' : '#1d4ed8',
        fillOpacity: 1,
        weight: selected ? 3 : 2,
      }}
      eventHandlers={onSelect ? { click: () => onSelect(order) } : undefined}
    >
      <Tooltip permanent direction="top" offset={[0, -5]} className="route-pin-tip">
        {order}
      </Tooltip>
    </CircleMarker>
  )
}

function RouteEndpoint({ position, kind }: { position: LatLng; kind: 'start' | 'finish' }) {
  const start = kind === 'start'
  return (
    <CircleMarker
      center={position}
      radius={12}
      pathOptions={{
        color: '#ffffff',
        fillColor: start ? '#16a34a' : '#dc2626',
        fillOpacity: 1,
        weight: 3,
      }}
    >
      <Tooltip permanent direction="top" offset={[0, -9]} className="route-ep-tip">
        {start ? 'START' : 'FINISH'}
      </Tooltip>
    </CircleMarker>
  )
}

function OfficialRoutePreviewImage({ map }: { map: NonNullable<ReturnType<typeof getRouteOfficialPreviewMap>> }) {
  return <OfficialRoutePreviewZoom map={map} />
}

function InteractiveRoutePreviewMap({
  route,
  selectedPinOrder,
  onPinSelect,
}: {
  route: RouteWithPins
  selectedPinOrder: number | null
  onPinSelect?: (sortOrder: number) => void
}) {
  const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
  const line = examRouteLine(route.slug, pins)
  const startPin = pins[0]
  const finishPin = pins[pins.length - 1]
  if (!startPin || !finishPin || line.length < 2) {
    return (
      <div className="exam-preview__map" role="alert">
        მარშრუტის რუკის მონაცემები ხელმისაწვდომი არ არის.
      </div>
    )
  }

  const start: LatLng = [startPin.lat, startPin.lng]
  const finish: LatLng = [finishPin.lat, finishPin.lng]
  const boundsPositions = [...line, ...pins.map((pin) => [pin.lat, pin.lng] as LatLng)]

  return (
    <div
      className="exam-preview__map exam-preview__map--interactive"
      aria-label={`${route.name_ka} — მარშრუტის გადახედვა`}
    >
      <MapContainer
        key={route.id}
        center={start}
        zoom={12}
        className="exam-preview-map"
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom
        dragging
        doubleClickZoom
        touchZoom
        boxZoom={false}
        keyboard
        zoomSnap={0.25}
        zoomDelta={0.5}
        maxZoom={MAP_TILES.maxZoom}
        minZoom={10}
      >
        <MapBasemapLayers tiles={MAP_TILES} detectRetina />
        <RoutePolyline positions={line} variant="pins" />
        {pins.map((pin) => (
          <RoutePin
            key={pin.id}
            position={[pin.lat, pin.lng]}
            order={pin.sort_order}
            selected={selectedPinOrder === pin.sort_order}
            onSelect={onPinSelect}
          />
        ))}
        <RouteEndpoint position={start} kind="start" />
        <RouteEndpoint position={finish} kind="finish" />
        <FitRoutePreview positions={boundsPositions} />
        <MapSizeFix />
      </MapContainer>
      <div className="exam-preview__map-label">
        <strong>{route.name_ka}</strong>
        {route.license_category && (
          <span className="tag tag--category">
            {route.license_category === 'B' && '🚗 B'}
            {route.license_category === 'C' && '🚛 C'}
            {route.license_category === 'C,D' && '🚛🚌 C+D'}
          </span>
        )}
        {route.official_label && <span>{route.official_label}</span>}
      </div>
    </div>
  )
}

export function RoutePreviewMap({
  route,
  selectedPinOrder = null,
  onPinSelect,
}: Props) {
  const officialMap = route.slug === 'route-5' ? getRouteOfficialPreviewMap(route.slug) : null
  if (officialMap) {
    return <OfficialRoutePreviewImage map={officialMap} />
  }
  return (
    <InteractiveRoutePreviewMap
      route={route}
      selectedPinOrder={selectedPinOrder}
      onPinSelect={onPinSelect}
    />
  )
}
