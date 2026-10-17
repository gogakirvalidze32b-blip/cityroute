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
  EXAM_START_TEXT,
  isStartPinAlreadyAnnounced,
} from '@/data/route-audio'
import { createSpeedTracker, gpsToLatLng, resolveExamSpeedKmh, resolveHeading } from '@/lib/route-nav'
import { createGpsFilter, type GpsReading } from '@/lib/gps-filter'
import {
  AUDIO_HEADING_TOLERANCE_DEG,
  AUDIO_MAX_ATTEMPTS,
  AUDIO_TRIGGER_DISTANCE_M,
  audioHeadingOk,
  decidePinAudio,
} from '@/lib/pin-audio'
import { examRoadTrace } from '@/lib/pin-route-line'
import {
  nextSortOrder,
  ordersForIds,
  pinIdsForOrders,
  resolveExamResume,
  savedHandledOrders,
} from '@/lib/route-resume'
import { chooseStartPin } from '@/lib/start-pin'
import type { PinRow, RouteWithPins } from '@/types/database'
import { TELAVI_CENTER } from '@/data/telavi-landmarks'

type Phase = 'preview' | 'active' | 'summary'

/** Sort-order resume for Telavi exam routes and the local Tbilisi GPS test city. */
const FIELD_TEST_SLUGS = new Set(['route-1', 'route-2', 'route-3', 'route-4', 'test-route-tbilisi'])

function initialHandledOrders(
  saved: SavedExamState,
  pins: readonly PinRow[],
  routeSlug: string,
): Set<number> | null {
  const orders = savedHandledOrders(saved, pins, routeSlug)
  return orders === 'invalid' ? null : orders
}

/** Only the newest mounted session may write on pagehide / unmount. */
let examSaveOwner = 0

// Per-GPS-fix diagnostics are development-only (production keeps console quiet).
const devLog: typeof console.log = (...args) => {
  if (import.meta.env.DEV) console.log(...args)
}

type Props = {
  route: RouteWithPins
  onPhaseChange?: (phase: Phase) => void
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
  const [phase, setPhase] = useState<Phase>(savedState ? 'active' : 'preview')
  // Same-render sync: slug match after local→UUID must not paint preview+saved (empty map).
  if (savedState && phase === 'preview') {
    setPhase('active')
  }
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
  const [elapsedMs, setElapsedMs] = useState(() => (savedState ? examElapsedMsNow(savedState) : 0))
  const [nextPin, setNextPin] = useState<PinRow | null>(null)
  const [lastSpoken, setLastSpoken] = useState<string | null>(null)
  const [routeComplete, setRouteComplete] = useState(false)
  /** After mid-route დასრულება, summary offers გაგრძელება using kept localStorage progress. */
  const [summaryCanContinue, setSummaryCanContinue] = useState(false)
  const resumePendingRef = useRef(false)
  
  // DEBUG: Session diagnostic panel state
  // Production: panel and its 500 ms re-render timer are off. Development: unchanged.
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
  /** Routes 2/3: handled pins by sort_order (Tbilisi resume). Null until a save can be placed. */
  const handledOrdersRef = useRef<Set<number> | null>(
    FIELD_TEST_SLUGS.has(route.slug)
      ? savedState
        ? initialHandledOrders(savedState, route.pins, route.slug)
        : new Set()
      : null,
  )
  // Audio catch-up bookkeeping (closest approach per PIN, failed-playback attempts). Not persisted.
  const pinApproachRef = useRef<Map<string, number>>(new Map())
  const audioAttemptsRef = useRef<Map<string, number>>(new Map())
  const releaseWake = useRef<(() => void) | null>(null)
  const sessionStartRef = useRef(savedState ? examSessionOriginMs(savedState) : 0)
  const resumedSlugRef = useRef<string | null>(savedState ? route.slug : null)
  const finishInProgressRef = useRef(false)
  const saveOwnerRef = useRef(0)
  const saveNowRef = useRef<(() => void) | null>(null)
  const prevGpsRef = useRef<GpsPosition | null>(null)
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
  const pinsRef = useRef(sortedPins)
  pinsRef.current = sortedPins
  const voicePins = useMemo(
    () => enrichPinsWithLocalAudio(route.slug, sortedPins),
    [route.slug, sortedPins],
  )
  const pinsActive = voicePins.length > 0
  const active = phase === 'active'
  const layoutMode = useExamLayoutMode()

  const mapOnly = features.mapNav && !features.errorPanel
  const panelOnly = features.errorPanel && !features.mapNav
  const showMapView = active && features.mapNav && driveView === 'map'
  const showPanelView = active && features.errorPanel && (panelOnly || (features.canSwitchViews && driveView === 'panel'))
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

    const saved = loadActiveExam(route.id, route.slug, route.name_ka)

    if (saved) {
      if (resumedSlugRef.current !== route.slug) {
        resumedSlugRef.current = route.slug
        triggeredRef.current = new Set(saved.triggeredPins)
        sessionStartRef.current = examSessionOriginMs(saved)
        setExam(saved.exam)
        setExamSummary(null)
        setUserPos(saved.userPos)
        setHeading(saved.heading)
        setSpeedKmh(saved.speedKmh)
        setElapsedMs(examElapsedMsNow(saved))
        setGpsStarted(true)
        setDriveView(features.mapNav ? 'map' : 'panel')
        if (FIELD_TEST_SLUGS.has(route.slug)) {
          handledOrdersRef.current = initialHandledOrders(saved, sortedPins, route.slug)
          const resolution = resolveExamResume(saved, sortedPins, route.slug)
          if (resolution.status === 'resume') {
            resumePendingRef.current = resolution.handledOrders === null
            if (resolution.handledOrders) {
              handledOrdersRef.current = new Set(resolution.handledOrders)
              triggeredRef.current = pinIdsForOrders(sortedPins, handledOrdersRef.current)
              setNextPin(sortedPins.find((pin) => pin.sort_order === resolution.nextSortOrder) ?? null)
              setRouteComplete(
                sortedPins.length > 0 && resolution.nextSortOrder === null,
              )
            }
          } else if (resolution.status === 'pending') {
            resumePendingRef.current = true
          }
        }
        console.log('🔄 Resuming saved exam session', route.slug)
      }
      setPhase('active')
      return
    }

    // Slug says a session exists; local id may not have matched yet. Do not reset to preview.
    if (hasSavedExamForSlug(route.slug, route.name_ka)) {
      setPhase('active')
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
    setLastSpoken(null)
    triggeredRef.current = new Set()
    if (FIELD_TEST_SLUGS.has(route.slug)) handledOrdersRef.current = new Set()
    resumePendingRef.current = false
    setRouteComplete(false)
    setNextPin(sortedPins[0] ?? null)
    prevGpsRef.current = null
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
    setSpeedKmh(0)
    setHeading(0)
  }, [route.id, route.slug, route.name_ka, sortedPins, features.mapNav])

  // Local p2-/p3- ids and Supabase UUIDs share sort_order. Progress is kept by sort_order,
  // so a pin list swap re-derives the handled ids instead of dropping or guessing them.
  useEffect(() => {
    if (!FIELD_TEST_SLUGS.has(route.slug)) return
    if (handledOrdersRef.current === null) {
      const derived = ordersForIds(triggeredRef.current, sortedPins, route.slug)
      if (sortedPins.length === 0) return
      if (derived.unknown.length > 0) {
        resumePendingRef.current = true
        return
      }
      handledOrdersRef.current = derived.orders
    }
    triggeredRef.current = pinIdsForOrders(sortedPins, handledOrdersRef.current)
    resumePendingRef.current = false
    if (phaseRef.current !== 'active') return
    const progress = nextSortOrder(sortedPins, handledOrdersRef.current)
    setNextPin(sortedPins.find((pin) => pin.sort_order === progress.nextSortOrder) ?? null)
    setRouteComplete(sortedPins.length > 0 && progress.nextSortOrder === null)
  }, [sortedPins, route.id, route.slug, route.name_ka])

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
      return { position: raw, fix: pos, denied: false }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'GPS შეცდომა'
      setGpsError(msg)
      if (msg.includes('უარყოფილი')) clearGpsConsent()
      if (!msg.includes('უარყოფილი') && !getGpsEnvironmentIssue()) setGpsStarted(true)
      return { position: null, fix: null, denied: msg.includes('უარყოფილი') }
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

  // Browser autoplay: the audio engine must be unlocked by a real user interaction.
  // Covers resume-after-reload where the "start" button is never pressed again.
  useEffect(() => {
    const unlock = () => audioEngine.unlock()
    const opts = { capture: true, passive: true, once: true } as const
    window.addEventListener('pointerdown', unlock, opts)
    window.addEventListener('touchend', unlock, opts)
    window.addEventListener('keydown', unlock, opts)
    return () => {
      window.removeEventListener('pointerdown', unlock, opts)
      window.removeEventListener('touchend', unlock, opts)
      window.removeEventListener('keydown', unlock, opts)
    }
  }, [])

  // Preload may re-run when remote pins replace local ones. Never stopAll() here —
  // that cleanup used to cut mid-PIN voice whenever sortedPins got a new array.
  useEffect(() => {
    const preload = () => audioEngine.preloadAll(collectPreloadAudioUrls(route.slug, sortedPins))
    const t = window.setTimeout(preload, 800)
    return () => window.clearTimeout(t)
  }, [route.id, route.slug, sortedPins])

  // Wake lock + stop voices only when this session unmounts (or finishSession).
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

    saveOwnerRef.current = ++examSaveOwner
    const saveState = () => {
      if (finishInProgressRef.current) return // Guard against saving during finish
      if (saveOwnerRef.current !== examSaveOwner) return // a newer session already owns storage
      const liveElapsed = sessionStartRef.current
        ? Math.max(0, Date.now() - sessionStartRef.current)
        : elapsedMs
      const pins = pinsRef.current
      const fieldTest = FIELD_TEST_SLUGS.has(route.slug)
        ? (() => {
            const orders = handledOrdersRef.current
            if (orders === null) return {}
            const sorted = [...orders].sort((a, b) => a - b)
            if (pins.length === 0) {
              const previous = loadActiveExam(route.id, route.slug, route.name_ka)
              return {
                triggeredSortOrders: sorted,
                lastPassedSortOrder:
                  previous?.lastPassedSortOrder ?? (sorted.length ? sorted[sorted.length - 1]! : null),
                nextSortOrder: previous?.nextSortOrder ?? null,
              }
            }
            const progress = nextSortOrder(pins, orders)
            return {
              triggeredSortOrders: sorted,
              lastPassedSortOrder: progress.lastPassedSortOrder,
              nextSortOrder: progress.nextSortOrder,
            }
          })()
        : {}
      saveActiveExam({
        routeId: route.id,
        routeSlug: route.slug,
        routeName: route.name_ka,
        phase: 'active',
        exam,
        userPos,
        heading,
        speedKmh,
        elapsedMs: liveElapsed,
        triggeredPins: Array.from(triggeredRef.current),
        ...fieldTest,
        savedAt: Date.now(),
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
  }, [phase, route.id, route.slug, route.name_ka, exam, userPos, heading, speedKmh, elapsedMs, sortedPins])

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

        // ============================================================
        // STRICT SEQUENTIAL PIN LOGIC
        // ============================================================
        // Only ONE pin can be "next" at any time.
        // All other pins are IGNORED regardless of proximity.
        // 
        // Rule: PIN N can only trigger after PIN N-1 has triggered.
        // No skipping. No going backwards. No proximity-based activation.
        // ============================================================
        
        const triggeredCount = triggeredRef.current.size
        const totalPins = voicePins.length
        const fieldTest = FIELD_TEST_SLUGS.has(route.slug)
        if (fieldTest && handledOrdersRef.current === null) {
          setNextPin(null)
          return
        }
        if (fieldTest && handledOrdersRef.current) {
          triggeredRef.current = pinIdsForOrders(voicePins, handledOrdersRef.current)
        }
        
        // Find the FIRST untriggered pin in sequence
        // This is THE ONLY pin that can trigger right now
        const nextPinIndex = voicePins.findIndex((p) => !triggeredRef.current.has(p.id))
        const pending = nextPinIndex >= 0 ? voicePins[nextPinIndex] : null
        
        setNextPin(pending ?? null)
        if (fieldTest && handledOrdersRef.current && totalPins > 0) {
          setRouteComplete(nextSortOrder(voicePins, handledOrdersRef.current).nextSortOrder === null)
        }
        
        // Log current state
        if (pending) {
          devLog('[PIN SEQUENCE]',
            route.slug.toUpperCase(),
            '| Expected: #' + (nextPinIndex + 1),
            '| ID:', pending.id,
            '| Progress:', triggeredCount + '/' + totalPins
          )
        }
        
        // Check if user is near ANY other pin (for diagnostic logging only)
        voicePins.forEach((pin, idx) => {
          // Skip if this is the expected pin or already triggered
          if (idx === nextPinIndex || triggeredRef.current.has(pin.id)) return
          
          const distToOther = distanceToPinMeters(raw, [pin.lat, pin.lng])
          
          // If user is close to a non-expected pin, log it as IGNORED
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

        // აუდიო ყოველთვის ითამაშოს თუ routeAudio feature enabled-ია, view-ის მიუხედავად
        if (!pending || phase !== 'active' || !features.routeAudio) return

        // First PIN is already announced by the ▶ start audio.
        if (isStartPinAlreadyAnnounced(route.slug, pending.id)) {
          triggeredRef.current.add(pending.id)
          return
        }

        // Audio trigger distance: AUDIO_TRIGGER_DISTANCE_M (20 m) — PIN detection above is unchanged.
        // Audio heading tolerance: AUDIO_HEADING_TOLERANCE_DEG (90°), skipped at very low speed.
        const pinPoint = (i: number): LatLng => [voicePins[i].lat, voicePins[i].lng]
        const dist = distanceToPinMeters(raw, pinPoint(nextPinIndex))

        const decision = decidePinAudio({
          pinIds: voicePins.map((p) => p.id),
          triggered: triggeredRef.current,
          distanceTo: (i) => distanceToPinMeters(raw, pinPoint(i)),
          headingOkAt: (i) =>
            audioHeadingOk(headingMatches(raw, pinPoint(i), pos.heading, AUDIO_HEADING_TOLERANCE_DEG), pos.speed),
          minDist: pinApproachRef.current,
          busy: audioEngine.isBusy(),
        })

        devLog('[PIN SEQUENCE]',
          route.slug.toUpperCase(),
          '| Expected: #' + (nextPinIndex + 1),
          '| Distance:', Math.round(dist) + 'm',
          '| Status:', dist <= AUDIO_TRIGGER_DISTANCE_M ? 'IN RANGE' : 'WAITING',
          '| Decision:', decision ? decision.reason + ' #' + (decision.index + 1) : 'none',
        )

        if (!decision) return

        // Routes 2/3 follow Tbilisi: never skip a pin, never mark it done without visiting it.
        if (fieldTest && (decision.reason === 'lookahead' || decision.skipped.length > 0 || decision.index !== nextPinIndex)) {
          return
        }

        // Missed PINs on routes 1/4: mark as passed, never speak a stale instruction.
        if (!fieldTest) {
          decision.skipped.forEach((i) => triggeredRef.current.add(voicePins[i].id))
        }

        const target = voicePins[decision.index]
        devLog('[PIN SEQUENCE]',
          route.slug.toUpperCase(),
          '| 🔊 PIN #' + (decision.index + 1) + ' TRIGGERED (' + decision.reason + ')!',
          '| Audio:', target.instruction_ka,
          '| Progress:', (triggeredRef.current.size + 1) + '/' + totalPins,
        )
        // Mark first (GPS fires every second) so the same PIN can never be spoken twice.
        triggeredRef.current.add(target.id)
        if (fieldTest) {
          const orders = handledOrdersRef.current ?? new Set<number>()
          orders.add(target.sort_order)
          handledOrdersRef.current = orders
          triggeredRef.current = pinIdsForOrders(pinsRef.current, orders)
          const upcoming = nextSortOrder(pinsRef.current, orders).nextSortOrder
          setNextPin(pinsRef.current.find((pin) => pin.sort_order === upcoming) ?? null)
          setRouteComplete(pinsRef.current.length > 0 && upcoming === null)
        }
        setLastSpoken(target.instruction_ka)
        saveNowRef.current?.()
        void audioEngine.playDetailed(target.audio_url, target.id, target.instruction_ka).then((status) => {
          if (status !== 'failed' || phaseRef.current !== 'active') return
          // Original WAV failed: allow a few retries. Never fall back to browser TTS.
          const key = route.slug + ':' + target.id
          const attempts = (audioAttemptsRef.current.get(key) ?? 0) + 1
          audioAttemptsRef.current.set(key, attempts)
          if (attempts < AUDIO_MAX_ATTEMPTS) {
            triggeredRef.current.delete(target.id)
            if (fieldTest && handledOrdersRef.current) {
              handledOrdersRef.current.delete(target.sort_order)
            }
          } else console.warn('[AUDIO] giving up on PIN voice after', attempts, 'attempts:', target.id)
        })
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

  function startSession(fix: GpsPosition | null) {
    finishInProgressRef.current = false
    triggeredRef.current = new Set()
    pinApproachRef.current = new Map()
    audioAttemptsRef.current = new Map()
    const firstPin = voicePins[0]
    if (firstPin && isStartPinAlreadyAnnounced(route.slug, firstPin.id)) {
      triggeredRef.current.add(firstPin.id)
    }
    // New exam only. Resume never reaches here. A fallback or an ambiguous fix
    // keeps the existing sequence from PIN 1; street lines and pin audio stay as they are.
    if (fix && FIELD_TEST_SLUGS.has(route.slug) && voicePins.length > 0) {
      const decision = chooseStartPin(
        voicePins,
        {
          position: [fix.lat, fix.lng],
          accuracyM: fix.accuracy,
          headingDeg: fix.heading,
          speedMps: fix.speed,
        },
        examRoadTrace(route.slug, voicePins),
      )
      if (decision.kind === 'start') {
        for (const pin of voicePins) {
          if (pin.sort_order < decision.sortOrder) triggeredRef.current.add(pin.id)
        }
      }
    }
    if (FIELD_TEST_SLUGS.has(route.slug)) {
      handledOrdersRef.current = new Set(
        voicePins.filter((pin) => triggeredRef.current.has(pin.id)).map((pin) => pin.sort_order),
      )
    }
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setRouteComplete(false)
    resumePendingRef.current = false
    sessionStartRef.current = Date.now()
    setElapsedMs(0)
    setLastSpoken(EXAM_START_TEXT)
    
    // Apply sequence logic: Finish pins (last 3) should not be shown as next pin at start
    const triggeredCount = triggeredRef.current.size
    const totalPins = voicePins.length
    const finishSectionStart = Math.max(0, totalPins - 3)
    
    const nextPinCandidate = voicePins.find((p, idx) => {
      if (triggeredRef.current.has(p.id)) return false
      if (idx >= finishSectionStart && triggeredCount < finishSectionStart) return false
      return true
    })
    
    setNextPin(nextPinCandidate ?? null)
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
    setSpeedKmh(0)
    setDriveView(features.mapNav ? 'map' : 'panel')
    setPhase('active')
    resumedSlugRef.current = route.slug
    // Session-start voice disabled: PIN navigation voices still play via GPS.
  }

  async function handleStartSession() {
    // Must run synchronously inside the click, before any await (GPS prompt would lose the gesture).
    audioEngine.unlock()
    if (gpsStarting) return
    
    // ============================================================
    // If savedState exists, we're RESUMING - don't reset session!
    // Just ensure GPS is ready and stay in active phase
    // ============================================================
    if (savedState) {
      console.log('🔄 Resuming active session - not calling startSession()')
      if (FIELD_TEST_SLUGS.has(route.slug)) {
        const resolution = resolveExamResume(savedState, voicePins, route.slug)
        if (resolution.status === 'resume' && resolution.handledOrders) {
          handledOrdersRef.current = new Set(resolution.handledOrders)
          triggeredRef.current = pinIdsForOrders(voicePins, handledOrdersRef.current)
          setNextPin(voicePins.find((pin) => pin.sort_order === resolution.nextSortOrder) ?? null)
          setRouteComplete(voicePins.length > 0 && resolution.nextSortOrder === null)
          resumePendingRef.current = false
        }
      }
      if (phase !== 'active') setPhase('active')
      if (!gpsStarted) {
        await enableGps(true)
      }
      return
    }
    
    // No saved state - this is a NEW session. Resume returned above.
    const gpsResult = rawPos ? { position: userPos, fix: rawPos, denied: false } : await enableGps(false)
    if (gpsResult.denied) return
    startSession(gpsResult.fix)
  }

  function fieldTestProgressFields() {
    const pins = pinsRef.current
    const orders = handledOrdersRef.current
    if (orders === null) return {}
    const sorted = [...orders].sort((a, b) => a - b)
    if (pins.length === 0) {
      const previous = loadActiveExam(route.id, route.slug, route.name_ka)
      return {
        triggeredSortOrders: sorted,
        lastPassedSortOrder:
          previous?.lastPassedSortOrder ?? (sorted.length ? sorted[sorted.length - 1]! : null),
        nextSortOrder: previous?.nextSortOrder ?? null,
      }
    }
    const progress = nextSortOrder(pins, orders)
    return {
      triggeredSortOrders: sorted,
      lastPassedSortOrder: progress.lastPassedSortOrder,
      nextSortOrder: progress.nextSortOrder,
    }
  }

  function persistActiveExamNow() {
    const liveElapsed = sessionStartRef.current
      ? Math.max(0, Date.now() - sessionStartRef.current)
      : elapsedMs
    saveActiveExam({
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      exam,
      userPos,
      heading,
      speedKmh,
      elapsedMs: liveElapsed,
      triggeredPins: Array.from(triggeredRef.current),
      ...(FIELD_TEST_SLUGS.has(route.slug) ? fieldTestProgressFields() : {}),
      savedAt: Date.now(),
    })
  }

  /** True when Telavi field-test routes still have an unhandled PIN (mid-route stop). */
  function routeHasRemainingPins(): boolean {
    if (!FIELD_TEST_SLUGS.has(route.slug)) return false
    const pins = pinsRef.current
    if (pins.length === 0) return false
    const orders = handledOrdersRef.current ?? new Set<number>()
    return nextSortOrder(pins, orders).nextSortOrder !== null
  }

  function applySavedProgress(saved: SavedExamState) {
    triggeredRef.current = new Set(saved.triggeredPins)
    sessionStartRef.current = examSessionOriginMs(saved)
    setExam(saved.exam)
    setUserPos(saved.userPos)
    setHeading(saved.heading)
    setSpeedKmh(saved.speedKmh)
    setElapsedMs(examElapsedMsNow(saved))
    setGpsStarted(true)
    if (FIELD_TEST_SLUGS.has(route.slug)) {
      const resolution = resolveExamResume(saved, pinsRef.current, route.slug)
      if (resolution.status === 'resume' && resolution.handledOrders) {
        handledOrdersRef.current = new Set(resolution.handledOrders)
        triggeredRef.current = pinIdsForOrders(pinsRef.current, handledOrdersRef.current)
        setNextPin(pinsRef.current.find((pin) => pin.sort_order === resolution.nextSortOrder) ?? null)
        setRouteComplete(pinsRef.current.length > 0 && resolution.nextSortOrder === null)
        resumePendingRef.current = false
      } else {
        handledOrdersRef.current = initialHandledOrders(saved, pinsRef.current, route.slug)
        resumePendingRef.current = resolution.status === 'pending' || resolution.status === 'resume'
      }
    }
    resumedSlugRef.current = route.slug
  }

  function finishSession() {
    finishInProgressRef.current = true
    setRouteComplete(false)
    // Mid-route stop must keep progress so a later start resumes (even from the agency GPS).
    // Only a fully handled route (or non-field-test) clears — same as explicit თავიდან.
    const keepForResume = routeHasRemainingPins()
    if (keepForResume) {
      persistActiveExamNow()
      setSummaryCanContinue(true)
    } else {
      clearActiveExam()
      setSummaryCanContinue(false)
    }
    setSavedEpoch((v) => v + 1)
    const summary = finishExamSession(exam)
    saveExamSummary(summary)
    setExamSummary(summary)
    setPhase('summary')
    releaseWake.current?.()
    audioEngine.stopAll()
    if (!keepForResume) resumedSlugRef.current = null
    // Session-success voice disabled: do not play EXAM_SUCCESS_AUDIO.
  }

  function continueFromSummary() {
    const saved = loadActiveExam(route.id, route.slug, route.name_ka)
    if (!saved) {
      restartPreview()
      return
    }
    finishInProgressRef.current = false
    setSummaryCanContinue(false)
    setExamSummary(null)
    applySavedProgress(saved)
    setDriveView(features.mapNav ? 'map' : 'panel')
    setPhase('active')
    setSavedEpoch((v) => v + 1)
    if (!gpsStarted) void enableGps(true)
  }

  function restartPreview() {
    finishInProgressRef.current = false
    setPhase('preview')
    setExamSummary(null)
    setSummaryCanContinue(false)
    setExam(createExamSession(route.id, route.name_ka))
    triggeredRef.current = new Set()
    pinApproachRef.current = new Map()
    audioAttemptsRef.current = new Map()
    if (FIELD_TEST_SLUGS.has(route.slug)) handledOrdersRef.current = new Set()
    resumedSlugRef.current = null
    resumePendingRef.current = false
    setRouteComplete(false)
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
          <div className="exam-topbar">
            <ExamScoreboard
              elapsedMs={elapsedMs}
              speedKmh={speedKmh}
              minorTotal={exam.minorTotal}
              severeTotal={exam.severeTotal}
              onRecordSevere={handleSevereQuick}
              showErrors={features.errorPanel && (panelOnly || driveView === 'panel')}
              compact={mapOnly}
            />

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

            {features.canSwitchViews && <ExamViewSwitcher view={driveView} onChange={setDriveView} />}

            <button type="button" className="exam-finish-fab" onClick={finishSession}>
              დასრულება
            </button>
          </div>

          {routeComplete && FIELD_TEST_SLUGS.has(route.slug) && (
            <div
              role="status"
              data-testid="route-complete"
              style={{
                position: 'relative',
                zIndex: 20,
                margin: '0.5rem',
                padding: '0.75rem',
                borderRadius: '8px',
                background: '#ecfdf5',
                border: '2px solid #10b981',
              }}
            >
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: '#065f46' }}>
                მარშრუტი დასრულებულია — ყველა PIN გავლილია.
              </p>
              <button
                type="button"
                className="nav-start-btn"
                style={{ marginTop: '0.5rem' }}
                onClick={restartPreview}
              >
                თავიდან დაწყება
              </button>
            </div>
          )}

          <div className="exam-drive-main">
            {shouldRenderMap && mapCenter && (
              <ExamLiveMap route={route} userPos={mapCenter} heading={heading} nextPin={nextPin} />
            )}
            {showPanelView && <ExamErrorGrid counts={exam.counts} onError={handleError} />}
          </div>

        </>
      )}

      {phase === 'preview' && !savedState && (
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
        <ExamSummary
          summary={examSummary}
          onRestart={restartPreview}
          onContinue={summaryCanContinue ? continueFromSummary : undefined}
        />
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
