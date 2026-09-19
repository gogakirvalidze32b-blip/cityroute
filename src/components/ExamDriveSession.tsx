import { useExamLayoutMode } from '@/hooks/useExamLayoutMode'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExamErrorGrid } from '@/components/ExamErrorGrid'
import { ExamLiveMap } from '@/components/ExamLiveMap'
import { NavigationScreen } from '@/components/NavigationScreen'
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
  loadActiveExam,
  saveActiveExam,
  clearActiveExam,
  hasSavedExam,
} from '@/lib/exam-persistence'
import {
  distanceToPinMeters,
  formatGpsError,
  getGpsEnvironmentIssue,
  hasGpsConsent,
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
import { createGpsFilter, type GpsReading } from '@/lib/gps-filter'
import { createNavigationStateManager, type NavigationInstruction } from '@/lib/navigation-state'
import type { PinRow, RouteWithPins } from '@/types/database'

type Phase = 'preview' | 'active' | 'summary'

type Props = {
  route: RouteWithPins
  onPhaseChange?: (phase: Phase) => void
}

export function ExamDriveSession({ route, onPhaseChange }: Props) {
  const features = usePlanFeatures()
  
  // Try to restore saved exam state
  const savedState = useMemo(() => loadActiveExam(route.id), [route.id])
  const [phase, setPhase] = useState<Phase>(savedState ? 'active' : 'preview')
  const [driveView, setDriveView] = useState<ExamDriveView>('map')
  const [exam, setExam] = useState(() => savedState?.exam || createExamSession(route.id, route.name_ka))
  const [examSummary, setExamSummary] = useState<ExamSessionSummary | null>(null)
  const [lastHistory] = useState(() => loadExamHistory(route.id))

  const [gpsStarted, setGpsStarted] = useState(savedState ? true : false)
  const [gpsStarting, setGpsStarting] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(() => getGpsEnvironmentIssue())
  const [rawPos, setRawPos] = useState<GpsPosition | null>(null)
  const [userPos, setUserPos] = useState<LatLng | null>(savedState?.userPos || null)
  const [heading, setHeading] = useState(savedState?.heading || 0)
  const [speedKmh, setSpeedKmh] = useState(savedState?.speedKmh || 0)
  const [elapsedMs, setElapsedMs] = useState(savedState?.elapsedMs || 0)
  const [lastSpoken, setLastSpoken] = useState<string | null>(null)

  // Navigation state manager
  const navStateRef = useRef(createNavigationStateManager())
  const [nextInstruction, setNextInstruction] = useState<NavigationInstruction | null>(null)
  const [distanceToNextM, setDistanceToNextM] = useState<number | null>(null)

  const releaseWake = useRef<(() => void) | null>(null)
  const sessionStartRef = useRef(savedState ? Date.now() - savedState.elapsedMs : 0)
  const prevGpsRef = useRef<GpsPosition | null>(null)
  const speedTrackerRef = useRef(createSpeedTracker())
  const gpsFilterRef = useRef(createGpsFilter())

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

  // Use new navigation screen for map-only mode
  const useNewNavigation = mapOnly && active

  useEffect(() => {
    if (mapOnly) setDriveView('map')
    else if (panelOnly) setDriveView('panel')
  }, [mapOnly, panelOnly, route.id])

  useEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  // Initialize navigation state manager
  useEffect(() => {
    navStateRef.current.initialize(voicePins)
    
    // Set up instruction trigger callback
    navStateRef.current.setOnInstructionTrigger((instruction) => {
      setLastSpoken(instruction.instruction)
      void audioEngine.play(instruction.audioUrl, instruction.pinId, instruction.instruction)
    })
    
    // Update next instruction
    const next = navStateRef.current.getNextInstruction()
    setNextInstruction(next)
  }, [voicePins])

  useEffect(() => {
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setPhase('preview')
    setDriveView(features.mapNav ? 'map' : 'panel')
    setGpsError(getGpsEnvironmentIssue())
    setLastSpoken(null)
    navStateRef.current.reset()
    prevGpsRef.current = null
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
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

  // Auto-save exam state every 5 seconds when active
  useEffect(() => {
    if (phase !== 'active') return
    
    const saveState = () => {
      saveActiveExam({
        routeId: route.id,
        routeName: route.name_ka,
        phase: 'active',
        exam,
        userPos,
        heading,
        speedKmh,
        elapsedMs,
        triggeredPins: Array.from(triggeredRef.current),
        savedAt: Date.now(),
      })
    }

    // Save immediately
    saveState()

    // Then save every 5 seconds
    const id = window.setInterval(saveState, 5000)
    return () => window.clearInterval(id)
  }, [phase, route.id, route.name_ka, exam, userPos, heading, speedKmh, elapsedMs])

  useEffect(() => {
    if (!gpsStarted) return
    return watchGps(
      (pos) => {
        // Apply GPS filter
        const reading: GpsReading = {
          position: gpsToLatLng(pos),
          accuracy: pos.accuracy,
          speed: pos.speed ?? 0,
          timestamp: pos.timestamp,
        }
        
        const filtered = gpsFilterRef.current.filter(reading)
        
        // Reject invalid readings
        if (!filtered) {
          return
        }
        
        setRawPos(pos)
        setGpsError(null)
        const raw = filtered.position
        setUserPos(raw)
        const prevRaw = prevGpsRef.current ? gpsToLatLng(prevGpsRef.current) : null
        setHeading(resolveHeading(pos, prevRaw, raw, polyline))
        if (phase === 'active') {
          setSpeedKmh(resolveExamSpeedKmh(pos, prevGpsRef.current, speedTrackerRef.current))
        } else {
          setSpeedKmh(0)
        }
        prevGpsRef.current = pos

        // Update navigation state manager
        if (phase === 'active' && features.routeAudio) {
          const instruction = navStateRef.current.update(raw, pos.heading)
          setNextInstruction(instruction)
          
          // Calculate distance to next instruction
          if (instruction) {
            const distance = distanceToPinMeters(raw, instruction.position)
            setDistanceToNextM(Math.round(distance))
          } else {
            setDistanceToNextM(null)
          }
        }
      },
      (err) => setGpsError(formatGpsError(err)),
    )
  }, [gpsStarted, phase, features.routeAudio, polyline])

  const handleError = useCallback((errorId: string) => {
    setExam((prev) => recordExamError(prev, errorId, false))
  }, [])

  const handleSevereQuick = useCallback(() => {
    setExam((prev) => recordSevereQuick(prev))
  }, [])

  function startSession(position: LatLng | null = userPos) {
    // Mark start pin as already announced if applicable
    const firstPin = voicePins[0]
    if (firstPin && isStartPinAlreadyAnnounced(route.slug, firstPin.id)) {
      navStateRef.current.triggerInstruction(`instruction-0`)
    }
    
    navStateRef.current.reset()
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setElapsedMs(0)
    setLastSpoken(EXAM_START_TEXT)
    setNextInstruction(navStateRef.current.getNextInstruction())
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
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
    clearActiveExam() // Clear saved state when finishing
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
    navStateRef.current.reset()
    setNextInstruction(navStateRef.current.getNextInstruction())
    setLastSpoken(null)
    setElapsedMs(0)
    clearActiveExam() // Clear saved state when restarting
  }

  const nextPinDistanceLabel =
    active && pinsActive && nextInstruction && userPos && showVoiceInToolbar
      ? (() => {
          const meters = distanceToNextM ?? 0
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
                  {nextPinDistanceLabel && nextInstruction && (
                    <p className="exam-voice-next">
                      <small>შემდეგი · {nextPinDistanceLabel}</small>
                      <strong>{nextInstruction.instruction}</strong>
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

          {useNewNavigation && userPos ? (
            <NavigationScreen
              position={userPos}
              heading={heading}
              speed={speedKmh}
              polyline={polyline}
              instructions={navStateRef.current.getAllInstructions()}
              nextInstruction={nextInstruction}
              distanceToNextM={distanceToNextM}
              elapsedMs={elapsedMs}
              onStop={finishSession}
              showViewSwitcher={false}
              enableInstructionsView={false}
              enableRoundaboutButton={false}
            />
          ) : (
            <>
              <div className="exam-drive-main">
                {showMapView && (userPos || polyline[0]) && (
                  <ExamLiveMap 
                    route={route} 
                    userPos={userPos ?? polyline[0]} 
                    heading={heading} 
                    nextPin={voicePins.find(p => p.id === nextInstruction?.pinId) ?? null}
                  />
                )}
                {showPanelView && <ExamErrorGrid counts={exam.counts} onError={handleError} />}
              </div>

              <button type="button" className="exam-finish-fab" onClick={finishSession}>
                დასრულება
              </button>
            </>
          )}
        </>
      )}

      {phase === 'preview' && (
        <div className="exam-preview">
          <RoutePreviewMap route={route} />
          <div className="exam-preview__panel">
            {savedState && (
              <div style={{ 
                background: '#fef3c7', 
                padding: '0.75rem', 
                borderRadius: '8px', 
                marginBottom: '0.5rem',
                border: '2px solid #f59e0b'
              }}>
                <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: '#92400e' }}>
                  ⏱️ გაქვთ დაუსრულებელი სესია
                </p>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: '#78350f' }}>
                  დრო: {formatExamDuration(savedState.elapsedMs)} · შეცდომები: {Object.values(savedState.exam.counts).reduce((sum, c) => sum + c.minor + c.severe, 0)}
                </p>
              </div>
            )}
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
              {gpsStarting ? 'GPS იტვირთება...' : savedState ? '▶ გაგრძელება' : '▶ გამოცდის დაწყება'}
            </button>
            {lastHistory[0] && features.errorPanel && !savedState && (
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
