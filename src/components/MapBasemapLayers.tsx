import { TileLayer } from 'react-leaflet'
import type { MapTilesDefinition } from '@/lib/map-tiles'

type Props = {
  tiles: MapTilesDefinition
  detectRetina?: boolean
  enabled?: boolean
}

export function MapBasemapLayers({ tiles, detectRetina, enabled = true }: Props) {
  if (!enabled) return null

  return (
    <>
      {tiles.layers.map((layer, index) => (
        <TileLayer
          key={layer.url}
          url={layer.url}
          attribution={index === 0 ? tiles.attribution : undefined}
          subdomains={layer.subdomains}
          maxNativeZoom={layer.maxNativeZoom ?? tiles.maxNativeZoom}
          maxZoom={layer.maxZoom ?? tiles.maxZoom}
          opacity={layer.opacity}
          detectRetina={detectRetina}
          keepBuffer={4}
          updateWhenIdle={false}
          updateWhenZooming={false}
          errorTileUrl="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='256' height='256'%3E%3Crect fill='%231e293b' width='256' height='256'/%3E%3C/svg%3E"
        />
      ))}
    </>
  )
}
