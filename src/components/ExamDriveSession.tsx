import { useExamLayoutMode } from '@/hooks/useExamLayoutMode'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExamErrorGrid } from '@/components/ExamErrorGrid'
import { ExamLiveMap } from '@/components/ExamLiveMap'
import { ExamScoreboard } from '@/components/ExamScoreboard'
import { ExamSummary } from '@/components/ExamSummary'
import { ExamViewSwitcher, type ExamDriveView } from '@/components/ExamViewSwitcher'
import { GpsAccuracyBadge } from '@/components/GpsAccuracyBadge'
import { RoutePreviewMap } from '@/components/RoutePreviewMap'
import { usePlanFeatures } from '@/context/AuthContext'
import { audioEngine } from '@/lib/audio'
import {
  createExamSession,
  finishExamSession,
  formatExamDuration,
  loadExamHistory,
  recordExamError,
  recordSevereQuick,
  saveExamSummary,
  type ExamSessionSummary,
} from '@/lib/exam-session'
import {
  distanceToPinMeters,
  formatGpsError,
  getGpsEnvironmentIssue,
  hasGpsConsent,
  headingMatches,
  markGpsConsentGranted,
  clearGpsConsent,
  requestGpsOnce,
  requestWakeLock,
  shouldAutoStartGps,
  watchGps,
  type GpsPosition,
  type LatLng,
} from '@/lib/gps'
import {
  collectPreloadAudioUrls,
  enrichPinsWithLocalAudio,
  EXAM_START_AUDIO,
  EXAM_START_TEXT,
  EXAM_SUCCESS_AUDIO,
  EXAM_SUCCESS_TEXT,
  isStartPinAlreadyAnnounced,
} from '@/data/route-audio'
import { createSpeedTracker, gpsToLatLng, resolveExamSpeedKmh, resolveHeading } from '@/lib/route-nav'
import type { PinRow, RouteWithPins } from '@/types/database'

type Phase = 'preview' | 'active' | 'summary'

type Props = {
  route: RouteWithPins
  onPhaseChange?: (phase: Phase) => void
}

export function ExamDriveSession({ route, onPhaseChange }: Props) {
  const features = usePlanFeatures()
  const [phase, setPhase] = useState<Phase>('preview')
  const [driveView, setDriveView] = useState<ExamDriveView>('map')
  const [exam, setExam] = useState(() => createExamSession(route.id, route.name_ka))
  const [examSummary, setExamSummary] = useState<ExamSessionSummary | null>(null)
  const [lastHistory] = useState(() => loadExamHistory(route.id))

  const [gpsStarted, setGpsStarted] = useState(false)
  const [gpsStarting, setGpsStarting] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(() => getGpsEnvironmentIssue())
  const [rawPos, setRawPos] = useState<GpsPosition | null>(null)
  const [userPos, setUserPos] = useState<LatLng | null>(null)
  const [heading, setHeading] = useState(0)
  const [speedKmh, setSpeedKmh] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [nextPin, setNextPin] = useState<PinRow | null>(null)
  const [lastSpoken, setLastSpoken] = useState<string | null>(null)

  const triggeredRef = useRef<Set<string>>(new Set())
  const releaseWake = useRef<(() => void) | null>(null)
  const sessionStartRef = useRef(0)
  const prevGpsRef = useRef<GpsPosition | null>(null)
  const speedTrackerRef = useRef(createSpeedTracker())

  const polyline = route.polyline as LatLng[]
  const sortedPins = useMemo(
    () => [...route.pins].sort((a, b) => a.sort_order - b.sort_order),
    [route.id, route.pins],
  )
  const voicePins = useMemo(
    () => enrichPinsWithLocalAudio(route.slug, sortedPins),
    [route.slug, sortedPins],
  )
  const pinsActive = voicePins.length > 0
  const active = phase === 'active'
  const layoutMode = useExamLayoutMode()

  const mapOnly = features.mapNav && !features.errorPanel
  const panelOnly = features.errorPanel && !features.mapNav
  const showMapView = active && features.mapNav && (mapOnly || (features.canSwitchViews && driveView === 'map'))
  const showPanelView = active && features.errorPanel && (panelOnly || (features.canSwitchViews && driveView === 'panel'))
  const showToolbar = active && (features.canSwitchViews || (panelOnly && showPanelView))
  const showVoiceInToolbar = showPanelView && !mapOnly

  useEffect(() => {
    if (mapOnly) setDriveView('map')
    else if (panelOnly) setDriveView('panel')
  }, [mapOnly, panelOnly, route.id])

  useEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  useEffect(() => {
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setPhase('preview')
    setDriveView(features.mapNav ? 'map' : 'panel')
    setGpsError(getGpsEnvironmentIssue())
    setLastSpoken(null)
    triggeredRef.current = new Set()
    setNextPin(sortedPins[0] ?? null)
    prevGpsRef.current = null
    speedTrackerRef.current = createSpeedTracker()
    setSpeedKmh(0)
    setHeading(0)
  }, [route.id, route.name_ka, sortedPins, features.mapNav])

  const enableGps = useCallback(async (silent = false) => {
    if (!silent) setGpsStarting(true)
    setGpsError(null)
    try {
      const pos = await requestGpsOnce({ allowCached: silent || hasGpsConsent() })
      const raw = gpsToLatLng(pos)
      setRawPos(pos)
      setUserPos(raw)
      setHeading(resolveHeading(pos, null, raw, polyline))
      prevGpsRef.current = pos
      setSpeedKmh(0)
      setGpsStarted(true)
      markGpsConsentGranted()
      return { position: raw, denied: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GPS შეცდომა'
      setGpsError(msg)
      if (msg.includes('უარყოფილი')) clearGpsConsent()
      if (!msg.includes('უარყოფილი') && !getGpsEnvironmentIssue()) setGpsStarted(true)
      return { position: null, denied: msg.includes('უარყოფილი') }
    } finally {
      if (!silent) setGpsStarting(false)
    }
  }, [polyline])

  useEffect(() => {
    if (gpsStarted || gpsStarting || getGpsEnvironmentIssue()) return
    let cancelled = false
    void (async () => {
      if (!(await shouldAutoStartGps())) return
      if (cancelled) return
      await enableGps(true)
    })()
    return () => {
      cancelled = true
    }
  }, [route.id, gpsStarted, gpsStarting, enableGps])

  useEffect(() => {
    const preload = () => audioEngine.preloadAll(collectPreloadAudioUrls(route.slug, sortedPins))
    const t = window.setTimeout(preload, 800)
    void requestWakeLock().then((release) => {
      releaseWake.current = release
    })
    return () => {
      window.clearTimeout(t)
      releaseWake.current?.()
      audioEngine.stopAll()
    }
  }, [route.id, route.slug, sortedPins])

  useEffect(() => {
    if (phase !== 'active') return
    sessionStartRef.current = Date.now()
    const tick = () => setElapsedMs(Date.now() - sessionStartRef.current)
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  useEffect(() => {
    if (!gpsStarted) return
    return watchGps(
      (pos) => {
        setRawPos(pos)
        setGpsError(null)
        const raw = gpsToLatLng(pos)
        setUserPos(raw)
        const prevRaw = prevGpsRef.current ? gpsToLatLng(prevGpsRef.current) : null
        setHeading(resolveHeading(pos, prevRaw, raw, polyline))
        if (phase === 'active') {
          setSpeedKmh(resolveExamSpeedKmh(pos, prevGpsRef.current, speedTrackerRef.current))
        } else {
          setSpeedKmh(0)
        }
        prevGpsRef.current = pos

        const pending = voicePins.find((p) => !triggeredRef.current.has(p.id))
        setNextPin(pending ?? null)

        // აუდიო ყოველთვის ითამაშოს თუ routeAudio feature enabled-ია, view-ის მიუხედავად
        if (!pending || phase !== 'active' || !features.routeAudio) return

        const dist = distanceToPinMeters(raw, [pending.lat, pending.lng])
        const headingOk = headingMatches(raw, [pending.lat, pending.lng], pos.heading)
        const alreadySpoken = isStartPinAlreadyAnnounced(route.slug, pending.id)
        
        console.log('📍 Pin check:', 
          'ID:', pending.id,
          '| Instruction:', pending.instruction_ka,
          '| Distance:', Math.round(dist) + 'm',
          '| Trigger:', pending.trigger_distance_m + 'm',
          '| Heading OK:', headingOk,
          '| Already spoken:', alreadySpoken
        )

        if (
          dist <= pending.trigger_distance_m &&
          headingOk &&
          !alreadySpoken
        ) {
          console.log('🔊 Audio trigger!', pending.instruction_ka)
          triggeredRef.current.add(pending.id)
          setLastSpoken(pending.instruction_ka)
          void audioEngine.play(pending.audio_url, pending.id, pending.instruction_ka)
        }
      },
      (err) => setGpsError(formatGpsError(err)),
    )
  }, [gpsStarted, voicePins, phase, route.slug, features.routeAudio, polyline])

  const handleError = useCallback((errorId: string) => {
    setExam((prev) => recordExamError(prev, errorId, false))
  }, [])

  const handleSevereQuick = useCallback(() => {
    setExam((prev) => recordSevereQuick(prev))
  }, [])

  function startSession(position: LatLng | null = userPos) {
    triggeredRef.current = new Set()
    const firstPin = voicePins[0]
    if (firstPin && isStartPinAlreadyAnnounced(route.slug, firstPin.id)) {
      triggeredRef.current.add(firstPin.id)
    }
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setElapsedMs(0)
    setLastSpoken(EXAM_START_TEXT)
    setNextPin(voicePins.find((p) => !triggeredRef.current.has(p.id)) ?? null)
    speedTrackerRef.current = createSpeedTracker()
    setSpeedKmh(0)
    setDriveView(features.mapNav ? 'map' : 'panel')
    setPhase('active')
    void audioEngine.play(EXAM_START_AUDIO, 'session-start', EXAM_START_TEXT)
  }

  async function handleStartSession() {
    if (gpsStarting) return
    const gpsResult = userPos ? { position: userPos, denied: false } : await enableGps(false)
    if (gpsResult.denied) return
    const position = gpsResult.position
    startSession(position)
  }

  function finishSession() {
    const summary = finishExamSession(exam)
    saveExamSummary(summary)
    setExamSummary(summary)
    setPhase('summary')
    releaseWake.current?.()
    audioEngine.stopAll()
    // Play success audio only if passed (not failed)
    const passed = !summary.failedMinor && summary.severeTotal === 0
    if (passed) {
      void audioEngine.play(EXAM_SUCCESS_AUDIO, 'session-success', EXAM_SUCCESS_TEXT)
    }
  }

  function restartPreview() {
    setPhase('preview')
    setExamSummary(null)
    setExam(createExamSession(route.id, route.name_ka))
    triggeredRef.current = new Set()
    setNextPin(sortedPins[0] ?? null)
    setLastSpoken(null)
    setElapsedMs(0)
  }

  const nextPinDistanceLabel =
    active && pinsActive && nextPin && userPos && showVoiceInToolbar
      ? (() => {
          const meters = Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng]))
          return meters <= 9999 ? `${meters} მ` : '—'
        })()
      : null

  const sessionLayout = mapOnly ? 'nav-only' : features.canSwitchViews ? 'switchable' : 'panel-only'

  return (
    <div
      className={`exam-session exam-session--${layoutMode} exam-session--${sessionLayout}${active ? ' exam-session--active' : ''}`}
    >
      {active && (
        <>
          <ExamScoreboard
            elapsedMs={elapsedMs}
            speedKmh={speedKmh}
            minorTotal={exam.minorTotal}
            severeTotal={exam.severeTotal}
            onRecordSevere={handleSevereQuick}
            showErrors={features.errorPanel && (panelOnly || driveView === 'panel')}
            compact={mapOnly}
          />

          {showToolbar && (
            <div className="exam-drive-toolbar">
              {features.canSwitchViews && <ExamViewSwitcher view={driveView} onChange={setDriveView} />}
              {showVoiceInToolbar && (
                <div className="exam-voice-bar exam-voice-bar--toolbar">
                  {nextPinDistanceLabel && nextPin && (
                    <p className="exam-voice-next">
                      <small>შემდეგი · {nextPinDistanceLabel}</small>
                      <strong>{nextPin.instruction_ka}</strong>
                    </p>
                  )}
                  {lastSpoken && (
                    <p className="exam-voice-last">
                      <small>ბოლო ხმა</small>
                      <span>{lastSpoken}</span>
                    </p>
                  )}
                  {!pinsActive && <p className="exam-voice-muted">ამ მარშრუტზე GPS წერტილები არ არის</p>}
                </div>
              )}
            </div>
          )}

          <div className="exam-drive-main">
            {showMapView && (userPos || polyline[0]) && (
              <ExamLiveMap route={route} userPos={userPos ?? polyline[0]} heading={heading} nextPin={nextPin} />
            )}
            {showPanelView && <ExamErrorGrid counts={exam.counts} onError={handleError} />}
          </div>

          <button type="button" className="exam-finish-fab" onClick={finishSession}>
            დასრულება
          </button>
        </>
      )}

      {phase === 'preview' && (
        <div className="exam-preview">
          <RoutePreviewMap route={route} />
          <div className="exam-preview__panel">
            {gpsError && <p className="error-text">{gpsError}</p>}
            {gpsStarted && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                <GpsAccuracyBadge accuracy={rawPos?.accuracy ?? null} />
                <p className="session-hint" style={{ margin: 0 }}>
                  {pinsActive ? `${sortedPins.length} ხმოვანი წერტილი` : ''}
                  {mapOnly && (pinsActive ? ' · ' : '') + 'ნავიგაცია'}
                  {features.canSwitchViews && (pinsActive || mapOnly ? ' · ' : '') + 'სრული პაკეტი'}
                  {panelOnly && (pinsActive ? ' · ' : '') + 'გამოცდის პანელი'}
                </p>
              </div>
            )}
            <button type="button" className="nav-start-btn" onClick={() => void handleStartSession()} disabled={gpsStarting}>
              {gpsStarting ? 'GPS იტვირთება...' : '▶ გამოცდის დაწყება'}
            </button>
            {lastHistory[0] && features.errorPanel && (
              <p className="session-hint">
                ბოლო: {formatExamDuration(lastHistory[0].elapsedMs)} · ქვედი {lastHistory[0].minorTotal} · მძიმე{' '}
                {lastHistory[0].severeTotal}
              </p>
            )}
          </div>
        </div>
      )}

      {phase === 'summary' && examSummary && (
        <ExamSummary summary={examSummary} onRestart={restartPreview} />
      )}
    </div>
  )
}
