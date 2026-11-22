import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { audioEngine } from '@/lib/audio'
import { examRouteLine } from '@/lib/pin-route-line'
import {
  DEFAULT_DEMO_SPEED_KMH,
  DEFAULT_DEMO_TIME_SCALE,
  DEMO_NEAR_PIN_SPEED_KMH,
  DEMO_PIN_HOLD_SLACK_METERS,
  DEMO_SPEED_KMH_OPTIONS,
  DEMO_START_APPROACH_LEAD_METERS,
  DEMO_TIME_SCALE_OPTIONS,
  demoAdaptiveSpeedKmh,
  demoAdvanceCappedToNextPin,
  demoAdvanceMeters,
  demoMicroChainages,
  demoTickIntervalForSpeed,
  type DemoSpeedKmh,
  type DemoTimeScale,
} from '@/lib/preview-gps-demo-speed'
import {
  prepareDemoRouteGeometry,
  resolveDemoNextPinAfterChainage,
  resolveDemoPinChainage,
  resolveDemoStartPinChainage,
} from '@/lib/preview-gps-demo-pin'
import {
  forwardBearingAlongRoute,
  type ActiveRouteId,
  type PreparedRouteGeometry,
  type RouteProjection,
} from '@/lib/pure-route-geometry'
import type { PreviewGpsSource } from '@/lib/preview-gps-source'
import type { GpsPosition } from '@/lib/gps'
import type { RouteWithPins } from '@/types/database'
import type { PreviewDemoControls } from './ExamDriveSession'

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

function demoPinChainageMeters(
  route: RouteWithPins,
  geometry: PreparedRouteGeometry,
  sortOrder: number,
  afterChainageMeters = 0,
): number {
  const chainage = resolveDemoStartPinChainage(
    geometry,
    route.pins,
    sortOrder,
    afterChainageMeters,
  )
  if (chainage === null) {
    throw new Error(`PIN ${sortOrder} cannot be placed on the displayed route line in sequence.`)
  }
  return chainage
}

function gpsPosition(
  geometry: PreparedRouteGeometry,
  projection: RouteProjection,
  speedKmh: number,
): GpsPosition {
  // Look-ahead bearing matches ExamDriveSession Maps-style arrow (not short-segment noise).
  const heading =
    forwardBearingAlongRoute(geometry, projection.chainageMeters, 14) ??
    projection.segmentBearingDegrees
  return {
    lat: projection.position[0],
    lng: projection.position[1],
    accuracy: FIX_ACCURACY_METERS,
    heading,
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
    () => prepareDemoRouteGeometry(route.slug as ActiveRouteId, routeLine),
    [route.slug, routeLine],
  )
  const sortedPins = useMemo(
    () => [...route.pins].sort((a, b) => a.sort_order - b.sort_order),
    [route.pins],
  )
  const [startPinOrder, setStartPinOrder] = useState(sortedPins[0]?.sort_order ?? 1)
  /** When set, PLAY starts GPS at this chainage (km jump) instead of PIN approach lead. */
  const [startChainageMeters, setStartChainageMeters] = useState<number | null>(null)
  const [startKmInput, setStartKmInput] = useState('0')
  /** Selected cruise ceiling; live speed adapts 20↔this based on distance to next PIN. */
  const [speedKmh, setSpeedKmh] = useState<DemoSpeedKmh>(DEFAULT_DEMO_SPEED_KMH)
  const [timeScale, setTimeScale] = useState<DemoTimeScale>(DEFAULT_DEMO_TIME_SCALE)
  const [liveSpeedKmh, setLiveSpeedKmh] = useState(DEMO_NEAR_PIN_SPEED_KMH)
  const [running, setRunning] = useState(false)
  const [seekingNextPin, setSeekingNextPin] = useState(false)
  const [nextPinOrder, setNextPinOrder] = useState<number | null>(startPinOrder)
  const [status, setStatus] = useState('მზადაა')
  const chainageRef = useRef(0)
  const cruiseSpeedRef = useRef(speedKmh)
  const liveSpeedRef = useRef(DEMO_NEAR_PIN_SPEED_KMH)
  const timeScaleRef = useRef(timeScale)
  const timerRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const stopAtPinRef = useRef<number | null>(null)
  const controlsRef = useRef<PreviewDemoControls | null>(controls)
  const totalKm = geometry.totalLengthMeters / 1000

  cruiseSpeedRef.current = speedKmh
  timeScaleRef.current = timeScale
  controlsRef.current = controls

  const publishAt = useCallback(
    (chainageMeters: number, speedForFixKmh: number = liveSpeedRef.current) => {
      const projection = positionAtChainage(geometry, chainageMeters)
      chainageRef.current = projection.chainageMeters
      liveSpeedRef.current = speedForFixKmh
      source.publish(gpsPosition(geometry, projection, speedForFixKmh))
      return projection
    },
    [geometry, source],
  )

  /** Park demo GPS on the PIN itself so Auto დაწყება/გაგრძელება picks that unfinished PIN. */
  const publishPreviewAtPin = useCallback(
    (pinOrder: number) => {
      if (controlsRef.current?.isActive()) return
      try {
        const priorOrder = [...route.pins]
          .map((pin) => pin.sort_order)
          .filter((order) => order < pinOrder)
          .sort((a, b) => b - a)[0]
        const after =
          priorOrder !== undefined
            ? resolveDemoPinChainage(geometry, route.pins, priorOrder, 0) ?? 0
            : 0
        const pinChainage = demoPinChainageMeters(route, geometry, pinOrder, after)
        liveSpeedRef.current = DEMO_NEAR_PIN_SPEED_KMH
        setLiveSpeedKmh(DEMO_NEAR_PIN_SPEED_KMH)
        // Pin pick clears km-jump; PLAY then uses PIN approach unless user types a კმ again.
        setStartChainageMeters(null)
        setStartKmInput('0')
        // Exact pin chainage (not approach lead) — lead would sit nearer the previous PIN.
        publishAt(pinChainage, DEMO_NEAR_PIN_SPEED_KMH)
        setStatus(`მზადაა · GPS PIN ${pinOrder}-თან · შემდეგი PIN ${pinOrder}`)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'DEMO GPS პოზიცია ვერ დაყენდა')
      }
    },
    [geometry, publishAt, route],
  )

  /** Park at along-route km and select the next PIN at/after that point (demo-only). */
  const seekToKm = useCallback(
    (rawKm: number, labelKm?: string) => {
      if (controlsRef.current?.isActive()) {
        setStatus('სესია აქტიურია — კმ-ზე გადასვლა მხოლოდ PLAY-მდე (RESET DEMO და მერე)')
        return null
      }
      if (!Number.isFinite(rawKm)) {
        setStatus('კილომეტრი არასწორია')
        return null
      }
      const km = Math.max(0, Math.min(rawKm, totalKm))
      const shown = labelKm?.trim() || km.toFixed(1)
      const chainage = km * 1000
      const next = resolveDemoNextPinAfterChainage(geometry, route.pins, chainage)
      liveSpeedRef.current = DEMO_NEAR_PIN_SPEED_KMH
      setLiveSpeedKmh(DEMO_NEAR_PIN_SPEED_KMH)
      setStartChainageMeters(chainage)
      setStartKmInput(shown)
      publishAt(chainage, DEMO_NEAR_PIN_SPEED_KMH)
      if (!next) {
        setStatus(`მზადაა · ${shown} კმ · შემდეგი PIN აღარ არის (ტრასის ბოლო)`)
        return { km, chainage, pinOrder: null as number | null, shown }
      }
      setStartPinOrder(next.sortOrder)
      setNextPinOrder(next.sortOrder)
      setStatus(`მზადაა · ${shown} კმ · შემდეგი PIN ${next.sortOrder}`)
      return { km, chainage, pinOrder: next.sortOrder, shown }
    },
    [geometry, publishAt, route.pins, totalKm],
  )

  const pause = useCallback((message = 'შეჩერებულია') => {
    runningRef.current = false
    stopAtPinRef.current = null
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setSeekingNextPin(false)
    setRunning(false)
    setStatus(message)
  }, [])

  const scheduleFix = useCallback(() => {
    if (!runningRef.current) return

    // Pre-compute live speed for tick spacing (20 near PIN, up to cruise on open road).
    const apiPreview = controlsRef.current
    const previewPinOrder = apiPreview?.nextPinOrder() ?? null
    let previewPinChainage: number | null = null
    if (previewPinOrder !== null) {
      try {
        previewPinChainage = demoPinChainageMeters(
          route,
          geometry,
          previewPinOrder,
          chainageRef.current,
        )
      } catch {
        previewPinChainage = null
      }
    }
    const previewDistance =
      previewPinChainage !== null ? Math.max(0, previewPinChainage - chainageRef.current) : null
    const previewLiveSpeed = demoAdaptiveSpeedKmh(previewDistance, cruiseSpeedRef.current)
    const tickMs = demoTickIntervalForSpeed(previewLiveSpeed, timeScaleRef.current)

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

      let nextPinChainage: number | null = null
      if (currentPinOrder !== null) {
        try {
          nextPinChainage = demoPinChainageMeters(
            route,
            geometry,
            currentPinOrder,
            chainageRef.current,
          )
        } catch {
          nextPinChainage = null
        }
      }

      const distanceToPin =
        nextPinChainage !== null
          ? Math.max(0, nextPinChainage - chainageRef.current)
          : null
      const liveSpeed = demoAdaptiveSpeedKmh(distanceToPin, cruiseSpeedRef.current)
      liveSpeedRef.current = liveSpeed
      setLiveSpeedKmh(liveSpeed)

      // Wait for audio without reversing — keep the last forward pose on the route line.
      if (audioEngine.isBusy() && distanceToPin !== null && distanceToPin <= DEMO_PIN_HOLD_SLACK_METERS) {
        setStatus(`აუდიოს დასრულებას ველოდები · ${Math.round(liveSpeed)} კმ/სთ`)
        scheduleFix()
        return
      }

      const requested = demoAdvanceMeters(liveSpeed, timeScaleRef.current, tickMs)
      const advance = demoAdvanceCappedToNextPin(
        chainageRef.current,
        requested,
        nextPinChainage,
      )

      if (advance <= 0 || chainageRef.current >= geometry.totalLengthMeters) {
        pause('მარშრუტის ბოლო წერტილი მიღწეულია')
        return
      }

      const microChainages = demoMicroChainages(
        chainageRef.current,
        advance,
        geometry.totalLengthMeters,
      )

      if (microChainages.length === 0) {
        pause('მარშრუტის ბოლო წერტილი მიღწეულია')
        return
      }

      const nextChainage = microChainages[0]!
      // Always forward along the route line — never reverse (prevents map spin at PIN 1).
      if (nextChainage < chainageRef.current) {
        scheduleFix()
        return
      }
      const projection = publishAt(nextChainage, liveSpeed)
      const pinAfter = api?.nextPinOrder() ?? null
      setNextPinOrder(pinAfter)

      const stopTarget = stopAtPinRef.current
      if (stopTarget !== null && pinAfter !== stopTarget) {
        pause(`PIN ${stopTarget} დასრულდა — აუდიო დასრულებულია`)
        return
      }

      if (nextChainage >= geometry.totalLengthMeters) {
        pause('მარშრუტის ბოლო წერტილი მიღწეულია')
        return
      }

      setStatus(
        `GPS fix · ${projection.position[0].toFixed(6)}, ${projection.position[1].toFixed(6)} · ${Math.round(liveSpeed)} კმ/სთ · ${timeScaleRef.current}x`,
      )
      scheduleFix()
    }, tickMs)
  }, [geometry, pause, publishAt, route, source])

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

    // PLAY reads the კმ field directly — no need to press „კმ-ზე“ first.
    const typedRaw = startKmInput.replace(',', '.').trim()
    const typedKm = typedRaw === '' ? NaN : Number(typedRaw)
    const wantKm =
      (Number.isFinite(typedKm) && typedKm > 0) ||
      (startChainageMeters !== null && startChainageMeters > 0)

    let playPinOrder = api.manualStartPinOrder() ?? startPinOrder
    let startChainage = 0
    let kmLabel: string | null = null

    if (wantKm) {
      const rawKm =
        Number.isFinite(typedKm) && typedKm > 0
          ? typedKm
          : (startChainageMeters as number) / 1000
      const jumped = seekToKm(rawKm, Number.isFinite(typedKm) && typedKm > 0 ? typedRaw : undefined)
      if (!jumped || jumped.pinOrder === null) {
        setStatus(
          jumped
            ? `${jumped.shown} კმ-ზე შემდეგი PIN აღარ არის`
            : 'კილომეტრზე გადასვლა ვერ მოხერხდა',
        )
        return
      }
      playPinOrder = jumped.pinOrder
      startChainage = jumped.chainage
      kmLabel = jumped.shown
    } else {
      const manualStart = api.manualStartPinOrder()
      if (manualStart !== null && manualStart !== startPinOrder) {
        setStartPinOrder(manualStart)
        setNextPinOrder(manualStart)
        playPinOrder = manualStart
      }
    }

    try {
      pause('ვიწყებ DEMO GPS-ს')
      if (!wantKm) {
        const priorOrder = [...route.pins]
          .map((pin) => pin.sort_order)
          .filter((order) => order < playPinOrder)
          .sort((a, b) => b - a)[0]
        const after =
          priorOrder !== undefined
            ? resolveDemoPinChainage(geometry, route.pins, priorOrder, 0) ?? 0
            : 0
        const pinChainage = demoPinChainageMeters(route, geometry, playPinOrder, after)
        startChainage = Math.max(0, pinChainage - DEMO_START_APPROACH_LEAD_METERS)
      }
      const startProjection = positionAtChainage(geometry, startChainage)
      chainageRef.current = startProjection.chainageMeters
      source.clear()
      liveSpeedRef.current = DEMO_NEAR_PIN_SPEED_KMH
      setLiveSpeedKmh(DEMO_NEAR_PIN_SPEED_KMH)
      source.publish(gpsPosition(geometry, startProjection, DEMO_NEAR_PIN_SPEED_KMH))
      await api.startAtPin(playPinOrder)
      setNextPinOrder(playPinOrder)
      setStatus(
        kmLabel !== null
          ? `DEMO აქტიურია ${kmLabel} კმ-დან · PIN ${playPinOrder} · ${DEMO_NEAR_PIN_SPEED_KMH}→${cruiseSpeedRef.current} კმ/სთ · ${timeScaleRef.current}x`
          : `DEMO აქტიურია PIN ${playPinOrder}-დან · ${DEMO_NEAR_PIN_SPEED_KMH}→${cruiseSpeedRef.current} კმ/სთ · ${timeScaleRef.current}x`,
      )
      runningRef.current = true
      setRunning(true)
      scheduleFix()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'DEMO ვერ გაეშვა')
    }
  }, [
    geometry,
    pause,
    route,
    scheduleFix,
    seekToKm,
    source,
    startChainageMeters,
    startKmInput,
    startPinOrder,
  ])

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
    setStatus(`გრძელდება · ${DEMO_NEAR_PIN_SPEED_KMH}→${cruiseSpeedRef.current} კმ/სთ · ${timeScaleRef.current}x`)
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
      const targetChainage = demoPinChainageMeters(route, geometry, targetOrder, chainageRef.current)
      if (targetChainage < chainageRef.current) {
        setStatus(`PIN ${targetOrder} მარშრუტის მიმდინარე პოზიციის უკანაა`)
        return
      }
      stopAtPinRef.current = targetOrder
      setSeekingNextPin(true)
      setStatus(`GPS-ით მივდივარ PIN ${targetOrder}-მდე`)
      if (!runningRef.current) {
        runningRef.current = true
        setRunning(true)
        scheduleFix()
      }
    } catch (error) {
      setSeekingNextPin(false)
      setStatus(error instanceof Error ? error.message : 'PIN-ის ტრასაზე განთავსება ვერ მოხერხდა')
    }
  }, [geometry, route, scheduleFix])

  const reset = useCallback(() => {
    pause('DEMO გადატვირთულია')
    source.clear()
    chainageRef.current = 0
    setStartChainageMeters(null)
    setStartKmInput('0.0')
    controlsRef.current?.reset()
    const firstOrder = sortedPins[0]?.sort_order ?? 1
    setStartPinOrder(firstOrder)
    setNextPinOrder(firstOrder)
    publishPreviewAtPin(firstOrder)
  }, [pause, publishPreviewAtPin, sortedPins, source])

  useEffect(() => {
    const firstOrder = sortedPins[0]?.sort_order ?? 1
    setStartPinOrder(firstOrder)
    setNextPinOrder(firstOrder)
    setStartChainageMeters(null)
    setStartKmInput('0.0')
    pause('მზადაა')
    source.clear()
    publishPreviewAtPin(firstOrder)
    return () => {
      pause('შეჩერებულია')
      source.clear()
    }
  }, [route.slug, sortedPins, pause, source, publishPreviewAtPin])

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
          პროგრესი იზოლირებულია DEMO სესიაში. სიჩქარე/სწრაფი რეჟიმი მხოლოდ ამ პანელს ეხება.
        </p>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'end' }}>
        <label>
          მარშრუტი
          <select
            aria-label="DEMO მარშრუტი"
            value={route.slug}
            disabled={Boolean(controls?.isActive())}
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
            disabled={Boolean(controls?.isActive())}
            onChange={(event) => {
              const selectedOrder = Number(event.currentTarget.value)
              setStartPinOrder(selectedOrder)
              setNextPinOrder(selectedOrder)
              publishPreviewAtPin(selectedOrder)
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
          საწყისი კმ (0–{totalKm.toFixed(1)})
          <span style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <input
              aria-label="DEMO საწყისი კმ"
              data-testid="demo-start-km"
              type="number"
              min={0}
              max={Number(totalKm.toFixed(1))}
              step={0.1}
              value={startKmInput}
              disabled={Boolean(controls?.isActive())}
              onChange={(event) => setStartKmInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  seekToKm(Number(startKmInput.replace(',', '.')))
                }
              }}
              style={{ width: '5.5rem' }}
            />
            <button
              type="button"
              data-testid="demo-seek-km"
              disabled={Boolean(controls?.isActive())}
              onClick={() => seekToKm(Number(startKmInput.replace(',', '.')))}
            >
              კმ-ზე
            </button>
          </span>
        </label>
        <label>
          კრუიზი (ცარიელზე) · ახლა {Math.round(liveSpeedKmh)} კმ/სთ
          <select
            aria-label="DEMO სიჩქარე"
            data-testid="demo-speed-kmh"
            value={speedKmh}
            onChange={(event) => setSpeedKmh(Number(event.currentTarget.value) as DemoSpeedKmh)}
          >
            {DEMO_SPEED_KMH_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {DEMO_NEAR_PIN_SPEED_KMH}→{option} კმ/სთ
              </option>
            ))}
          </select>
        </label>
        <label>
          სწრაფი რეჟიმი
          <select
            aria-label="DEMO სწრაფი რეჟიმი"
            data-testid="demo-time-scale"
            value={timeScale}
            onChange={(event) => setTimeScale(Number(event.currentTarget.value) as DemoTimeScale)}
          >
            {DEMO_TIME_SCALE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}x
              </option>
            ))}
          </select>
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
          disabled={!controls?.isActive() || nextPinOrder === null || seekingNextPin}
        >
          NEXT PIN
        </button>
        <button type="button" onClick={reset}>
          RESET DEMO
        </button>
      </div>
      <p data-testid="demo-selected-km" style={{ margin: 0, fontWeight: 600 }}>
        არჩეული კმ: {startKmInput.trim() === '' ? '—' : `${startKmInput.trim()} კმ`}
      </p>
      <p role="status" aria-live="polite" style={{ margin: 0 }}>
        {status}
        {nextPinOrder !== null ? ` · შემდეგი PIN ${nextPinOrder}` : ' · შემდეგი PIN: FINISH'}
      </p>
    </section>
  )
}
