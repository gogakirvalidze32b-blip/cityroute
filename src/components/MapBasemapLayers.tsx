import { TileLayer } from 'react-leaflet'
import type { MapTilesDefinition } from '@/lib/map-tiles'

type Props = {
  tiles: MapTilesDefinition
  detectRetina?: boolean
}

export function MapBasemapLayers({ tiles, detectRetina }: Props) {
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
        />
      ))}
    </>
  )
}
