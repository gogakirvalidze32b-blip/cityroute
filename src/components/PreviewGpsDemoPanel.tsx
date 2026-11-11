import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { audioEngine } from '@/lib/audio'
import { examRouteLine } from '@/lib/pin-route-line'
import {
  prepareRouteGeometry,
  projectOrderedPointsToRoute,
  type ActiveRouteId,
  type PreparedRouteGeometry,
  type RouteProjection,
} from '@/lib/pure-route-geometry'
import type { PreviewGpsSource } from '@/lib/preview-gps-source'
import type { GpsPosition } from '@/lib/gps'
import type { RouteWithPins } from '@/types/database'
import type { PreviewDemoControls } from './ExamDriveSession'

const GPS_INTERVAL_MS = 1000
const FIX_ACCURACY_METERS = 5

function bearingDegrees(from: readonly [number, number], to: readonly [number, number]) {
  const radians = Math.PI / 180
  const lat1 = from[0] * radians
  const lat2 = to[0] * radians
  const deltaLng = (to[1] - from[1]) * radians
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return (Math.atan2(y, x) / radians + 360) % 360
}

function positionAtChainage(
  geometry: PreparedRouteGeometry,
  chainageMeters: number,
): RouteProjection {
  const bounded = Math.max(0, Math.min(chainageMeters, geometry.totalLengthMeters))
  let segmentIndex = geometry.cumulativeMeters.findIndex((value) => value > bounded) - 1
  if (segmentIndex < 0) segmentIndex = geometry.coordinates.length - 2
  const start = geometry.coordinates[segmentIndex]
  const end = geometry.coordinates[segmentIndex + 1]
  const segmentStart = geometry.cumulativeMeters[segmentIndex]
  const segmentLength =
    geometry.cumulativeMeters[segmentIndex + 1] - geometry.cumulativeMeters[segmentIndex]
  const fraction = segmentLength === 0 ? 0 : (bounded - segmentStart) / segmentLength
  const position: readonly [number, number] = [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ]
  return {
    routeId: geometry.routeId,
    segmentIndex,
    segmentFraction: fraction,
    position,
    chainageMeters: bounded,
    crossTrackMeters: 0,
    segmentBearingDegrees: bearingDegrees(start, end),
  }
}

function orderedPinProjection(
  route: RouteWithPins,
  geometry: PreparedRouteGeometry,
  sortOrder: number,
): RouteProjection {
  const points = [...route.pins]
    .filter((pin) => pin.sort_order <= sortOrder)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((pin) => [pin.lat, pin.lng] as const)
  const projection = projectOrderedPointsToRoute(geometry, points, 40)
  if (!projection) {
    throw new Error(`PIN ${sortOrder} cannot be placed on the displayed route line in sequence.`)
  }
  return projection
}

function gpsPosition(projection: RouteProjection, speedKmh: number): GpsPosition {
  return {
    lat: projection.position[0],
    lng: projection.position[1],
    accuracy: FIX_ACCURACY_METERS,
    heading: projection.segmentBearingDegrees,
    speed: speedKmh / 3.6,
    timestamp: Date.now(),
  }
}

export function PreviewGpsDemoPanel({
  route,
  routes,
  controls,
  source,
}: {
  route: RouteWithPins
  routes: readonly RouteWithPins[]
  controls: PreviewDemoControls | null
  source: PreviewGpsSource
}) {
  const navigate = useNavigate()
  const routeLine = useMemo(() => examRouteLine(route.slug, route.pins), [route.slug, route.pins])
  const geometry = useMemo(
    () => prepareRouteGeometry(route.slug as ActiveRouteId, routeLine),
    [route.slug, routeLine],
  )
  const sortedPins = useMemo(
    () => [...route.pins].sort((a, b) => a.sort_order - b.sort_order),
    [route.pins],
  )
  const [startPinOrder, setStartPinOrder] = useState(sortedPins[0]?.sort_order ?? 1)
  const [speedKmh, setSpeedKmh] = useState(20)
  const [running, setRunning] = useState(false)
  const [nextPinOrder, setNextPinOrder] = useState<number | null>(startPinOrder)
  const [status, setStatus] = useState('მზადაა')
  const chainageRef = useRef(0)
  const speedRef = useRef(speedKmh)
  const timerRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const stopAtPinRef = useRef<number | null>(null)
  const controlsRef = useRef<PreviewDemoControls | null>(controls)

  speedRef.current = speedKmh
  controlsRef.current = controls

  const publishAt = useCallback(
    (chainageMeters: number) => {
      const projection = positionAtChainage(geometry, chainageMeters)
      chainageRef.current = projection.chainageMeters
      source.publish(gpsPosition(projection, speedRef.current))
      return projection
    },
    [geometry, source],
  )

  const pause = useCallback((message = 'შეჩერებულია') => {
    runningRef.current = false
    stopAtPinRef.current = null
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setRunning(false)
    setStatus(message)
  }, [])

  const scheduleFix = useCallback(() => {
    if (!runningRef.current) return
    timerRef.current = window.setTimeout(() => {
      if (!runningRef.current) return

      const api = controlsRef.current
      const stopAtPin = stopAtPinRef.current
      const currentPinOrder = api?.nextPinOrder() ?? null
      if (stopAtPin !== null && currentPinOrder !== stopAtPin) {
        setNextPinOrder(currentPinOrder)
        pause(`PIN ${stopAtPin} დასრულდა — აუდიო დასრულებულია`)
        return
      }

      if (audioEngine.isBusy()) {
        setStatus('აუდიოს დასრულებას ველოდები')
        scheduleFix()
        return
      }

      const nextChainage = Math.min(
        geometry.totalLengthMeters,
        chainageRef.current + (speedRef.current / 3.6) * (GPS_INTERVAL_MS / 1000),
      )
      const projection = publishAt(nextChainage)
      const nextOrder = api?.nextPinOrder() ?? null
      setNextPinOrder(nextOrder)

      if (stopAtPin !== null && nextChainage >= geometry.totalLengthMeters) {
        pause(`PIN ${stopAtPin} ვერ დადასტურდა — ტრასის ბოლო მიღწეულია`)
        return
      }
      if (nextChainage >= geometry.totalLengthMeters) {
        pause('მარშრუტის ბოლო წერტილი მიღწეულია')
        return
      }

      setStatus(
        `GPS fix · ${projection.position[0].toFixed(6)}, ${projection.position[1].toFixed(6)}`,
      )
      scheduleFix()
    }, GPS_INTERVAL_MS)
  }, [geometry.totalLengthMeters, pause, publishAt])

  const startFromSelectedPin = useCallback(async () => {
    const api = controlsRef.current
    if (!api) {
      setStatus('ნავიგაციის კონტროლი ჯერ მზად არ არის')
      return
    }
    if (api.isActive()) {
      setStatus('სესია უკვე აქტიურია — გამოიყენეთ RESUME ან RESET DEMO')
      return
    }
    try {
      pause('ვიწყებ DEMO GPS-ს')
      const projection = orderedPinProjection(route, geometry, startPinOrder)
      chainageRef.current = projection.chainageMeters
      source.clear()
      source.publish(gpsPosition(projection, 0))
      await api.startAtPin(startPinOrder)
      setNextPinOrder(startPinOrder)
      setStatus(`DEMO აქტიურია PIN ${startPinOrder}-დან`)
      runningRef.current = true
      setRunning(true)
      scheduleFix()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'DEMO ვერ გაეშვა')
    }
  }, [geometry, pause, route, scheduleFix, source, startPinOrder])

  const resume = useCallback(() => {
    if (!controlsRef.current?.isActive()) {
      setStatus('ჯერ აირჩიეთ PLAY და საწყისი PIN')
      return
    }
    if (chainageRef.current >= geometry.totalLengthMeters) {
      setStatus('ტრასის ბოლოში ხართ — გამოიყენეთ RESET DEMO')
      return
    }
    runningRef.current = true
    setRunning(true)
    setStatus('გრძელდება')
    scheduleFix()
  }, [geometry.totalLengthMeters, scheduleFix])

  const nextPin = useCallback(() => {
    const api = controlsRef.current
    const targetOrder = api?.nextPinOrder() ?? null
    if (!api?.isActive() || targetOrder === null) {
      setStatus('შემდეგი PIN არ არის — სცადეთ PLAY ან RESET DEMO')
      return
    }
    try {
      const target = orderedPinProjection(route, geometry, targetOrder)
      if (target.chainageMeters < chainageRef.current) {
        setStatus(`PIN ${targetOrder} მარშრუტის მიმდინარე პოზიციის უკანაა`)
        return
      }
      stopAtPinRef.current = targetOrder
      setStatus(`GPS-ით მივდივარ PIN ${targetOrder}-მდე`)
      if (!runningRef.current) {
        runningRef.current = true
        setRunning(true)
        scheduleFix()
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'PIN-ის ტრასაზე განთავსება ვერ მოხერხდა')
    }
  }, [geometry, route, scheduleFix])

  const reset = useCallback(() => {
    pause('DEMO გადატვირთულია')
    source.clear()
    chainageRef.current = 0
    controlsRef.current?.reset()
    setNextPinOrder(startPinOrder)
  }, [pause, source, startPinOrder])

  useEffect(() => {
    setStartPinOrder(sortedPins[0]?.sort_order ?? 1)
    setNextPinOrder(sortedPins[0]?.sort_order ?? 1)
    pause('მზადაა')
    source.clear()
    return () => {
      pause('შეჩერებულია')
      source.clear()
    }
  }, [route.slug, sortedPins, pause, source])

  useEffect(() => {
    if (!controls) return
    const currentPinOrder = controls.nextPinOrder()
    setNextPinOrder(currentPinOrder ?? startPinOrder)
    if (controls.isActive()) {
      setStatus(
        currentPinOrder === null
          ? 'DEMO სესია აქტიურია · შემდეგი ნაბიჯი FINISH'
          : `DEMO სესია აქტიურია · შემდეგი PIN ${currentPinOrder}`,
      )
    }
  }, [controls, startPinOrder])

  return (
    <section
      aria-label="Preview GPS DEMO მართვის პანელი"
      data-testid="preview-gps-demo-panel"
      style={{
        padding: '1rem',
        border: '1px solid var(--border, #cbd5e1)',
        borderRadius: '12px',
        background: 'var(--surface, #fff)',
        color: '#0f172a',
        display: 'grid',
        gap: '0.75rem',
      }}
    >
      <div>
        <strong>PREVIEW GPS DEMO</strong>
        <p style={{ margin: '0.25rem 0 0' }}>
          სიმულაცია იყენებს რუკაზე ნაჩვენებ route line-ს და იგივე GPS/Navigation Engine-ს.
          პროგრესი იზოლირებულია DEMO სესიაში.
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}>
        <label>
          მარშრუტი
          <select
            aria-label="DEMO მარშრუტი"
            value={route.slug}
            disabled={Boolean(controlsRef.current?.isActive())}
            onChange={(event) => navigate(`/preview-demo/route/${event.currentTarget.value}`)}
          >
            {routes.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.name_ka}
              </option>
            ))}
          </select>
        </label>
        <label>
          საწყისი PIN
          <select
            aria-label="DEMO საწყისი PIN"
            value={startPinOrder}
            disabled={Boolean(controlsRef.current?.isActive())}
            onChange={(event) => {
              const selectedOrder = Number(event.currentTarget.value)
              setStartPinOrder(selectedOrder)
              setNextPinOrder(selectedOrder)
            }}
          >
            {sortedPins.map((pin) => (
              <option key={pin.id} value={pin.sort_order}>
                PIN {pin.sort_order}
              </option>
            ))}
          </select>
        </label>
        <label>
          სიჩქარე: {speedKmh} კმ/სთ
          <input
            aria-label="DEMO სიჩქარე"
            type="range"
            min="5"
            max="60"
            step="5"
            value={speedKmh}
            onChange={(event) => setSpeedKmh(Number(event.currentTarget.value))}
          />
        </label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={() => void startFromSelectedPin()}
          disabled={running || Boolean(controls?.isActive())}
        >
          PLAY
        </button>
        <button type="button" onClick={() => pause()} disabled={!running}>
          PAUSE
        </button>
        <button
          type="button"
          onClick={resume}
          disabled={running || !controls?.isActive()}
        >
          RESUME
        </button>
        <button
          type="button"
          onClick={nextPin}
          disabled={!controls?.isActive() || nextPinOrder === null || stopAtPinRef.current !== null}
        >
          NEXT PIN
        </button>
        <button type="button" onClick={reset}>
          RESET DEMO
        </button>
      </div>
      <p role="status" aria-live="polite" style={{ margin: 0 }}>
        {status}
        {nextPinOrder !== null ? ` · შემდეგი PIN ${nextPinOrder}` : ' · შემდეგი PIN: FINISH'}
      </p>
    </section>
  )
}
