import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import L from 'leaflet'
import { RoutePreviewMap } from './RoutePreviewMap'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { examRouteLine } from '@/lib/pin-route-line'

const { fitBounds, mapContainer } = vi.hoisted(() => ({
  fitBounds: vi.fn(),
  mapContainer: vi.fn(),
}))

vi.mock('react-leaflet', () => ({
  CircleMarker: ({
    center,
    pathOptions,
    children,
  }: {
    center: [number, number]
    pathOptions?: { fillColor?: string }
    children?: ReactNode
  }) => (
    <div
      data-testid="route-marker"
      data-position={center.join(',')}
      data-fill={pathOptions?.fillColor}
    >
      {children}
    </div>
  ),
  MapContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="route-map">{children}</div>
  ),
  Tooltip: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => <span className={className}>{children}</span>,
  useMap: () => ({
    fitBounds,
    getContainer: () => mapContainer(),
    invalidateSize: vi.fn(),
  }),
}))

vi.mock('@/components/MapBasemapLayers', () => ({ MapBasemapLayers: () => null }))
vi.mock('@/components/RoutePolyline', () => ({
  RoutePolyline: ({
    positions,
    variant,
  }: {
    positions: [number, number][]
    variant: string
  }) => (
    <div
      data-testid="route-line"
      data-variant={variant}
      data-points={JSON.stringify(positions)}
    />
  ),
}))

describe('RoutePreviewMap for routes 1–4', () => {
  beforeEach(() => {
    fitBounds.mockClear()
    mapContainer.mockReturnValue(document.createElement('div'))
  })

  afterEach(cleanup)

  it.each([1, 2, 3, 4])('renders route %i pins, its road trace and endpoints', (number) => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === `route-${number}`)!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)

    render(<RoutePreviewMap route={route} />)

    const ordinaryMarkers = screen.getAllByTestId('route-marker')
    expect(ordinaryMarkers).toHaveLength(pins.length + 2)
    expect(
      ordinaryMarkers.slice(0, pins.length).map((marker) => marker.dataset.position),
    ).toEqual(pins.map((pin) => `${pin.lat},${pin.lng}`))
    expect(
      screen.getAllByText(/^\d+$/).map((marker) => marker.textContent),
    ).toEqual(pins.map((pin) => String(pin.sort_order)))
    expect(screen.getByText('START')).toBeTruthy()
    expect(screen.getByText('FINISH')).toBeTruthy()
    expect(ordinaryMarkers[pins.length].dataset.fill).toBe('#16a34a')
    expect(ordinaryMarkers[pins.length + 1].dataset.fill).toBe('#dc2626')

    const line = screen.getByTestId('route-line')
    expect(line.dataset.variant).toBe('pins')
    const linePoints = JSON.parse(line.dataset.points!) as [number, number][]
    expect(linePoints).toEqual(examRouteLine(route.slug, pins))
    expect(linePoints.length).toBeGreaterThan(pins.length)
    const [bounds, fitOptions] = fitBounds.mock.calls.at(-1)!
    expect(fitOptions).toEqual(
      expect.objectContaining({ padding: [36, 36], maxZoom: 16, animate: false }),
    )
    for (const point of [...linePoints, ...pins.map((pin) => [pin.lat, pin.lng] as [number, number])]) {
      expect(bounds.contains(L.latLng(point))).toBe(true)
    }
  })
})
