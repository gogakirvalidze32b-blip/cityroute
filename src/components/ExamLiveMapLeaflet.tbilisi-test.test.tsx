import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ExamLiveMapLeaflet } from './ExamLiveMapLeaflet'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyLocalTbilisiTestPin } from '@/data/local-tbilisi-test-pin'
import { applyAuditedPinInstructions, applyRelocatedPin } from '@/hooks/useRoutes'

vi.mock('react-leaflet', () => {
  const map: unknown = new Proxy(() => map, { get: () => map, apply: () => map })
  return {
    MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
    CircleMarker: ({ center }: { center: [number, number] }) => (
      <div data-testid="pin-marker" data-lat={center[0]} data-lng={center[1]} />
    ),
    useMap: () => map,
    useMapEvents: () => map,
  }
})
vi.mock('@/components/MapBasemapLayers', () => ({ MapBasemapLayers: () => null }))
vi.mock('@/components/RoutePolyline', () => ({
  RoutePolyline: ({ positions }: { positions: [number, number][] }) => (
    <div data-testid="pin-line" data-points={JSON.stringify(positions)} />
  ),
}))

const EXPECTED: [number, number][] = [
  [41.6786037, 44.9795425],
  [41.6789698, 44.9786878],
  [41.6792766, 44.9781393],
]

describe('Tbilisi test route on the live exam map', () => {
  afterEach(cleanup)

  it('/route/test-route-tbilisi draws all three pins, in order', () => {
    const routes = applyRelocatedPin(applyAuditedPinInstructions(applyLocalTbilisiTestPin(TELAVI_ROUTES_FALLBACK)))
    const route = routes.find((r) => r.slug === 'test-route-tbilisi')!
    expect(routes.filter((r) => r.slug === 'test-route-tbilisi')).toHaveLength(1)

    render(<ExamLiveMapLeaflet route={route} userPos={EXPECTED[0]} heading={0} nextPin={route.pins[0]} />)

    const markers = screen.getAllByTestId('pin-marker').map((m) => [Number(m.dataset.lat), Number(m.dataset.lng)])
    expect(markers).toEqual(EXPECTED)
    expect(JSON.parse(screen.getByTestId('pin-line').dataset.points!)).toEqual(EXPECTED)
  })
})
