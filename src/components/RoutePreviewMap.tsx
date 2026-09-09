import { useEffect } from 'react'
import { CircleMarker, MapContainer, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { RoutePolyline } from '@/components/RoutePolyline'
import { getRouteOfficialPreviewMap } from '@/data/route-preview-maps'
import { OfficialRoutePreviewZoom } from '@/components/OfficialRoutePreviewZoom'
import { MAP_TILES } from '@/lib/map-tiles'
import type { LatLng } from '@/lib/gps'
import type { RouteWithPins } from '@/types/database'
import { TELAVI_CENTER } from '@/data/telavi-routes'

type Props = {
  route: RouteWithPins
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

function FitRoutePreview({ line }: { line: LatLng[] }) {
  const map = useMap()
  useEffect(() => {
    if (line.length < 2) return
    map.fitBounds(L.latLngBounds(line.map(([lat, lng]) => [lat, lng])), {
      padding: [28, 28],
      maxZoom: 15,
      animate: false,
    })
  }, [map, line])
  return null
}

function RouteEndpoint({ position, kind }: { position: LatLng; kind: 'start' | 'end' }) {
  const start = kind === 'start'
  return (
    <CircleMarker
      center={position}
      radius={11}
      pathOptions={{
        color: start ? '#15803d' : '#b91c1c',
        fillColor: start ? '#22c55e' : '#ef4444',
        fillOpacity: 1,
        weight: 3,
      }}
    >
      <Tooltip permanent direction="top" offset={[0, -8]} className="route-ep-tip">
        {start ? 'დაწყება' : 'დასრულება'}
      </Tooltip>
    </CircleMarker>
  )
}

function OfficialRoutePreviewImage({ map }: { map: NonNullable<ReturnType<typeof getRouteOfficialPreviewMap>> }) {
  return <OfficialRoutePreviewZoom map={map} />
}

function InteractiveRoutePreviewMap({ route }: { route: RouteWithPins }) {
  const line = route.polyline as LatLng[]
  const hasLine = line.length >= 2
  const start = hasLine ? line[0] : null
  const finish = hasLine ? line[line.length - 1] : null
  const center = start ?? TELAVI_CENTER

  return (
    <div className="exam-preview__map" aria-label={`${route.name_ka} — მარშრუტის გადახედვა`}>
      <MapContainer
        key={route.id}
        center={center}
        zoom={14}
        className="exam-preview-map"
        zoomControl={false}
        attributionControl={false}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        touchZoom={false}
        boxZoom={false}
        keyboard={false}
      >
        <MapBasemapLayers tiles={MAP_TILES} />
        {hasLine && <RoutePolyline positions={line} variant="preview" />}
        {start && finish && (
          <>
            <RouteEndpoint position={start} kind="start" />
            <RouteEndpoint position={finish} kind="end" />
          </>
        )}
        <FitRoutePreview line={line} />
        <MapSizeFix />
      </MapContainer>
      <div className="exam-preview__map-label">
        <strong>{route.name_ka}</strong>
        {route.official_label && <span>{route.official_label}</span>}
      </div>
    </div>
  )
}

export function RoutePreviewMap({ route }: Props) {
  const officialMap = getRouteOfficialPreviewMap(route.slug)
  if (officialMap) {
    return <OfficialRoutePreviewImage map={officialMap} />
  }
  return <InteractiveRoutePreviewMap route={route} />
}
