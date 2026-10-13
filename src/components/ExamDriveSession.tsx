import { useExamLayoutMode } from '@/hooks/useExamLayoutMode'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  loadActiveExam,
  saveActiveExam,
  clearActiveExam,
  describeSavedExam,
  examSessionOriginMs,
  examElapsedMsNow,
  hasSavedExamForSlug,
  type SavedExamState,
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
} from '@/data/route-audio'
import { evaluateNextPin, type PinApproach } from '@/lib/pin-cue'
import {
  describePinCue,
  PIN_CUE_REASON_TEXT,
  readPinDebugFlag,
  type PinCueDiagnostic,
} from '@/lib/pin-diagnostics'
import {
  examProgress,
  nextSortOrder,
  ordersForIds,
  pinIdsForOrders,
  resolveExamResume,
  RESUME_PENDING_MESSAGE,
  RESUME_UNRESOLVED_MESSAGE,
  savedHandledOrders,
} from '@/lib/route-resume'
import {
  getCurrentSpeedLimit,
  currentSegmentIndex,
  isSpeedLimitViolation,
  recordSpeedLimitViolation,
} from '@/lib/speed-limit'
import { createSpeedTracker, gpsToLatLng, resolveExamSpeedKmh, resolveHeading } from '@/lib/route-nav'
import { createGpsFilter, type GpsReading } from '@/lib/gps-filter'
import { examRoadTrace } from '@/lib/pin-route-line'
import { chooseStartPin, START_MAX_ACCURACY_M, type StartPinDecision } from '@/lib/start-pin'
import type { PinRow, RouteWithPins } from '@/types/database'
import { TELAVI_CENTER } from '@/data/telavi-landmarks'

type Phase = 'preview' | 'active' | 'summary'

// Per-GPS-fix diagnostics are development-only (production keeps console quiet).
const devLog: typeof console.log = (...args) => {
  if (import.meta.env.DEV) console.log(...args)
}

type Props = {
  route: RouteWithPins
  onPhaseChange?: (phase: Phase) => void
}

type PinDiagState = PinCueDiagnostic & {
  fixAt: number
  rejected: boolean
  accuracyM: number
  headingDeg: number | null
  speedKmh: number | null
  nextOrder: number | null
  distanceM: number | null
  triggerM: number | null
  handled: number
  total: number
  inFlightOrder: number | null
  phaseActive: boolean
}

/** Starting pin of a NEW exam not decided yet. No pin can play meanwhile. */
type StartSelection =
  | { status: 'wait'; reason: 'gps' | 'stationary'; candidates: number[] }
  | { status: 'choose'; candidates: number[] }

/** A GPS fix older than this does not describe where the car is now. */
const START_FIX_MAX_AGE_MS = 15_000
/** How long a new exam waits for an accurate fix before starting at PIN 1. */
const START_GPS_WAIT_MS = 10_000
const START_NOTICE_MS = 12_000

const START_NO_GPS_MESSAGE = 'ზუსტი GPS მდებარეობა ვერ დადგინდა — გამოცდა იწყება PIN 1-დან'

function startFallbackMessage(reason: 'accuracy' | 'off-route' | 'no-pins', accuracyM: number): string | null {
  if (reason === 'accuracy') {
    return `GPS სიზუსტე ${Math.round(accuracyM)} მ (საჭიროა ≤ ${START_MAX_ACCURACY_M} მ) — გამოცდა იწყება PIN 1-დან`
  }
  if (reason === 'off-route') return 'მანქანა მარშრუტის ქუჩაზე არ არის — გამოცდა იწყება PIN 1-დან'
  return null
}

function describeStartDecision(decision: StartPinDecision): string {
  if (decision.kind === 'start') return `საწყისი PIN ${decision.sortOrder} (${decision.basis})`
  if (decision.kind === 'ambiguous') {
    return `საწყისი PIN გაურკვეველია: ${decision.candidates.join(', ')}${decision.moving ? ' · მოძრაობისას' : ' · დგას'}`
  }
  return `საწყისი PIN 1 · ${decision.reason}`
}

function initialHandledOrders(
  saved: SavedExamState,
  pins: readonly PinRow[],
  routeSlug: string,
): Set<number> | null {
  const orders = savedHandledOrders(saved, pins, routeSlug)
  return orders === 'invalid' ? null : orders
}

export function ExamDriveSession({ route, onPhaseChange }: Props) {
  const features = usePlanFeatures()
  
  // Try to restore saved exam state (slug survives local-route-* → Supabase UUID)
  // savedEpoch is bumped by Finish/restart so a stale memo can never resurrect a finished exam.
  const [savedEpoch, setSavedEpoch] = useState(0)
  const savedState = useMemo(
    () => loadActiveExam(route.id, route.slug, route.name_ka),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.id, route.slug, route.name_ka, savedEpoch],
  )
  const [phase, setPhase] = useState<Phase>('preview')
  const [driveView, setDriveView] = useState<ExamDriveView>('map')
  const [exam, setExam] = useState(() => savedState?.exam || createExamSession(route.id, route.name_ka))
  const [examSummary, setExamSummary] = useState<ExamSessionSummary | null>(null)
  const [lastHistory] = useState(() => loadExamHistory(route.id))

  const [gpsStarted, setGpsStarted] = useState(false)
  const [gpsStarting, setGpsStarting] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(() => getGpsEnvironmentIssue())
  const [rawPos, setRawPos] = useState<GpsPosition | null>(null)
  // The car position always comes from a live GPS fix, never from the saved session.
  const [userPos, setUserPos] = useState<LatLng | null>(null)
  const [heading, setHeading] = useState(savedState?.heading || 0)
  const [speedKmh, setSpeedKmh] = useState(savedState?.speedKmh || 0)
  const [elapsedMs, setElapsedMs] = useState(() => (savedState ? examElapsedMsNow(savedState) : 0))
  const [nextPin, setNextPin] = useState<PinRow | null>(null)
  const [lastSpoken, setLastSpoken] = useState<string | null>(null)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [startSelection, setStartSelection] = useState<StartSelection | null>(null)
  const [startNotice, setStartNotice] = useState<string | null>(null)
  
  // DEBUG: Session diagnostic panel state
  // Production: panel and its 500 ms re-render timer are off. Development: unchanged.
  const [pinDebug] = useState(
    () => typeof window !== 'undefined' && readPinDebugFlag(window.location.search, window.localStorage),
  )
  const [pinDiag, setPinDiag] = useState<PinDiagState | null>(null)
  const [pinEvents, setPinEvents] = useState<string[]>([])
  const pushPinEvent = useCallback((text: string) => {
    const at = new Date().toLocaleTimeString('ka-GE', { hour12: false })
    setPinEvents((prev) => (prev[0]?.endsWith(text) ? prev : [`${at} ${text}`, ...prev].slice(0, 8)))
  }, [])
  const [debugSessionVisible, setDebugSessionVisible] = useState(import.meta.env.DEV)
  const [, forceDebugUpdate] = useState(0)
  useEffect(() => {
    if (!import.meta.env.DEV || !debugSessionVisible) return
    const interval = setInterval(() => {
      forceDebugUpdate(v => v + 1)
    }, 500)
    return () => clearInterval(interval)
  }, [debugSessionVisible])

  const phaseRef = useRef<Phase>(phase)
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const triggeredRef = useRef<Set<string>>(savedState ? new Set(savedState.triggeredPins) : new Set())
  /** Handled pins by sort_order. Null while a legacy id-only save cannot be placed on this pin list. */
  const handledOrdersRef = useRef<Set<number> | null>(
    savedState ? initialHandledOrders(savedState, route.pins, route.slug) : new Set(),
  )
  const inFlightPinRef = useRef<string | null>(null)
  const inFlightOrderRef = useRef<number | null>(null)
  const saveNowRef = useRef<(() => void) | null>(null)
  const approachRef = useRef<PinApproach | null>(null)
  const cueEpochRef = useRef(0)
  const releaseWake = useRef<(() => void) | null>(null)
  const sessionStartRef = useRef(savedState ? examSessionOriginMs(savedState) : 0)
  const resumedSlugRef = useRef<string | null>(savedState ? route.slug : null)
  const finishInProgressRef = useRef(false)
  const prevGpsRef = useRef<GpsPosition | null>(null)
  /** Last accepted fix, for choosing the starting pin. */
  const lastFixRef = useRef<{ pos: GpsPosition; position: LatLng; at: number } | null>(null)
  const startSelectionRef = useRef<StartSelection | null>(null)
  const speedTrackerRef = useRef(createSpeedTracker())
  const gpsFilterRef = useRef(createGpsFilter())

  const polyline = route.polyline as LatLng[]
  const sortedPins = useMemo(
    // CRITICAL: Pins must be sorted by sort_order to enforce STRICT SEQUENTIAL triggering
    // This ensures PIN #1 triggers before #2, #2 before #3, etc.
    // Order is maintained across all routes (Route 1, 2, 3, 4)
    () => [...route.pins].sort((a, b) => a.sort_order - b.sort_order),
    [route.id, route.pins],
  )
  const voicePins = useMemo(
    () => enrichPinsWithLocalAudio(route.slug, sortedPins),
    [route.slug, sortedPins],
  )
  const pinsRef = useRef(voicePins)
  const slugRef = useRef(route.slug)
  pinsRef.current = voicePins
  slugRef.current = route.slug

  const setSelection = useCallback((next: StartSelection | null) => {
    startSelectionRef.current = next
    setStartSelection(next)
  }, [])

  /** New exam: pins before `order` are done for this exam; the sequence continues from `order`. */
  const applyStartPin = useCallback(
    (order: number | null, notice: string | null) => {
      const pins = pinsRef.current
      const orders = new Set(order === null ? [] : pins.filter((pin) => pin.sort_order < order).map((pin) => pin.sort_order))
      handledOrdersRef.current = orders
      triggeredRef.current = pinIdsForOrders(pins, orders)
      approachRef.current = null
      setSelection(null)
      setStartNotice(notice)
      setNextPin(pins.find((pin) => !orders.has(pin.sort_order)) ?? null)
      saveNowRef.current?.()
    },
    [setSelection],
  )

  /** One GPS fix towards the starting pin. `final`: no better fix is coming, decide now. */
  const resolveStart = useCallback(
    (pos: GpsPosition, position: LatLng, final: boolean) => {
      const current = startSelectionRef.current
      if (!current) return
      const pins = pinsRef.current
      if (pins.length === 0) {
        if (final) applyStartPin(null, START_NO_GPS_MESSAGE)
        return
      }
      const decision = chooseStartPin(
        pins,
        {
          position,
          accuracyM: pos.accuracy,
          headingDeg: pos.heading,
          speedMps: typeof pos.speed === 'number' ? pos.speed : null,
        },
        examRoadTrace(slugRef.current, pins),
      )
      if (pinDebug) pushPinEvent(describeStartDecision(decision))
      const first = pins[0].sort_order
      if (decision.kind === 'start') {
        applyStartPin(
          decision.sortOrder,
          decision.sortOrder === first ? null : `გამოცდა იწყება PIN ${decision.sortOrder}-დან (მიმდინარე GPS მდებარეობით)`,
        )
        return
      }
      if (decision.kind === 'ambiguous') {
        if (decision.moving) setSelection({ status: 'choose', candidates: decision.candidates })
        else if (current.status !== 'choose') setSelection({ status: 'wait', reason: 'stationary', candidates: decision.candidates })
        return
      }
      // Already narrowed down to a few pins: one coarse or drifting fix does not reset that.
      if (current.status === 'choose' || current.reason === 'stationary') return
      if (decision.reason === 'accuracy' && !final) return
      applyStartPin(first, startFallbackMessage(decision.reason, pos.accuracy))
    },
    [applyStartPin, setSelection, pinDebug, pushPinEvent],
  )

  const beginStartSelection = useCallback(() => {
    setSelection({ status: 'wait', reason: 'gps', candidates: [] })
    setNextPin(null)
    const fix = lastFixRef.current
    if (fix && Date.now() - fix.at <= START_FIX_MAX_AGE_MS) resolveStart(fix.pos, fix.position, false)
  }, [resolveStart, setSelection])

  const pinsActive = voicePins.length > 0
  const active = phase === 'active'
  const layoutMode = useExamLayoutMode()

  const mapOnly = features.mapNav && !features.errorPanel
  const panelOnly = features.errorPanel && !features.mapNav
  const showMapView = active && features.mapNav && driveView === 'map'
  const showPanelView = active && features.errorPanel && (panelOnly || (features.canSwitchViews && driveView === 'panel'))
  const showToolbar = active && (features.canSwitchViews || (panelOnly && showPanelView))
  const showVoiceInToolbar = showPanelView && !mapOnly

  useEffect(() => {
    if (mapOnly) setDriveView('map')
    else if (panelOnly) setDriveView('panel')
  }, [mapOnly, panelOnly, route.id])

  useLayoutEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  useEffect(() => {
    // ============================================================
    // Resume by slug so local-route-* → Supabase UUID does not drop the session.
    // Hydrate once per slug. Do not reset to preview. Do not call startSession().
    // ============================================================
    // After Finish the summary must stay. The flag stays up until restartPreview()/startSession()
    // (it is not consumed here), so a later re-run of this effect cannot overwrite the summary.
    if (finishInProgressRef.current || phaseRef.current === 'summary') return

    const described = describeSavedExam(route.id, route.slug, route.name_ka)
    if (described.kind === 'corrupt') {
      setResumeError(RESUME_UNRESOLVED_MESSAGE)
      return
    }

    const saved = described.kind === 'ok' ? described.state : null

    if (saved) {
      if (resumedSlugRef.current !== route.slug) {
        resumedSlugRef.current = route.slug
        triggeredRef.current = new Set(saved.triggeredPins)
        handledOrdersRef.current = initialHandledOrders(saved, sortedPins, route.slug)
        inFlightPinRef.current = null
        inFlightOrderRef.current = null
        sessionStartRef.current = examSessionOriginMs(saved)
        setExam(saved.exam)
        setExamSummary(null)
        setHeading(saved.heading)
        setSpeedKmh(saved.speedKmh)
        setElapsedMs(examElapsedMsNow(saved))
        setDriveView(features.mapNav ? 'map' : 'panel')
        setResumeError(null)
        setSelection(null)
        setStartNotice(null)
        console.log('🔄 Saved exam is waiting for the start button', route.slug)
      }
      return
    }

    // Slug says a session exists; local id may not have matched yet. Do not reset to preview.
    if (hasSavedExamForSlug(route.slug, route.name_ka)) {
      setDriveView(features.mapNav ? 'map' : 'panel')
      return
    }

    resumedSlugRef.current = null
    sessionStartRef.current = 0
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setPhase('preview')
    setDriveView(features.mapNav ? 'map' : 'panel')
    setGpsError(getGpsEnvironmentIssue())
    setResumeError(null)
    setSelection(null)
    setStartNotice(null)
    setLastSpoken(null)
    triggeredRef.current = new Set()
    handledOrdersRef.current = new Set()
    inFlightPinRef.current = null
    inFlightOrderRef.current = null
    approachRef.current = null
    setNextPin(sortedPins[0] ?? null)
    prevGpsRef.current = null
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
    setSpeedKmh(0)
    setHeading(0)
  }, [route.id, route.slug, route.name_ka, sortedPins, features.mapNav, setSelection])

  // Local pin ids (p1-3) and Supabase UUIDs share sort_order. Progress is kept by sort_order,
  // so a pin list swap re-derives the handled ids instead of dropping or guessing them.
  useEffect(() => {
    if (handledOrdersRef.current === null) {
      const derived = ordersForIds(triggeredRef.current, sortedPins, route.slug)
      if (sortedPins.length === 0) return
      if (derived.unknown.length > 0) {
        if (phaseRef.current === 'active') setResumeError(RESUME_PENDING_MESSAGE)
        return
      }
      handledOrdersRef.current = derived.orders
    }
    triggeredRef.current = pinIdsForOrders(sortedPins, handledOrdersRef.current)
    if (inFlightOrderRef.current !== null) {
      const inFlight = sortedPins.find((pin) => pin.sort_order === inFlightOrderRef.current)
      if (inFlight) inFlightPinRef.current = inFlight.id
    }
    if (phaseRef.current === 'active' && !startSelectionRef.current) {
      const progress = examProgress(sortedPins, triggeredRef.current)
      setNextPin(sortedPins.find((pin) => pin.id === progress.nextPinId) ?? null)
      setResumeError(null)
    }
  }, [sortedPins, route.slug])

  const enableGps = useCallback(async (silent = false) => {
    if (!silent) setGpsStarting(true)
    setGpsError(null)
    try {
      const pos = await requestGpsOnce({ allowCached: silent || hasGpsConsent() })
      const raw = gpsToLatLng(pos)
      lastFixRef.current = { pos, position: raw, at: Date.now() }
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
    }
  }, [route.id, route.slug, sortedPins])

  useEffect(() => {
    return () => {
      cueEpochRef.current += 1
      inFlightPinRef.current = null
      inFlightOrderRef.current = null
      approachRef.current = null
      audioEngine.stopAll()
    }
  }, [route.slug])

  useEffect(() => {
    if (phase !== 'active') return
    // New session only: origin unset. Resume already has wall-clock origin.
    if (!sessionStartRef.current) {
      sessionStartRef.current = Date.now()
    }
    const tick = () => setElapsedMs(Math.max(0, Date.now() - sessionStartRef.current))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [phase])

  // Auto-save exam state every 5 seconds when active; also persist on unmount (Home/leave).
  useEffect(() => {
    if (phase !== 'active') return
    if (finishInProgressRef.current) return // Skip saving if finish is in progress

    const saveState = () => {
      if (finishInProgressRef.current) return // Guard against saving during finish
      const liveElapsed = sessionStartRef.current
        ? Math.max(0, Date.now() - sessionStartRef.current)
        : elapsedMs
      const orders = handledOrdersRef.current
      const pins = pinsRef.current
      const base = {
        routeId: route.id,
        routeSlug: route.slug,
        routeName: route.name_ka,
        phase: 'active' as const,
        exam,
        userPos,
        heading,
        speedKmh,
        elapsedMs: liveElapsed,
        startPending: startSelectionRef.current !== null,
        savedAt: Date.now(),
      }
      if (orders === null) {
        // Legacy id-only save not yet placed on this pin list: keep it exactly as it was.
        const previous = loadActiveExam(route.id, route.slug, route.name_ka)
        saveActiveExam({
          ...base,
          triggeredPins: Array.from(triggeredRef.current),
          lastPassedPinId: previous?.lastPassedPinId ?? null,
          nextPinId: previous?.nextPinId ?? null,
        })
        return
      }
      const sorted = [...orders].sort((a, b) => a - b)
      const placed = pins.length > 0
      const byOrder = placed ? nextSortOrder(pins, orders) : null
      const progress = examProgress(pins, triggeredRef.current)
      saveActiveExam({
        ...base,
        triggeredPins: Array.from(triggeredRef.current),
        triggeredSortOrders: sorted,
        lastPassedSortOrder: byOrder ? byOrder.lastPassedSortOrder : sorted.length ? sorted[sorted.length - 1] : null,
        nextSortOrder: byOrder ? byOrder.nextSortOrder : null,
        lastPassedPinId: placed ? progress.lastPassedPinId : null,
        nextPinId: placed ? progress.nextPinId : null,
      })
    }

    saveNowRef.current = saveState
    saveState()
    const id = window.setInterval(saveState, 5000)
    const persistOnLeave = () => saveState()
    const persistIfHidden = () => {
      if (document.visibilityState === 'hidden') saveState()
    }
    window.addEventListener('pagehide', persistOnLeave)
    document.addEventListener('visibilitychange', persistIfHidden)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('pagehide', persistOnLeave)
      document.removeEventListener('visibilitychange', persistIfHidden)
      if (saveNowRef.current === saveState) saveNowRef.current = null
      if (!finishInProgressRef.current) saveState() // Only save on cleanup if not finishing
    }
  }, [phase, route.id, route.slug, route.name_ka, exam, userPos, heading, speedKmh, elapsedMs])

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

        // A rejected fix is not accurate enough to move the exam. Do not skip pins.
        if (!filtered) {
          if (pinDebug) {
            pushPinEvent(`GPS უარყოფილია · სიზუსტე ${Math.round(pos.accuracy)} მ`)
            setPinDiag((prev) => (prev ? { ...prev, fixAt: Date.now(), rejected: true, accuracyM: pos.accuracy } : prev))
          }
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
        lastFixRef.current = { pos, position: raw, at: Date.now() }

        // New exam whose starting pin is not decided yet: no pin is next until it is.
        if (startSelectionRef.current) {
          if (phase === 'active') resolveStart(pos, raw, false)
          if (startSelectionRef.current) {
            setNextPin(null)
            return
          }
        }

        // ============================================================
        // STRICT SEQUENTIAL PIN LOGIC
        // ============================================================
        // Only the next unhandled pin can play. A coarse fix or a parallel road
        // does not skip it. Already spoken pins are not repeated.
        // ============================================================

        // Saved progress not yet placed on this pin list: no pin is next until it is.
        if (handledOrdersRef.current === null) {
          setNextPin(null)
          if (pinDebug) pushPinEvent('შენახული პროგრესი PIN-ებს ჯერ არ დაუკავშირდა')
          return
        }

        const decision = evaluateNextPin({
          pins: voicePins,
          handledIds: triggeredRef.current,
          inFlightId: inFlightPinRef.current,
          user: raw,
          heading: pos.heading,
          speedMps: typeof pos.speed === 'number' ? pos.speed : null,
          accuracyM: pos.accuracy,
          approach: approachRef.current,
        })
        const nextPinIndex = decision.pinId
          ? voicePins.findIndex((pin) => pin.id === decision.pinId)
          : -1
        const pending = nextPinIndex >= 0 ? voicePins[nextPinIndex] : null
        const triggeredCount = triggeredRef.current.size
        const totalPins = voicePins.length

        setNextPin(pending ?? null)

        if (pinDebug) {
          const inFlightOrder = inFlightOrderRef.current
          setPinDiag({
            fixAt: Date.now(),
            rejected: false,
            accuracyM: pos.accuracy,
            headingDeg: pos.heading,
            speedKmh: typeof pos.speed === 'number' ? pos.speed * 3.6 : null,
            nextOrder: pending?.sort_order ?? null,
            distanceM: decision.distanceM,
            triggerM: decision.triggerM,
            handled: triggeredRef.current.size,
            total: totalPins,
            inFlightOrder,
            phaseActive: phase === 'active',
            ...describePinCue({
              decision,
              pin: pending,
              user: raw,
              heading: pos.heading,
              accuracyM: pos.accuracy,
              inFlight: inFlightOrder !== null,
            }),
          })
        }

        if (pending) {
          devLog('[PIN SEQUENCE]',
            route.slug.toUpperCase(),
            '| Expected: #' + (nextPinIndex + 1),
            '| ID:', pending.id,
            '| Progress:', triggeredCount + '/' + totalPins,
            '| Trigger:', decision.triggerM == null ? '—' : Math.round(decision.triggerM) + 'm',
            '| Distance:', decision.distanceM == null ? '—' : Math.round(decision.distanceM) + 'm',
            '| Action:', decision.action,
          )
        }

        voicePins.forEach((pin, idx) => {
          if (idx === nextPinIndex || triggeredRef.current.has(pin.id)) return
          const distToOther = distanceToPinMeters(raw, [pin.lat, pin.lng])
          if (distToOther <= 50) {
            devLog('[PIN SEQUENCE]',
              route.slug.toUpperCase(),
              '| IGNORE: PIN #' + (idx + 1),
              '| Distance:', Math.round(distToOther) + 'm',
              '| Reason: NOT NEXT PIN',
              '| Expected: #' + (nextPinIndex + 1)
            )
          }
        })

        if (!pending || phase !== 'active' || !features.routeAudio) {
          approachRef.current = decision.approach
          return
        }

        approachRef.current = decision.approach
        if (decision.action !== 'play' || inFlightPinRef.current) return

        const epoch = cueEpochRef.current
        const requestedId = pending.id
        const requestedOrder = pending.sort_order
        inFlightPinRef.current = requestedId
        inFlightOrderRef.current = requestedOrder
        devLog('[PIN SEQUENCE]',
          route.slug.toUpperCase(),
          '| 🔊 PIN #' + (nextPinIndex + 1) + ' QUEUED',
          '| Audio:', pending.instruction_ka,
          '| Progress:', (triggeredCount + 1) + '/' + totalPins,
        )
        if (pinDebug) pushPinEvent(`PIN ${requestedOrder} → რიგში (${Math.round(decision.distanceM ?? 0)} მ)`)
        void audioEngine.play(pending.audio_url, requestedId, pending.instruction_ka).then((started) => {
          if (pinDebug) {
            const note =
              epoch !== cueEpochRef.current
                ? 'გაუქმდა'
                : !started
                  ? 'ვერ დაიწყო'
                  : phaseRef.current !== 'active'
                    ? 'გამოცდა აქტიური არ არის'
                    : 'დაიწყო'
            pushPinEvent(`PIN ${requestedOrder} · აუდიო ${note}`)
          }
          if (epoch !== cueEpochRef.current) return
          if (inFlightOrderRef.current === requestedOrder) {
            inFlightPinRef.current = null
            inFlightOrderRef.current = null
          }
          if (!started || phaseRef.current !== 'active') return
          const orders = handledOrdersRef.current ?? new Set<number>()
          orders.add(requestedOrder)
          handledOrdersRef.current = orders
          triggeredRef.current = pinIdsForOrders(pinsRef.current, orders)
          setLastSpoken(pending.instruction_ka)
          saveNowRef.current?.()
        }).catch((err) => {
          console.error('[audio] PIN play crashed', requestedId, err)
          if (pinDebug) pushPinEvent(`PIN ${requestedOrder} · აუდიოს შეცდომა`)
          if (epoch === cueEpochRef.current && inFlightOrderRef.current === requestedOrder) {
            inFlightPinRef.current = null
            inFlightOrderRef.current = null
          }
        })
      },
      (err) => {
        setGpsError(formatGpsError(err))
        if (pinDebug) pushPinEvent(`GPS შეცდომა · ${err.code}`)
      },
    )
  }, [gpsStarted, voicePins, phase, route.slug, features.routeAudio, polyline, pinDebug, pushPinEvent, resolveStart])

  // No accurate fix within the wait: decide with what there is (PIN 1 when it is not reliable).
  useEffect(() => {
    if (phase !== 'active' || startSelection?.status !== 'wait' || startSelection.reason !== 'gps') return
    const id = window.setTimeout(() => {
      const fix = lastFixRef.current
      if (fix && Date.now() - fix.at <= START_FIX_MAX_AGE_MS) resolveStart(fix.pos, fix.position, true)
      else applyStartPin(pinsRef.current[0]?.sort_order ?? null, START_NO_GPS_MESSAGE)
    }, START_GPS_WAIT_MS)
    return () => window.clearTimeout(id)
  }, [phase, startSelection, resolveStart, applyStartPin])

  useEffect(() => {
    if (!startNotice) return
    const id = window.setTimeout(() => setStartNotice(null), START_NOTICE_MS)
    return () => window.clearTimeout(id)
  }, [startNotice])

  // ============================================================
  // SPEED LIMIT: limit follows the pin sequence (pin N governs the road after pin N).
  // One violation is recorded per continuous violation on a section; it re-arms when
  // speed drops to <= limit (or the section changes).
  // ============================================================
  const speedLimitKmh = useMemo(
    () => getCurrentSpeedLimit(route.slug, voicePins, nextPin),
    [route.slug, voicePins, nextPin],
  )
  const speedSegmentIdx = useMemo(() => currentSegmentIndex(voicePins, nextPin), [voicePins, nextPin])
  const speedViolationKeyRef = useRef<number | null>(null)
  const speedSkipFirstCheckRef = useRef(!!savedState)
  useEffect(() => {
    if (phase !== 'active') {
      speedViolationKeyRef.current = null
      return
    }
    const violating = isSpeedLimitViolation(speedKmh, speedLimitKmh)
    if (speedSkipFirstCheckRef.current) {
      // Resumed session: do not re-count a violation that was already recorded before leaving
      speedSkipFirstCheckRef.current = false
      speedViolationKeyRef.current = violating ? speedSegmentIdx : null
      return
    }
    if (!violating) {
      speedViolationKeyRef.current = null
      return
    }
    if (speedViolationKeyRef.current === speedSegmentIdx) return
    speedViolationKeyRef.current = speedSegmentIdx
    setExam((prev) => recordSpeedLimitViolation(prev))
  }, [phase, speedKmh, speedLimitKmh, speedSegmentIdx])

  const handleError = useCallback((errorId: string) => {
    setExam((prev) => recordExamError(prev, errorId, false))
  }, [])

  const handleSevereQuick = useCallback(() => {
    setExam((prev) => recordSevereQuick(prev))
  }, [])

  function startSession() {
    finishInProgressRef.current = false
    cueEpochRef.current += 1
    inFlightPinRef.current = null
    inFlightOrderRef.current = null
    approachRef.current = null
    triggeredRef.current = new Set()
    handledOrdersRef.current = new Set()
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    sessionStartRef.current = Date.now()
    setElapsedMs(0)
    setLastSpoken(EXAM_START_TEXT)
    // Starting pin from where the car is now (PIN 1 at the agency or when GPS is not reliable).
    setStartNotice(null)
    beginStartSelection()
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
    setSpeedKmh(0)
    setDriveView(features.mapNav ? 'map' : 'panel')
    setPhase('active')
    resumedSlugRef.current = route.slug
    void audioEngine.play(EXAM_START_AUDIO, 'session-start', EXAM_START_TEXT)
  }

  async function handleStartSession() {
    if (gpsStarting) return

    const described = describeSavedExam(route.id, route.slug, route.name_ka)
    if (described.kind === 'corrupt') {
      setResumeError(RESUME_UNRESOLVED_MESSAGE)
      return
    }
    if (described.kind === 'ok') {
      const resolution = resolveExamResume(described.state, voicePins, route.slug)
      if (resolution.status !== 'resume') {
        setResumeError(resolution.message)
        return
      }
      console.log('🔄 Resuming saved exam from the start button - not calling startSession()')
      cueEpochRef.current += 1
      inFlightPinRef.current = null
      inFlightOrderRef.current = null
      approachRef.current = null
      handledOrdersRef.current = resolution.handledOrders ? new Set(resolution.handledOrders) : null
      triggeredRef.current = new Set(resolution.triggeredIds)
      setResumeError(null)
      if (described.state.startPending && resolution.handledOrders?.length === 0) {
        // Left before the starting pin was chosen: there is no progress to restore, choose it now.
        beginStartSelection()
      } else {
        setSelection(null)
        setNextPin(voicePins.find((pin) => pin.sort_order === resolution.nextSortOrder) ?? null)
      }
      resumedSlugRef.current = route.slug
      if (phase !== 'active') setPhase('active')
      if (!gpsStarted) {
        await enableGps(true)
      }
      return
    }

    // No saved exam for this route. Another route's save is not used.
    const gpsResult = userPos ? { position: userPos, denied: false } : await enableGps(false)
    if (gpsResult.denied) return
    startSession()
  }

  function finishSession() {
    finishInProgressRef.current = true
    cueEpochRef.current += 1
    inFlightPinRef.current = null
    inFlightOrderRef.current = null
    approachRef.current = null
    setSelection(null)
    setStartNotice(null)
    clearActiveExam() // Clear saved state IMMEDIATELY before any state updates
    setSavedEpoch((v) => v + 1) // drop the stale savedState memo in the same batch as phase='summary'
    const summary = finishExamSession(exam)
    saveExamSummary(summary)
    setExamSummary(summary)
    setPhase('summary')
    releaseWake.current?.()
    audioEngine.stopAll()
    resumedSlugRef.current = null
    // Play success audio only if passed (not failed)
    const passed = !summary.failedMinor && summary.severeTotal === 0
    if (passed) {
      void audioEngine.play(EXAM_SUCCESS_AUDIO, 'session-success', EXAM_SUCCESS_TEXT)
    }
  }

  function restartPreview() {
    finishInProgressRef.current = false
    setPhase('preview')
    setExamSummary(null)
    setExam(createExamSession(route.id, route.name_ka))
    triggeredRef.current = new Set()
    handledOrdersRef.current = new Set()
    inFlightPinRef.current = null
    inFlightOrderRef.current = null
    approachRef.current = null
    cueEpochRef.current += 1
    resumedSlugRef.current = null
    setSelection(null)
    setStartNotice(null)
    setNextPin(sortedPins[0] ?? null)
    setLastSpoken(null)
    setElapsedMs(0)
    sessionStartRef.current = 0
    clearActiveExam() // Clear saved state when restarting
    setSavedEpoch((v) => v + 1)
  }

  const nextPinDistanceLabel =
    active && pinsActive && nextPin && userPos && showVoiceInToolbar
      ? (() => {
          const meters = Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng]))
          return meters <= 9999 ? `${meters} მ` : '—'
        })()
      : null

  const sessionLayout = mapOnly ? 'nav-only' : features.canSwitchViews ? 'switchable' : 'panel-only'
  const mapCenter: LatLng | null =
    userPos ?? polyline[0] ?? ([TELAVI_CENTER.lat, TELAVI_CENTER.lng] as LatLng)
  const shouldRenderMap = Boolean(active && showMapView && mapCenter)
  const mapConditions = {
    showMapView,
    hasUserPos: !!userPos,
    hasPolyline: !!polyline[0],
    shouldRenderMap,
  }

  return (
    <>
    <div
      className={`exam-session exam-session--${layoutMode} exam-session--${sessionLayout}${active ? ' exam-session--active' : ''}`}
    >
      {active && (
        <>
          <ExamScoreboard
            elapsedMs={elapsedMs}
            speedKmh={speedKmh}
            speedLimitKmh={speedLimitKmh}
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

          {resumeError && <p className="error-text">{resumeError}</p>}

          {startSelection && (
            <div className="exam-start-pin" role="status" data-testid="start-pin-selection">
              <p className="exam-start-pin__text">
                {startSelection.status === 'wait' && startSelection.reason === 'gps'
                  ? `საწყისი PIN-ის დასადგენად ზუსტ GPS მდებარეობას ველოდები (≤ ${START_MAX_ACCURACY_M} მ)…`
                  : startSelection.status === 'wait'
                    ? 'რამდენიმე PIN ახლოსაა — დაიძარით, რომ მიმართულებით დადგინდეს, ან აირჩიეთ:'
                    : 'საწყისი PIN ზუსტად ვერ დადგინდა — აირჩიეთ, საიდან გაგრძელდეს:'}
              </p>
              {startSelection.candidates.length > 0 && (
                <div className="exam-start-pin__choices">
                  {[...new Set([voicePins[0]?.sort_order, ...startSelection.candidates])]
                    .filter((order): order is number => typeof order === 'number')
                    .map((order) => {
                      const pin = voicePins.find((p) => p.sort_order === order)
                      const isFirst = order === voicePins[0]?.sort_order
                      return (
                        <button
                          key={order}
                          type="button"
                          className="exam-start-pin__choice"
                          onClick={() =>
                            applyStartPin(order, isFirst ? null : `გამოცდა იწყება PIN ${order}-დან (არჩეული)`)
                          }
                        >
                          <strong>PIN {order}{isFirst ? ' · დასაწყისი' : ''}</strong>
                          {pin?.instruction_ka && <small>{pin.instruction_ka}</small>}
                        </button>
                      )
                    })}
                </div>
              )}
            </div>
          )}
          {!startSelection && startNotice && (
            <p className="exam-start-pin exam-start-pin__text" role="status" data-testid="start-pin-notice">
              {startNotice}
            </p>
          )}

          <div className="exam-drive-main">
            {shouldRenderMap && mapCenter && (
              <ExamLiveMap route={route} userPos={mapCenter} heading={heading} nextPin={nextPin} />
            )}
            {showPanelView && <ExamErrorGrid counts={exam.counts} onError={handleError} />}
          </div>

          {pinDebug && (
            <div className="exam-pin-debug" data-testid="pin-debug" aria-live="off">
              {pinDiag ? (
                <>
                  <div>
                    შემდეგი PIN {pinDiag.nextOrder ?? '—'} · {pinDiag.handled}/{pinDiag.total} გავლილი
                    {pinDiag.inFlightOrder !== null && ` · რიგში PIN ${pinDiag.inFlightOrder}`}
                  </div>
                  <div>
                    მანძილი {pinDiag.distanceM == null ? '—' : Math.round(pinDiag.distanceM)} მ · ტრიგერი{' '}
                    {pinDiag.triggerM ?? '—'} მ
                  </div>
                  <div>
                    მიმართ. {pinDiag.headingDeg == null ? 'არ არის' : `${Math.round(pinDiag.headingDeg)}°`} · PIN-ისკენ{' '}
                    {pinDiag.bearingToPin == null ? '—' : `${Math.round(pinDiag.bearingToPin)}°`} · სხვაობა{' '}
                    {pinDiag.headingDiff == null ? '—' : `${Math.round(pinDiag.headingDiff)}°`} {pinDiag.facing ? '✓' : '✗'}
                  </div>
                  <div>
                    სიზუსტე {Math.round(pinDiag.accuracyM)} მ {pinDiag.accuracyOk ? '✓' : '✗'} · სიჩქ.{' '}
                    {pinDiag.speedKmh == null ? '—' : Math.round(pinDiag.speedKmh)} კმ/სთ
                    {pinDiag.rejected && ' · ბოლო GPS უარყოფილია'}
                  </div>
                  <div>
                    <strong>{PIN_CUE_REASON_TEXT[pinDiag.reason]}</strong>
                    {!pinDiag.phaseActive && ' · გამოცდა აქტიური არ არის'} ·{' '}
                    {new Date(pinDiag.fixAt).toLocaleTimeString('ka-GE', { hour12: false })}
                  </div>
                </>
              ) : (
                <div>GPS წერტილს ველოდები…</div>
              )}
              {pinEvents.map((event) => (
                <div key={event} className="exam-pin-debug__event">
                  {event}
                </div>
              ))}
            </div>
          )}

          <button type="button" className="exam-finish-fab" onClick={finishSession}>
            დასრულება
          </button>
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
            {resumeError && <p className="error-text">{resumeError}</p>}
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
      
      {/* DEBUG PANEL - Session diagnostic */}
      {debugSessionVisible && (
        <div style={{
          position: 'fixed',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.95)',
          color: '#0ff',
          padding: '12px',
          borderRadius: '8px',
          fontSize: '11px',
          fontFamily: 'monospace',
          zIndex: 99999,
          maxWidth: '300px',
          border: '2px solid #0ff',
          boxShadow: '0 0 20px rgba(0,255,255,0.5)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <strong style={{ color: '#ff0' }}>🔍 SESSION DIAGNOSTIC</strong>
            <button 
              onClick={() => setDebugSessionVisible(false)}
              style={{
                background: '#f00',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: '10px'
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ lineHeight: '1.7' }}>
            <div style={{ 
              background: phase === 'active' ? '#0a0' : phase === 'preview' ? '#fa0' : '#666',
              padding: '4px 8px',
              marginBottom: '8px',
              fontWeight: 'bold',
              textAlign: 'center',
              color: '#000'
            }}>
              PHASE: {phase.toUpperCase()}
            </div>
            
            <div><strong>route.id:</strong> {route.id}</div>
            <div><strong>savedState:</strong> {savedState ? '✅' : '❌'}</div>
            <div><strong>exam exists:</strong> {exam ? '✅' : '❌'}</div>
            <div><strong>gpsStarted:</strong> {gpsStarted ? '✅' : '❌'}</div>
            <div><strong>userPos:</strong> {userPos ? `✅ [${userPos[0].toFixed(4)}, ${userPos[1].toFixed(4)}]` : '❌'}</div>
            
            <hr style={{ margin: '8px 0', borderColor: '#0ff' }} />
            
            <div><strong>active:</strong> {active ? '✅' : '❌'}</div>
            <div><strong>showMapView:</strong> {mapConditions.showMapView ? '✅' : '❌'}</div>
            <div><strong>hasUserPos:</strong> {mapConditions.hasUserPos ? '✅' : '❌'}</div>
            <div><strong>hasPolyline[0]:</strong> {mapConditions.hasPolyline ? '✅' : '❌'}</div>
            
            <hr style={{ margin: '8px 0', borderColor: '#0ff' }} />
            
            <div style={{
              background: mapConditions.shouldRenderMap ? '#0a0' : '#f00',
              padding: '6px 8px',
              marginTop: '6px',
              fontWeight: 'bold',
              textAlign: 'center',
              color: '#fff',
              borderRadius: '4px'
            }}>
              {mapConditions.shouldRenderMap ? '✅ MAP SHOULD RENDER' : '❌ MAP BLOCKED'}
            </div>
            
            {!mapConditions.shouldRenderMap && (
              <div style={{ marginTop: '6px', fontSize: '10px', color: '#f00', fontWeight: 'bold' }}>
                REASON:
                {!active && <div>• phase ≠ active</div>}
                {!mapConditions.showMapView && <div>• showMapView = false</div>}
                {!mapConditions.hasUserPos && !mapConditions.hasPolyline && <div>• no userPos & no polyline</div>}
              </div>
            )}
            
            <hr style={{ margin: '8px 0', borderColor: '#0ff' }} />
            <div style={{ fontSize: '9px', color: '#888' }}>
              Updated: {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  )
}
