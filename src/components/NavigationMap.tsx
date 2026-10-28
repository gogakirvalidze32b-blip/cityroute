import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { MapContainer, Marker, Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { RoutePolyline } from '@/components/RoutePolyline'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  distanceToPinMeters,
  formatGpsError,
  getGpsEnvironmentIssue,
  headingMatches,
  requestGpsOnce,
  watchGps,
  requestWakeLock,
  type GpsPosition,
  type LatLng,
} from '@/lib/gps'
import {
  formatDistance,
  formatDuration,
  formatSpeed,
  formatClock,
  gpsToLatLng,
  loadSessionHistory,
  msToKmh,
  resolveHeading,
  routeLengthMeters,
  routeProgressInfo,
  saveSessionSummary,
  shouldAutoFinish,
  splitRouteAt,
  type RouteSessionSummary,
} from '@/lib/route-nav'
import { audioEngine } from '@/lib/audio'
import { MapBasemapLayers } from '@/components/MapBasemapLayers'
import { MAP_TILES } from '@/lib/map-tiles'
import type { PinRow, RouteWithPins } from '@/types/database'
import { TELAVI_CENTER, YANDEX_STREET_ZOOM } from '@/data/telavi-routes'

type NavPhase = 'preview' | 'active' | 'summary'

const SUMMARY_FIT_MAX_ZOOM = 14

function createNavArrowIcon(counterHeading: number) {
  return L.divIcon({
    className: 'nav-arrow-marker',
    html: `<div class="nav-arrow-wrap" style="transform:rotate(${counterHeading}deg)"><div class="nav-arrow"></div><div class="nav-arrow-dot"></div></div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 22],
  })
}

const previewUserIcon = L.divIcon({
  className: 'user-marker',
  html: '<div class="user-dot"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
})

/** Driver icon ~74% from top — Yandex Taxi style */
const USER_SCREEN_Y = 0.74

function RouteEndpoint({ position, kind }: { position: LatLng; kind: 'start' | 'end' }) {
  const start = kind === 'start'
  return (
    <CircleMarker
      center={position}
      radius={12}
      pathOptions={{
        color: start ? '#15803d' : '#b91c1c',
        fillColor: start ? '#22c55e' : '#ef4444',
        fillOpacity: 1,
        weight: 3,
      }}
    >
      <Tooltip permanent direction="top" offset={[0, -10]} className="route-ep-tip">
        {start ? 'დაწყება' : 'დასრულება'}
      </Tooltip>
    </CircleMarker>
  )
}

function RouteEndpoints({ start, finish }: { start: LatLng; finish: LatLng }) {
  return (
    <>
      <RouteEndpoint position={start} kind="start" />
      <RouteEndpoint position={finish} kind="end" />
    </>
  )
}

function resetMapRotation(map: L.Map) {
  const pane = map.getPane('mapPane')
  if (!pane) return
  pane.style.transform = ''
  pane.style.transformOrigin = ''
}

function FitRoute({ line, enabled }: { line: LatLng[]; enabled: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (!enabled || line.length < 2) return
    resetMapRotation(map)
    map.fitBounds(L.latLngBounds(line.map(([lat, lng]) => [lat, lng])), {
      padding: [32, 32],
      maxZoom: SUMMARY_FIT_MAX_ZOOM,
      animate: false,
    })
  }, [map, line, enabled])
  return null
}

function MapSizeFix() {
  const map = useMap()
  useEffect(() => {
    let frame = 0
    const invalidate = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false, debounceMoveend: true })
      })
    }
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(invalidate)
      : null

    observer?.observe(map.getContainer())
    window.addEventListener('resize', invalidate, { passive: true })
    window.visualViewport?.addEventListener('resize', invalidate, { passive: true })
    document.addEventListener('fullscreenchange', invalidate)
    invalidate()

    return () => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', invalidate)
      window.visualViewport?.removeEventListener('resize', invalidate)
      document.removeEventListener('fullscreenchange', invalidate)
    }
  }, [map])
  return null
}

function StreetLevelMap({ center, enabled }: { center: LatLng | undefined; enabled: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (!enabled || !center) return
    resetMapRotation(map)
    map.setView(center, YANDEX_STREET_ZOOM, { animate: false })
  }, [map, center, enabled])
  return null
}

/** Yandex-style camera — pauses when user pans/zooms (Google Maps behavior). */
function NavigationCamera({
  position,
  heading,
  navigating,
  gpsFollow,
  followPaused,
  followResetKey,
}: {
  position: LatLng | null
  heading: number
  navigating: boolean
  gpsFollow: boolean
  followPaused: boolean
  followResetKey: number
}) {
  const map = useMap()
  const headingRef = useRef(heading)
  const navZoomRef = useRef(YANDEX_STREET_ZOOM)
  const rotationUpdaterRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    headingRef.current = heading
    rotationUpdaterRef.current?.()
  }, [heading])

  useEffect(() => {
    navZoomRef.current = YANDEX_STREET_ZOOM
  }, [followResetKey])

  useEffect(() => {
    const onZoomEnd = () => {
      navZoomRef.current = map.getZoom()
    }
    map.on('zoomend', onZoomEnd)
    return () => {
      map.off('zoomend', onZoomEnd)
    }
  }, [map])

  useEffect(() => {
    if (!position || followPaused) return

    const followWithOffset = navigating || gpsFollow
    if (!followWithOffset) return

    const zoom = navigating
      ? Math.max(navZoomRef.current, YANDEX_STREET_ZOOM)
      : YANDEX_STREET_ZOOM
    const size = map.getSize()
    if (size.x === 0 || size.y === 0) {
      map.invalidateSize()
      return
    }

    const projected = map.project(position, zoom)
    projected.y += size.y * (0.5 - USER_SCREEN_Y)
    const targetCenter = map.unproject(projected, zoom)
    const currentCenter = map.project(map.getCenter(), zoom)
    const zoomChanged = Math.abs(map.getZoom() - zoom) > 0.01
    if (zoomChanged || currentCenter.distanceTo(projected) >= 1) {
      map.setView(targetCenter, zoom, { animate: true, duration: 0.2 })
    }
  }, [map, position, navigating, gpsFollow, followPaused])

  useEffect(() => {
    const applyRotation = () => {
      if (!navigating || followPaused) {
        resetMapRotation(map)
        return
      }
      const pane = map.getPane('mapPane')
      if (!pane) return
      // Rotate around screen center, not GPS position
      const center = map.getSize().divideBy(2)
      pane.style.transformOrigin = `${center.x}px ${center.y}px`
      pane.style.transform = `rotate(${-headingRef.current}deg)`
    }

    rotationUpdaterRef.current = applyRotation
    if (!navigating || followPaused) {
      resetMapRotation(map)
    } else {
      applyRotation()
      map.on('move', applyRotation)
      map.on('moveend', applyRotation)
    }
    return () => {
      rotationUpdaterRef.current = null
      map.off('move', applyRotation)
      map.off('moveend', applyRotation)
    }
  }, [map, navigating, followPaused])

  useEffect(() => () => resetMapRotation(map), [map])

  return null
}

function MapGestureSetup({ onUserPanZoom }: { onUserPanZoom: () => void }) {
  const map = useMap()

  useEffect(() => {
    map.options.zoomSnap = 0.25
    map.options.zoomDelta = 0.5
    map.options.wheelPxPerZoomLevel = 90
    map.options.wheelDebounceTime = 30
    map.touchZoom?.enable()
    map.dragging?.enable()
    map.scrollWheelZoom?.enable()
    map.doubleClickZoom?.enable()
  }, [map])

  useEffect(() => {
    const pause = () => onUserPanZoom()
    map.on('dragstart', pause)
    map.on('zoomstart', pause)
    return () => {
      map.off('dragstart', pause)
      map.off('zoomstart', pause)
    }
  }, [map, onUserPanZoom])

  return null
}

function MapZoomControls({ hidden }: { hidden?: boolean }) {
  const map = useMap()
  if (hidden) return null

  return (
    <div className="map-zoom-controls">
      <button type="button" aria-label="ზუმი +" onClick={() => map.zoomIn(0.5)}>
        +
      </button>
      <button type="button" aria-label="ზუმი −" onClick={() => map.zoomOut(0.5)}>
        −
      </button>
    </div>
  )
}

type Props = {
  route: RouteWithPins
  practiceMode?: boolean
  onPhaseChange?: (phase: NavPhase) => void
}

export function NavigationMap({ route, practiceMode = false, onPhaseChange }: Props) {
  const [phase, setPhase] = useState<NavPhase>('preview')
  const [rawPos, setRawPos] = useState<GpsPosition | null>(null)
  const [userPos, setUserPos] = useState<LatLng | null>(null)
  const [heading, setHeading] = useState(0)
  const [gpsError, setGpsError] = useState<string | null>(() => getGpsEnvironmentIssue())
  const [gpsStarted, setGpsStarted] = useState(false)
  const [gpsStarting, setGpsStarting] = useState(false)
  const [triggered, setTriggered] = useState<Set<string>>(() => new Set())
  const [nextPin, setNextPin] = useState<PinRow | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [liveDistanceM, setLiveDistanceM] = useState(0)
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0)
  const [routeProgressPct, setRouteProgressPct] = useState(0)
  const [summary, setSummary] = useState<RouteSessionSummary | null>(null)
  const [lastSessions, setLastSessions] = useState<RouteSessionSummary[]>(() => loadSessionHistory(route.id))
  const [mapFollowPaused, setMapFollowPaused] = useState(false)
  const [followResetKey, setFollowResetKey] = useState(0)

  const pauseMapFollow = useCallback(() => setMapFollowPaused(true), [])
  const resumeMapFollow = useCallback(() => {
    setMapFollowPaused(false)
    setFollowResetKey((k) => k + 1)
  }, [])

  const triggeredRef = useRef<Set<string>>(new Set())
  const releaseWake = useRef<(() => void) | null>(null)
  const prevRawRef = useRef<LatLng | null>(null)
  const movedSinceGpsRef = useRef(0)
  const sessionRef = useRef({
    startedAt: 0,
    distanceTraveledM: 0,
    maxSpeedKmh: 0,
    routeLengthM: 0,
  })

  const polyline = route.polyline as LatLng[]
  const sortedPins = useMemo(
    // CRITICAL: Pins must be sorted by sort_order to enforce STRICT SEQUENTIAL triggering
    // This ensures PIN #1 triggers before #2, #2 before #3, etc.
    // Order is maintained across all routes (Route 1, 2, 3, 4)
    () => [...route.pins].sort((a, b) => a.sort_order - b.sort_order),
    [route.id, route.pins],
  )
  const pinsActive = sortedPins.length > 0
  const navigating = phase === 'active'
  const routeStart = polyline[0]
  const routeFinish = polyline[polyline.length - 1]
  const mapCenter: LatLng = routeStart ?? [TELAVI_CENTER.lat, TELAVI_CENTER.lng]
  const showEndpoints = polyline.length >= 2 && routeStart && routeFinish && !navigating
  const streetLevelPreview = phase === 'preview' && !navigating && !gpsStarted
  const routeSplit = userPos ? splitRouteAt(userPos, polyline) : null
  const navArrowIcon = useMemo(() => createNavArrowIcon(heading), [heading])

  useEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  useEffect(() => {
    const urls = sortedPins.map((p) => p.audio_url).filter(Boolean) as string[]
    const preload = () => audioEngine.preloadAll(urls)
    let idleHandle: ReturnType<typeof setTimeout> | number
    let usedIdleCallback = false
    if (typeof window.requestIdleCallback === 'function') {
      usedIdleCallback = true
      idleHandle = window.requestIdleCallback(preload, { timeout: 2500 })
    } else {
      idleHandle = window.setTimeout(preload, 1200)
    }
    return () => {
      if (usedIdleCallback) window.cancelIdleCallback(idleHandle as number)
      else clearTimeout(idleHandle)
    }
  }, [route.id, sortedPins])

  useEffect(() => {
    void requestWakeLock().then((release) => {
      releaseWake.current = release
    })
    return () => {
      releaseWake.current?.()
      audioEngine.stopAll()
    }
  }, [])

  useEffect(() => {
    setLastSessions(loadSessionHistory(route.id))
    triggeredRef.current = new Set()
    setTriggered(new Set())
    setNextPin(sortedPins[0] ?? null)
    setPhase('preview')
    setSummary(null)
    setMapFollowPaused(false)
    prevRawRef.current = null
    movedSinceGpsRef.current = 0
  }, [route.id, sortedPins])

  useEffect(() => {
    if (phase !== 'active') return
    const startedAt = sessionRef.current.startedAt
    const tick = () => setElapsedMs(Date.now() - startedAt)
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  const finishSession = useCallback(
    (progressPct: number) => {
      const session = sessionRef.current
      const finishedAt = Date.now()
      const elapsed = finishedAt - session.startedAt
      const avgSpeedKmh = elapsed > 0 ? (session.distanceTraveledM / 1000) / (elapsed / 3600000) : 0

      const result: RouteSessionSummary = {
        routeId: route.id,
        routeName: route.name_ka,
        startedAt: session.startedAt,
        finishedAt,
        elapsedMs: elapsed,
        distanceTraveledM: session.distanceTraveledM,
        routeLengthM: session.routeLengthM,
        routeProgressPct: progressPct,
        avgSpeedKmh,
        maxSpeedKmh: session.maxSpeedKmh,
      }

      saveSessionSummary(result)
      setLastSessions(loadSessionHistory(route.id))
      setSummary(result)
      setMapFollowPaused(false)
      setPhase('summary')
      prevRawRef.current = null
      releaseWake.current?.()
      releaseWake.current = null
    },
    [route.id, route.name_ka],
  )

  const beginNavigationSession = useCallback((at: LatLng) => {
    sessionRef.current = {
      startedAt: Date.now(),
      distanceTraveledM: 0,
      maxSpeedKmh: 0,
      routeLengthM: routeLengthMeters(polyline),
    }
    prevRawRef.current = at
    movedSinceGpsRef.current = 0
    setLiveDistanceM(0)
    setCurrentSpeedKmh(0)
    setElapsedMs(0)
    setSummary(null)
    setMapFollowPaused(false)
    setPhase('active')
  }, [polyline])

  useEffect(() => {
    if (!gpsStarted) return

    return watchGps(
      (pos) => {
        setRawPos(pos)
        setGpsError(null)

        const raw = gpsToLatLng(pos)
        setUserPos(raw)

        const h = resolveHeading(pos, prevRawRef.current, raw, polyline)
        setHeading(h)

        const progress = routeProgressInfo(raw, polyline)
        setRouteProgressPct(progress.pct)

        const prev = prevRawRef.current
        if (prev) {
          const step = distanceToPinMeters(prev, raw)
          if (step > 1.5 && step < 120) {
            movedSinceGpsRef.current += step
          }
        }

        if (phase === 'active') {
          if (prev) {
            const step = distanceToPinMeters(prev, raw)
            if (step > 2 && step < 120) {
              sessionRef.current.distanceTraveledM += step
            }
          }

          const speedKmh = msToKmh(pos.speed)
          setCurrentSpeedKmh(speedKmh)
          setLiveDistanceM(sessionRef.current.distanceTraveledM)
          if (speedKmh > sessionRef.current.maxSpeedKmh) {
            sessionRef.current.maxSpeedKmh = speedKmh
          }

          if (
            routeFinish &&
            Date.now() - sessionRef.current.startedAt > 15000 &&
            shouldAutoFinish(progress, sessionRef.current.distanceTraveledM, routeFinish, raw)
          ) {
            finishSession(progress.pct)
          }
        }

        prevRawRef.current = raw

        // ============================================================
        // STRICT SEQUENTIAL PIN LOGIC (same as ExamDriveSession)
        // ============================================================
        const triggeredCount = triggeredRef.current.size
        const totalPins = sortedPins.length
        
        // Find the FIRST untriggered pin in sequence
        const nextPinIndex = sortedPins.findIndex((p) => !triggeredRef.current.has(p.id))
        const pending = nextPinIndex >= 0 ? sortedPins[nextPinIndex] : null
        
        setNextPin(pending ?? null)
        
        // Log current state
        if (pending) {
          console.log('[PIN SEQUENCE]',
            route.slug.toUpperCase(),
            '| Expected: #' + (nextPinIndex + 1),
            '| ID:', pending.id,
            '| Progress:', triggeredCount + '/' + totalPins
          )
        }
        
        // Check if user is near ANY other pin (for diagnostic logging only)
        sortedPins.forEach((pin, idx) => {
          if (idx === nextPinIndex || triggeredRef.current.has(pin.id)) return
          
          const distToOther = distanceToPinMeters(raw, [pin.lat, pin.lng])
          
          if (distToOther <= 50) {
            console.log('[PIN SEQUENCE]',
              route.slug.toUpperCase(),
              '| IGNORE: PIN #' + (idx + 1),
              '| Distance:', Math.round(distToOther) + 'm',
              '| Reason: NOT NEXT PIN',
              '| Expected: #' + (nextPinIndex + 1)
            )
          }
        })

        if (practiceMode || !pending || phase !== 'active') return

        const dist = distanceToPinMeters(raw, [pending.lat, pending.lng])
        
        console.log('[PIN SEQUENCE]',
          route.slug.toUpperCase(),
          '| Expected: #' + (nextPinIndex + 1),
          '| Distance:', Math.round(dist) + 'm',
          '| Status:', dist <= pending.trigger_distance_m ? 'IN RANGE' : 'WAITING'
        )
        
        if (
          dist <= pending.trigger_distance_m &&
          headingMatches(raw, [pending.lat, pending.lng], pos.heading)
        ) {
          console.log('[PIN SEQUENCE]',
            route.slug.toUpperCase(),
            '| 🔊 PIN #' + (nextPinIndex + 1) + ' TRIGGERED!',
            '| Audio:', pending.instruction_ka,
            '| Progress:', (triggeredCount + 1) + '/' + totalPins,
            '| Next expected: #' + (nextPinIndex + 2)
          )
          triggeredRef.current.add(pending.id)
          setTriggered(new Set(triggeredRef.current))
          void audioEngine.play(pending.audio_url, pending.id, pending.instruction_ka)
        }
      },
      (err) => setGpsError(formatGpsError(err)),
    )
  }, [
    gpsStarted,
    polyline,
    sortedPins,
    practiceMode,
    phase,
    routeFinish,
    finishSession,
    route.slug,
  ])

  async function enableGps(): Promise<boolean> {
    setGpsStarting(true)
    setGpsError(null)
    movedSinceGpsRef.current = 0
    try {
      const pos = await requestGpsOnce()
      const raw = gpsToLatLng(pos)
      setRawPos(pos)
      setUserPos(raw)
      setHeading(resolveHeading(pos, null, raw, polyline))
      prevRawRef.current = raw
      setGpsStarted(true)
      return true
    } catch (err) {
      setGpsError(err instanceof Error ? err.message : 'GPS შეცდომა')
      return false
    } finally {
      setGpsStarting(false)
    }
  }

  function startNavigation() {
    if (!userPos) return
    beginNavigationSession(userPos)
  }

  function stopNavigation() {
    finishSession(routeProgressPct)
  }

  function restartPreview() {
    setPhase('preview')
    setSummary(null)
    setMapFollowPaused(false)
    prevRawRef.current = userPos
    movedSinceGpsRef.current = 0
  }

  const showUserOnMap = gpsStarted && userPos

  return (
    <div className={`nav-shell${navigating ? ' nav-shell--driving' : ''}${phase === 'summary' ? ' nav-shell--summary' : ''}`}>
      {navigating && (
        <>
          <div className="nav-drive-bar">
            <div className="nav-drive-cell">
              <small>სიჩქ.</small>
              <strong>{formatSpeed(currentSpeedKmh)}</strong>
            </div>
            <div className="nav-drive-cell nav-drive-cell--time">
              <small>დრო</small>
              <strong>{formatDuration(elapsedMs)}</strong>
            </div>
            <div className="nav-drive-cell">
              <small>გავლილი</small>
              <strong>{formatDistance(liveDistanceM)}</strong>
            </div>
          </div>
          <button type="button" className="nav-finish-fab" onClick={stopNavigation}>
            დასრულება
          </button>
        </>
      )}

      {mapFollowPaused && userPos && phase !== 'summary' && (
        <button type="button" className="map-recenter-btn" onClick={resumeMapFollow}>
          ⊕ ცენტრში
        </button>
      )}

      {!navigating && (
      <div className="nav-hud">
        {phase === 'preview' && (
          <>
            <div className="hud-row">
              <span className="gps-badge">{rawPos ? `±${Math.round(rawPos.accuracy)}m` : 'GPS...'}</span>
              {showEndpoints && <span className="progress-badge">{gpsStarted ? 'მზად' : 'GPS?'}</span>}
            </div>
            {pinsActive && nextPin && userPos && (
              <p className="next-instruction">
                {Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng]))}m — {nextPin.instruction_ka}
              </p>
            )}
            {!getGpsEnvironmentIssue() && !gpsStarted && (
              <button
                type="button"
                className="nav-start-btn gps-locate-btn"
                onClick={() => void enableGps()}
                disabled={gpsStarting}
              >
                {gpsStarting ? 'GPS იტვირთება...' : '📍 ლოკაციის ჩართვა'}
              </button>
            )}
            {gpsStarted && (
              <button
                type="button"
                className="nav-start-btn"
                onClick={startNavigation}
                disabled={!userPos}
              >
                ▶ მარშრუტის დაწყება
              </button>
            )}
            {gpsStarted && userPos && (
              <p className="session-hint">GPS მზადაა · დააჭირე დაწყებას</p>
            )}
            {lastSessions[0] && (
              <p className="session-hint">
                ბოლო: {formatDuration(lastSessions[0].elapsedMs)} · {formatDistance(lastSessions[0].distanceTraveledM)}
              </p>
            )}
          </>
        )}

        {gpsError && <p className="error-text">{gpsError}</p>}
      </div>
      )}

      {phase === 'summary' && summary && (
        <div className="nav-summary-overlay">
          <div className="session-summary session-summary--full">
            <p className="summary-route-name">{summary.routeName}</p>
            <h3>მარშრუტი დასრულდა</h3>
            <p className="summary-hero-time">{formatDuration(summary.elapsedMs)}</p>
            <div className="summary-grid summary-grid--full">
              <div><span>გავლილი მანძილი</span><strong>{formatDistance(summary.distanceTraveledM)}</strong></div>
              <div><span>მარშრუტის სიგრძე</span><strong>{formatDistance(summary.routeLengthM)}</strong></div>
              <div><span>საშუალო სიჩქარე</span><strong>{formatSpeed(summary.avgSpeedKmh)}</strong></div>
              <div><span>მაქს. სიჩქარე</span><strong>{formatSpeed(summary.maxSpeedKmh)}</strong></div>
              <div><span>მარშრუტის %</span><strong>{Math.round(summary.routeProgressPct)}%</strong></div>
              <div><span>დაწყება</span><strong>{formatClock(summary.startedAt)}</strong></div>
              <div><span>დასრულება</span><strong>{formatClock(summary.finishedAt)}</strong></div>
            </div>
            <button type="button" className="nav-start-btn summary-restart-btn" onClick={restartPreview}>
              თავიდან
            </button>
          </div>
        </div>
      )}

      <MapContainer
        key={route.id}
        center={mapCenter}
        zoom={YANDEX_STREET_ZOOM}
        className="map"
        zoomControl={false}
        scrollWheelZoom
        touchZoom
        dragging
        doubleClickZoom
        zoomSnap={0.25}
        zoomDelta={0.5}
        wheelPxPerZoomLevel={90}
        maxZoom={MAP_TILES.maxZoom}
        minZoom={10}
        bounceAtZoomLimits
      >
        <MapSizeFix />
        <StreetLevelMap center={mapCenter} enabled={streetLevelPreview} />
        <MapGestureSetup onUserPanZoom={pauseMapFollow} />
        <MapZoomControls hidden={phase === 'summary'} />
        <MapBasemapLayers tiles={MAP_TILES} detectRetina />

        {navigating && routeSplit ? (
          <>
            <RoutePolyline positions={routeSplit.passed} variant="passed" />
            <RoutePolyline positions={routeSplit.remaining} variant="active" />
          </>
        ) : (
          <RoutePolyline positions={polyline} variant="preview" />
        )}

        {showEndpoints && <RouteEndpoints start={routeStart} finish={routeFinish} />}

        {pinsActive && !navigating && sortedPins.map((pin) => (
          <Marker key={pin.id} position={[pin.lat, pin.lng]} />
        ))}
        {pinsActive && !navigating && sortedPins.map((pin) => (
          <Circle
            key={`c-${pin.id}`}
            center={[pin.lat, pin.lng]}
            radius={pin.trigger_distance_m}
            pathOptions={{ color: triggered.has(pin.id) ? '#22c55e' : '#38bdf8', fillOpacity: 0.08, weight: 1 }}
          />
        ))}

        {showUserOnMap && rawPos && !navigating && (
          <Circle
            center={userPos}
            radius={Math.max(8, rawPos.accuracy)}
            pathOptions={{ color: '#4285f4', fillColor: '#4285f4', fillOpacity: 0.12, weight: 1 }}
          />
        )}

        {showUserOnMap && (
          <Marker
            position={userPos}
            icon={navigating ? navArrowIcon : previewUserIcon}
            zIndexOffset={1000}
          />
        )}

        <FitRoute line={polyline} enabled={phase === 'summary'} />
        <NavigationCamera
          position={userPos}
          heading={heading}
          navigating={navigating}
          gpsFollow={gpsStarted && phase === 'preview'}
          followPaused={mapFollowPaused}
          followResetKey={followResetKey}
        />
      </MapContainer>
    </div>
  )
}
