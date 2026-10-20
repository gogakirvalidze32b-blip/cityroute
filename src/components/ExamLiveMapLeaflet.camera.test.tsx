import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ExamLiveMapLeaflet } from './ExamLiveMapLeaflet'
import { TELAVI_ROUTES_FALLBACK, YANDEX_STREET_ZOOM } from '@/data/telavi-routes'

const mapState = vi.hoisted(() => ({
  center: { lat: 0, lng: 0 },
  zoom: 17,
  viewport: { width: 400, height: 800 },
  eventHandlers: {} as Record<string, () => void>,
  setView: vi.fn(),
  panTo: vi.fn(),
  getCenter: vi.fn(),
  getSize: vi.fn(() => ({ x: 1136, y: 1136 })),
  project: vi.fn((position: { lat: number; lng: number }) => ({
    x: position.lng * 100000,
    y: -position.lat * 100000,
  })),
  unproject: vi.fn((point: { x: number; y: number }) => ({
    lat: -point.y / 100000,
    lng: point.x / 100000,
  })),
  latLngToContainerPoint: vi.fn(),
  invalidateSize: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  dragging: { enable: vi.fn() },
  touchZoom: { enable: vi.fn() },
  scrollWheelZoom: { enable: vi.fn() },
  doubleClickZoom: { enable: vi.fn() },
  boxZoom: { enable: vi.fn() },
  keyboard: { enable: vi.fn() },
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({
    children,
    zoom,
  }: {
    children: ReactNode
    zoom: number
  }) => <div data-testid="live-map" data-zoom={zoom}>{children}</div>,
  Marker: ({
    position,
    icon,
  }: {
    position: [number, number]
    icon: { options: { html?: string } }
  }) => (
    <div
      data-testid="navigation-vehicle-marker"
      data-position={position.join(',')}
      data-icon-html={icon.options.html}
    />
  ),
  CircleMarker: () => null,
  useMap: () => mapState,
  useMapEvents: (handlers: Record<string, () => void>) => {
    Object.assign(mapState.eventHandlers, handlers)
    return mapState
  },
}))
vi.mock('@/components/MapBasemapLayers', () => ({ MapBasemapLayers: () => null }))
vi.mock('@/components/RoutePolyline', () => ({ RoutePolyline: () => null }))

const route = TELAVI_ROUTES_FALLBACK[0]
const initialPosition: [number, number] = route.polyline[0]
let frames: FrameRequestCallback[] = []
let animationTime = 0

function renderMap(
  userPos = initialPosition,
  nextPin: (typeof route.pins)[number] | null = null,
  heading = 0,
) {
  const view = render(
    <ExamLiveMapLeaflet route={route} userPos={userPos} heading={heading} nextPin={nextPin} />,
  )
  const mapViewport = view.container.querySelector('.exam-live-map')
  if (mapViewport) {
    Object.defineProperty(mapViewport, 'clientHeight', {
      configurable: true,
      get: () => mapState.viewport.height,
    })
  }
  return view
}

function runNextFrame() {
  const frame = frames.shift()
  if (!frame) throw new Error('Expected a scheduled camera animation frame')
  animationTime += 16
  act(() => frame(animationTime))
}

function vehicleScreenPoint(position: [number, number]) {
  const point = mapState.latLngToContainerPoint(position)
  const transform = screen.getByTestId('live-map').parentElement?.style.transform ?? 'rotate(0deg)'
  const rotationDeg = Number(transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? 0)
  const rotation = (rotationDeg * Math.PI) / 180
  const mapSize = mapState.getSize()
  const x = point.x - mapSize.x / 2
  const y = point.y - mapSize.y / 2

  return {
    x: mapState.viewport.width / 2 + Math.cos(rotation) * x - Math.sin(rotation) * y,
    y: mapState.viewport.height / 2 + Math.sin(rotation) * x + Math.cos(rotation) * y,
  }
}

function markerPosition(): [number, number] {
  const value = screen.getByTestId('navigation-vehicle-marker').getAttribute('data-position')
  if (!value) throw new Error('Vehicle marker has no geographic position')
  const [lat, lng] = value.split(',').map(Number)
  return [lat, lng]
}

describe('ExamLiveMapLeaflet camera', () => {
  beforeEach(() => {
    frames = []
    animationTime = 0
    mapState.center = { lat: 0, lng: 0 }
    mapState.viewport = { width: 400, height: 800 }
    mapState.zoom = YANDEX_STREET_ZOOM
    mapState.eventHandlers = {}
    mapState.setView.mockReset()
    mapState.panTo.mockReset()
    mapState.invalidateSize.mockReset()
    mapState.on.mockReset()
    mapState.off.mockReset()
    mapState.dragging.enable.mockReset()
    mapState.touchZoom.enable.mockReset()
    mapState.scrollWheelZoom.enable.mockReset()
    mapState.doubleClickZoom.enable.mockReset()
    mapState.boxZoom.enable.mockReset()
    mapState.keyboard.enable.mockReset()
    mapState.getCenter.mockImplementation(() => mapState.center)
    mapState.setView.mockImplementation((position: [number, number]) => {
      mapState.center = { lat: position[0], lng: position[1] }
    })
    mapState.panTo.mockImplementation((position: [number, number]) => {
      mapState.center = { lat: position[0], lng: position[1] }
    })
    mapState.latLngToContainerPoint.mockImplementation((position: [number, number]) => {
      const size = mapState.getSize()
      return {
        x: (position[1] - mapState.center.lng) * 100000 + size.x / 2,
        y: (mapState.center.lat - position[0]) * 100000 + size.y / 2,
        distanceTo(other: { x: number; y: number }) {
          return Math.hypot(this.x - other.x, this.y - other.y)
        },
      }
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    vi.stubGlobal('ResizeObserver', undefined)
    let timestamp = 1000
    vi.spyOn(Date, 'now').mockImplementation(() => timestamp++)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses the configured navigation zoom and avoids repeated panning when GPS is idle', () => {
    renderMap()

    expect(screen.getByTestId('live-map').dataset.zoom).toBe(String(YANDEX_STREET_ZOOM))
    runNextFrame()
    runNextFrame()
    expect(mapState.setView).toHaveBeenCalledWith(
      expect.any(Array),
      YANDEX_STREET_ZOOM,
      { animate: false },
    )
    expect(mapState.panTo).not.toHaveBeenCalled()
    expect(frames).toHaveLength(0)
    expect(vehicleScreenPoint(initialPosition).x).toBeCloseTo(200)
    expect(vehicleScreenPoint(initialPosition).y).toBeCloseTo(544)
  })

  it('smoothly follows a new GPS fix without resetting the current zoom', () => {
    const view = renderMap()
    runNextFrame()
    runNextFrame()

    const gpsPosition: [number, number] = [initialPosition[0] + 0.0002, initialPosition[1]]
    mapState.zoom = 18
    view.rerender(
      <ExamLiveMapLeaflet route={route} userPos={gpsPosition} heading={35} nextPin={null} />,
    )

    runNextFrame()
    expect(mapState.panTo).toHaveBeenCalled()
    expect(mapState.panTo.mock.calls[0][0]).not.toEqual(gpsPosition)

    let framesProcessed = 0
    while (frames.length > 0 && framesProcessed < 30) {
      runNextFrame()
      framesProcessed++
    }

    expect(frames).toHaveLength(0)
    expect(mapState.panTo.mock.calls.at(-1)?.[0]).not.toEqual(gpsPosition)
    expect(mapState.setView).toHaveBeenCalledTimes(1)
    expect(mapState.zoom).toBe(18)
    expect(vehicleScreenPoint(gpsPosition).x).toBeCloseTo(200)
    expect(vehicleScreenPoint(gpsPosition).y).toBeCloseTo(544)
  })

  it('uses the smoothed FOLLOW heading for both map rotation and the vehicle arrow', () => {
    const view = renderMap()
    runNextFrame()
    runNextFrame()

    view.rerender(
      <ExamLiveMapLeaflet
        route={route}
        userPos={initialPosition}
        heading={4}
        nextPin={null}
      />,
    )
    runNextFrame()

    const world = view.container.querySelector<HTMLElement>('.exam-live-map__world')
    const markerHtml = screen.getByTestId('navigation-vehicle-marker').dataset.iconHtml
    if (!world) throw new Error('Navigation map world was not rendered')

    const displayedHeading = Number.parseFloat(
      world.style.getPropertyValue('--exam-live-map-heading'),
    )
    const mapRotation = Number.parseFloat(world.style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? 'NaN')

    expect(markerHtml).toContain('rotate(var(--exam-live-map-heading, 0deg))')
    expect(displayedHeading).toBeGreaterThan(0)
    expect(displayedHeading).toBeLessThan(4)
    expect(mapRotation).toBeCloseTo(-displayedHeading)

    view.rerender(
      <ExamLiveMapLeaflet
        route={route}
        userPos={initialPosition}
        heading={90}
        nextPin={null}
      />,
    )
    for (let frame = 0; frame < 10 && frames.length > 0; frame++) runNextFrame()

    const turnedHeading = Number.parseFloat(
      world.style.getPropertyValue('--exam-live-map-heading'),
    )
    expect(turnedHeading).toBeGreaterThan(75)
    expect(mapRotation).not.toBeNaN()
    expect(Number.parseFloat(world.style.transform.match(/rotate\((-?[\d.]+)deg\)/)?.[1] ?? 'NaN'))
      .toBeCloseTo(-turnedHeading)
  })

  it('smoothly crosses the 359° to 1° heading boundary', () => {
    const view = renderMap(initialPosition, null, 359)
    runNextFrame()

    view.rerender(
      <ExamLiveMapLeaflet
        route={route}
        userPos={initialPosition}
        heading={1}
        nextPin={null}
      />,
    )
    runNextFrame()

    const world = view.container.querySelector<HTMLElement>('.exam-live-map__world')
    if (!world) throw new Error('Navigation map world was not rendered')
    const displayedHeading = Number.parseFloat(
      world.style.getPropertyValue('--exam-live-map-heading'),
    )
    const distanceFromNorth = Math.min(displayedHeading, 360 - displayedHeading)

    expect(distanceFromNorth).toBeLessThan(2)
    expect(distanceFromNorth).toBeGreaterThan(0)
  })

  it('keeps GPS from moving the camera in FREE mode until recenter is pressed', () => {
    const view = renderMap()
    runNextFrame()
    runNextFrame()

    mapState.center = { lat: initialPosition[0] + 0.001, lng: initialPosition[1] }
    act(() => mapState.eventHandlers.dragstart?.())
    view.rerender(
      <ExamLiveMapLeaflet
        route={route}
        userPos={[initialPosition[0] + 0.00005, initialPosition[1]]}
        heading={0}
        nextPin={null}
      />,
    )
    runNextFrame()
    expect(mapState.panTo).not.toHaveBeenCalled()
    expect(frames).toHaveLength(0)

    fireEvent.click(screen.getByTitle('ცენტრში დაბრუნება'))
    runNextFrame()
    expect(mapState.panTo).toHaveBeenCalled()
  })

  it('keeps the vehicle marker attached to its geographic position while the map is dragged', () => {
    const view = renderMap()
    runNextFrame()
    runNextFrame()

    expect(markerPosition()).toEqual(initialPosition)
    mapState.panTo.mockClear()
    mapState.center = { lat: initialPosition[0] + 0.001, lng: initialPosition[1] }
    act(() => mapState.eventHandlers.dragstart?.())
    expect(screen.getByTitle('ცენტრში დაბრუნება').className).toContain('map-recenter-btn--active')
    runNextFrame()

    expect(mapState.panTo).not.toHaveBeenCalled()
    expect(markerPosition()).toEqual(initialPosition)
    expect(vehicleScreenPoint(markerPosition()).y).not.toBeCloseTo(544)

    const nextGpsPosition: [number, number] = [
      initialPosition[0] + 0.00001,
      initialPosition[1] + 0.00001,
    ]
    view.rerender(
      <ExamLiveMapLeaflet
        route={route}
        userPos={nextGpsPosition}
        heading={45}
        nextPin={null}
      />,
    )
    runNextFrame()

    expect(mapState.panTo).not.toHaveBeenCalled()
    expect(markerPosition()).toEqual(nextGpsPosition)
  })

  it.each([
    { heading: 0, width: 320, height: 568 },
    { heading: 45, width: 400, height: 800 },
    { heading: 90, width: 800, height: 480 },
    { heading: 180, width: 320, height: 568 },
    { heading: 270, width: 800, height: 480 },
  ])(
    'recenters to the latest accepted GPS fix at heading $heading° in $width×$height',
    ({ heading, width, height }) => {
      mapState.viewport = { width, height }
      const view = renderMap()
      runNextFrame()
      runNextFrame()
      mapState.panTo.mockClear()

      mapState.center = { lat: initialPosition[0] + 0.001, lng: initialPosition[1] }
      act(() => mapState.eventHandlers.dragstart?.())
      runNextFrame()

      const latestGpsPosition: [number, number] = [
        initialPosition[0] + 0.00001,
        initialPosition[1] + 0.00001,
      ]
      view.rerender(
        <ExamLiveMapLeaflet
          route={route}
          userPos={latestGpsPosition}
          heading={heading}
          nextPin={null}
        />,
      )
      runNextFrame()

      expect(markerPosition()).toEqual(latestGpsPosition)
      expect(mapState.panTo).not.toHaveBeenCalled()

      fireEvent.click(screen.getByTitle('ცენტრში დაბრუნება'))
      expect(markerPosition()).toEqual(latestGpsPosition)
      runNextFrame()
      while (frames.length > 0) runNextFrame()

      expect(mapState.panTo).toHaveBeenCalled()
      expect(vehicleScreenPoint(latestGpsPosition).x).toBeCloseTo(width / 2, 0)
      expect(vehicleScreenPoint(latestGpsPosition).y).toBeCloseTo(height * 0.68, 0)

      const laterGpsPosition: [number, number] = [
        latestGpsPosition[0] + 0.00001,
        latestGpsPosition[1] + 0.00001,
      ]
      const panCallsBeforeFollow = mapState.panTo.mock.calls.length
      view.rerender(
        <ExamLiveMapLeaflet
          route={route}
          userPos={laterGpsPosition}
          heading={heading}
          nextPin={null}
        />,
      )
      runNextFrame()
      let followFrames = 0
      while (frames.length > 0 && followFrames < 40) {
        runNextFrame()
        followFrames++
      }

      expect(markerPosition()).toEqual(laterGpsPosition)
      expect(mapState.panTo.mock.calls.length).toBeGreaterThan(panCallsBeforeFollow)
      expect(frames).toHaveLength(0)
    },
  )

  it('does not create a marker or move the camera before a trusted GPS fix exists', () => {
    render(
      <ExamLiveMapLeaflet
        route={route}
        userPos={initialPosition}
        heading={0}
        nextPin={null}
        hasGpsFix={false}
      />,
    )
    runNextFrame()

    expect(screen.queryByTestId('navigation-vehicle-marker')).toBeNull()
    expect(mapState.setView).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTitle('ცენტრში დაბრუნება'))
    expect(mapState.panTo).not.toHaveBeenCalled()
  })

  it('shows an exact-direction maneuver arrow and anchors the vehicle below map center', () => {
    const nextPin = {
      ...route.pins[0],
      instruction_ka: 'გთხოვთ, 300 მეტრში მოუხვიოთ მარჯვნივ',
    }
    renderMap(initialPosition, nextPin)

    expect(screen.getByTestId('next-maneuver').getAttribute('data-direction')).toBe('right')
    expect(screen.getByTestId('next-maneuver').querySelector('svg')).not.toBeNull()
    expect(markerPosition()).toEqual(initialPosition)
  })

  it('does not invent a maneuver arrow when the instruction has no recognized direction', () => {
    const nextPin = {
      ...route.pins[0],
      instruction_ka: 'შემდეგ წერტილამდე გააგრძელეთ მოძრაობა',
    }
    renderMap(initialPosition, nextPin)

    expect(screen.getByTestId('next-maneuver').getAttribute('data-direction')).toBe('unknown')
    expect(screen.getByTestId('next-maneuver').querySelector('svg')).toBeNull()
  })

  it('does not choose a single arrow when one instruction contains multiple directions', () => {
    const nextPin = {
      ...route.pins[0],
      instruction_ka: 'მოუხვიეთ მარცხნივ და შემდეგ მარჯვნივ',
    }
    renderMap(initialPosition, nextPin)

    expect(screen.getByTestId('next-maneuver').getAttribute('data-direction')).toBe('unknown')
    expect(screen.getByTestId('next-maneuver').querySelector('svg')).toBeNull()
  })
})
