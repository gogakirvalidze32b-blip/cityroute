import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { MAP_TILES } from '@/lib/map-tiles'

vi.mock('react-leaflet', () => ({
  TileLayer: ({ url }: { url: string }) => <div data-testid="map-tile" data-url={url} />,
}))

describe('MapBasemapLayers', () => {
  it('does not request basemap tiles when offline mode disables them', () => {
    render(<MapBasemapLayers tiles={MAP_TILES} enabled={false} />)

    expect(screen.queryAllByTestId('map-tile')).toHaveLength(0)
  })

  it('preserves the default basemap behavior outside offline mode', () => {
    render(<MapBasemapLayers tiles={MAP_TILES} />)

    expect(screen.getAllByTestId('map-tile')).toHaveLength(MAP_TILES.layers.length)
  })
})
