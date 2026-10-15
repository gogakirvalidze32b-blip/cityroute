import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ExamLiveMapLeaflet } from './ExamLiveMapLeaflet'
import { TELAVI_ROUTES_FALLBACK } from '@/data/telavi-routes'
import { applyLocalTbilisiTestPin } from '@/data/local-tbilisi-test-pin'
import { examRouteLine, maxPinOffsetFromLineM, pinRouteLine } from '@/lib/pin-route-line'
import { applyAuditedPinInstructions, applyRelocatedPin } from '@/hooks/useRoutes'

vi.mock('react-leaflet', () => {
  const map: unknown = new Proxy(() => map, { get: () => map, apply: () => map })
  return {
    MapContainer: ({ children }: { children: ReactNode }) => <div data-testid="map">{children}</div>,
    CircleMarker: ({ center, pathOptions }: { center: [number, number]; pathOptions?: { fillColor?: string } }) => (
      <div data-testid="pin-marker" data-lat={center[0]} data-lng={center[1]} data-fill={pathOptions?.fillColor} />
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
  [41.6789378, 44.9788424],
  [41.6792766, 44.9781393],
  [41.6798062, 44.9783244],
  [41.6811228, 44.979409],
  [41.6811569, 44.9808128],
]
const BLUE = '#3b82f6'

const routes = applyRelocatedPin(applyAuditedPinInstructions(applyLocalTbilisiTestPin(TELAVI_ROUTES_FALLBACK)))
const route = routes.find((r) => r.slug === 'test-route-tbilisi')!
const fills = () => screen.getAllByTestId('pin-marker').map((m) => m.dataset.fill)
const hudText = () => document.querySelector('.exam-live-map__hud strong')?.textContent ?? null

describe('Tbilisi test route on the live exam map', () => {
  afterEach(cleanup)

  it('/route/test-route-tbilisi draws all five pins, in order', () => {
    expect(routes.filter((r) => r.slug === 'test-route-tbilisi')).toHaveLength(1)

    render(<ExamLiveMapLeaflet route={route} userPos={EXPECTED[0]} heading={0} nextPin={route.pins[0]} />)

    const markers = screen.getAllByTestId('pin-marker').map((m) => [Number(m.dataset.lat), Number(m.dataset.lng)])
    expect(markers).toEqual(EXPECTED)
    const line = JSON.parse(screen.getByTestId('pin-line').dataset.points!) as [number, number][]
    const straight = pinRouteLine(route.pins)
    expect(line.length).toBeGreaterThan(straight.length)
    expect(line).toEqual(examRouteLine('test-route-tbilisi', route.pins))
    expect(maxPinOffsetFromLineM(EXPECTED, line)).toBeLessThanOrEqual(40)
  })

  it('only the next pin is blue and the HUD shows that pin’s instruction; with no next pin nothing is blue', () => {
    const view = render(<ExamLiveMapLeaflet route={route} userPos={EXPECTED[0]} heading={0} nextPin={route.pins[0]} />)
    for (const [index, next] of route.pins.entries()) {
      view.rerender(<ExamLiveMapLeaflet route={route} userPos={EXPECTED[0]} heading={0} nextPin={next} />)
      expect(fills().map((fill) => fill === BLUE)).toEqual(route.pins.map((_, i) => i === index))
      expect(hudText()).toBe(next.instruction_ka)
    }

    view.rerender(<ExamLiveMapLeaflet route={route} userPos={EXPECTED[0]} heading={0} nextPin={null} />)
    expect(fills().some((fill) => fill === BLUE)).toBe(false)
    expect(hudText()).toBeNull()
  })
})
