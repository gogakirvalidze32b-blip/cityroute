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
import type { PlanFeatures } from '@/lib/plan-features'
import { audioEngine, type PlaybackFailureReason } from '@/lib/audio'
import {
  createExamSession,
  finishExamSession,
  formatExamDuration,
  isExamFailed,
  loadExamHistory,
  recordExamError,
  recordSevereQuick,
  saveExamSummary,
  type ExamSessionSummary,
} from '@/lib/exam-session'
import {
  isSavedExamState,
  applyRemoteExamSaveVersion,
  loadActiveExam,
  saveActiveExam,
  clearActiveExam,
  examSessionOriginMs,
  examElapsedMsNow,
  hasSavedExamForSlug,
  loadDriveView,
  reconcileRemoteExamProgress,
  saveDriveView,
  type SavedExamState,
} from '@/lib/exam-persistence'
import {
  abandonRemoteExamSession,
  createRemoteExamSession,
  getRemoteExamSession,
  listRemoteExamSessions,
  newExamSessionMigrationKey,
  REMOTE_EXAM_SESSION_BACKEND_ENABLED,
  releaseExamTabLease,
  RemoteExamSessionWriter,
  toJson,
} from '@/lib/exam-session-edge'
import { createExamSessionLifecycle } from '@/lib/exam-session-lifecycle'
import { isSupabaseConfigured } from '@/lib/supabase'
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
} from '@/data/route-audio'
import {
  isFinishAudioAllowed,
  isStartAudioAllowed,
} from '@/data/route-finish'
import {
  createSpeedTracker,
  gpsToLatLng,
  resolveExamSpeedKmh,
  resolveHeading,
  routeLengthMeters,
  seedAlongRouteMeters,
  stabilizeRoadArrowHeading,
} from '@/lib/route-nav'
import {
  ARROW_DEADBAND_DEG,
  ARROW_LOOK_AHEAD_M,
  ARROW_MAX_STEP_DEG,
  stepArrowTracker,
  type ArrowTrackerState,
} from '@/lib/arrow-heading'
import { createGpsFilter, type GpsReading } from '@/lib/gps-filter'
import { createRouteOdometer, distanceKmTenths } from '@/lib/route-odometer'
import {
  decideChainageFromMatch,
  decideChainageFromPinAnchor,
  resolveGpsSeedChainageMeters,
} from '@/lib/route-chainage-progress'
import { resolveAutoStart } from '@/lib/auto-start-pin'
import {
  evaluatePinRouteCompletion,
  forwardBearingAlongRoute,
  matchGpsPosition,
  positionAtChainageMeters,
  prepareRouteGeometry,
  projectOrderedPointsToRoute,
  projectPointToRoute,
  projectPointToRouteNearChainage,
  type ActiveRouteId,
  type RouteMatchState,
} from '@/lib/pure-route-geometry'
import { resolveDemoPinChainage } from '@/lib/preview-gps-demo-pin'
import {
  decideChainageTrigger,
  INITIAL_CHAINAGE_TRIGGER_STATE,
  PIN_FIRE_MAX_CROSS_TRACK_M,
  type ChainagePin,
  type ChainageTriggerState,
} from '@/lib/pin-chainage-trigger'
import {
  FIELD_DIAGNOSTICS_ENABLED,
  isChainageTriggerEnabled,
  reportPinTriggerEvent,
} from '@/lib/pin-chainage-flag'
import { recordGpsTraceFix } from '@/lib/gps-trace-recorder'
import {
  DISPLAY_LOCAL_BETTER_BY_M,
  DISPLAY_LOCAL_MAX_CROSS_TRACK_M,
  DISPLAY_LOCAL_MIN_GAP_M,
  DISPLAY_LOCAL_WINDOW_M,
  stepDisplayProgress,
  type DisplayProgress,
} from '@/lib/display-progress'
import type { VehicleMotion } from '@/lib/vehicle-motion'
import { chainagePinsForRoute } from '@/data/pin-chainage'
import { routeGeometryVersion } from '@/data/route-geometry'
import {
  clearManualPinSelection,
  loadManualPinSelection,
  saveManualPinSelection,
} from '@/lib/manual-pin-selection'
import { examRoadTrace, examRouteLine, examStreetRoad } from '@/lib/pin-route-line'
import {
  AUDIO_GPS_MAX_ACCURACY_M,
  AUDIO_GPS_MAX_CROSS_TRACK_M,
  AUDIO_HEADING_TOLERANCE_DEG,
  AUDIO_MAX_ATTEMPTS,
  audioHeadingOk,
  identifyRoundaboutGateTarget,
  pinAudioApproachWindowMeters,
  pinAudioTriggerDistanceMeters,
  pinVoicePlaybackRate,
  updateRoundaboutReturnGate,
  isRoundaboutReturnGateOpened,
  type RoundaboutReturnGateState,
  type RoundaboutPinRoute,
} from '@/lib/pin-audio'
import { advanceRoadProgressU, resolveSpeedLimitByOdometerMeters } from '@/lib/speed-limit'
import { SPEED_LIMIT_DEBUG_PANEL } from '@/lib/debug-flags'
import type { PreviewGpsSource } from '@/lib/preview-gps-source'
import {
  clearRoutePinProgress,
  loadRoutePinProgress,
  readRoutePinProgress,
  saveRoutePinProgress,
} from '@/lib/route-pin-progress'
import { SpeedLimitDebugPanel, type GpsRejectionInfo } from '@/components/SpeedLimitDebugPanel'
import {
  nextSortOrder,
  ordersForIds,
  pinIdsForOrders,
  resolveExamResume,
  resolvePinProgress,
  RESUME_UNRESOLVED_MESSAGE,
  RESUME_PENDING_MESSAGE,
  savedHandledOrders,
} from '@/lib/route-resume'
import type { PinRow, RouteWithPins } from '@/types/database'
import { TELAVI_CENTER } from '@/data/telavi-landmarks'
import { formatPinInstructionLabel } from '@/lib/pin-instruction-label'

type Phase = 'preview' | 'active' | 'summary'

const REMOTE_EXAM_SESSION_LOAD_TIMEOUT_MS = 25_000

/** Sort-order resume for Telavi exam routes and the local Tbilisi GPS test city. */
const FIELD_TEST_SLUGS = new Set(['route-1', 'route-2', 'route-3', 'route-4'])
const AUDIO_RETRY_BASE_MS = 500
const AUDIO_RETRY_MAX_MS = 4000
const AUDIO_QUEUE_WATCHDOG_MS = 13_000
/** Temporary engine busy/cancel retries before the PIN advances anyway. */
const AUDIO_BUSY_MAX_RETRIES = 8

function initialHandledOrders(
  saved: SavedExamState,
  pins: readonly PinRow[],
  routeSlug: string,
): Set<number> | null {
  const orders = savedHandledOrders(saved, pins, routeSlug)
  return orders === 'invalid' ? null : orders
}

function restoredHandledOrders(
  saved: SavedExamState,
  pins: readonly PinRow[],
  routeSlug: string,
  persistenceScope?: string,
): Set<number> | null {
  const savedOrders = initialHandledOrders(saved, pins, routeSlug)
  const routeProgress = readRoutePinProgress(routeSlug, persistenceScope)
  const routeOrders = routeProgress.status === 'valid' ? routeProgress.orders : null
  const savedPinIds = ordersForIds(saved.triggeredPins, pins, routeSlug)
  const pendingOrders = new Set(
    [saved.pendingPinSortOrder, ...(saved.queuedPinSortOrders ?? [])]
      .filter((order): order is number => Number.isInteger(order)),
  )
  const savedIdOrders = saved.triggeredSortOrders != null && saved.triggeredSortOrders.length > 0
    ? new Set<number>()
    : new Set([...savedPinIds.orders].filter((order) => !pendingOrders.has(order)))
  const hasRecoverableProgress =
    Boolean(savedOrders?.size) ||
    Boolean(routeOrders?.length) ||
    savedIdOrders.size > 0

  if (
    !hasRecoverableProgress &&
    (savedIdOrders.size === 0 && savedPinIds.unknown.length > 0 ||
      routeProgress.status === 'invalid' ||
      routeProgress.status === 'unavailable')
  ) return null
  if (savedOrders === null && !routeOrders?.length && savedIdOrders.size === 0) return null
  if (pins.length === 0) {
    return mostAdvancedPinProgress(pins, routeOrders, savedOrders, savedIdOrders)
  }
  const candidates = [routeOrders, savedOrders, savedIdOrders]
  if (
    candidates.some(
      (candidate) =>
        candidate !== null &&
        candidate !== undefined &&
        resolvePinProgress(pins, candidate).status === 'error',
    )
  ) {
    return null
  }
  const merged = mostAdvancedPinProgress(pins, routeOrders, savedOrders, savedIdOrders)
  const resolution = resolvePinProgress(pins, merged)
  return resolution.status === 'resume' ? new Set(resolution.handledOrders ?? []) : null
}

function mostAdvancedPinProgress(
  pins: readonly PinRow[],
  ...candidates: Array<Iterable<number> | null | undefined>
): Set<number> {
  const orderedPins = [...pins].sort((a, b) => a.sort_order - b.sort_order)
  let best: number[] = []

  for (const candidate of candidates) {
    const orders = new Set(candidate ?? [])
    if (orderedPins.length === 0) {
      const saved = [...orders].filter((order) => Number.isInteger(order) && order > 0).sort((a, b) => a - b)
      if (saved.length > best.length) best = saved
      continue
    }

    const prefix: number[] = []
    for (const pin of orderedPins) {
      if (!orders.has(pin.sort_order)) break
      prefix.push(pin.sort_order)
    }
    if (prefix.length > best.length) best = prefix
  }

  return new Set(best)
}

function restoreAudioQueue(
  pins: readonly PinRow[],
  pendingOrder: number | null | undefined,
  queuedOrders: number[] | undefined,
) {
  const validOrders = new Set(pins.map((pin) => pin.sort_order))
  const queued = [...new Set(
    (Array.isArray(queuedOrders) ? queuedOrders : [])
      .filter((order) => Number.isInteger(order) && validOrders.has(order)),
  )].sort((a, b) => a - b)
  const pending =
    pendingOrder !== null && pendingOrder !== undefined && validOrders.has(pendingOrder)
      ? pendingOrder
      : queued.shift() ?? null

  return {
    pending,
    queued: pending === null ? [] : queued.filter((order) => order > pending),
  }
}

/** Only the newest mounted session may write on pagehide / unmount. */
let examSaveOwner = 0
// Per-GPS-fix diagnostics ([PIN KM], [ROUTE MATCH], [PIN SEQUENCE]) run in
// development and Vercel Preview builds only, for field tests; production keeps
// the console quiet (FIELD_DIAGNOSTICS_ENABLED folds to false there).
const devLog: typeof console.log = (...args) => {
  if (FIELD_DIAGNOSTICS_ENABLED) console.log(...args)
}

type Props = {
  route: RouteWithPins
  userId?: string
  deviceId?: string
  tabId?: string
  onPhaseChange?: (phase: Phase) => void
  onReturnToMenu?: () => void
  persistenceScope?: string
  previewGpsSource?: PreviewGpsSource
  onPreviewDemoControls?: (controls: PreviewDemoControls | null) => void
  offlineMaps?: boolean
  planFeaturesOverride?: PlanFeatures
  debugPanels?: boolean
}

export type PreviewDemoStartOptions = {
  /** Known along-route chainage (demo km-seek / approach). Preserved when projections are ambiguous. */
  readonly hintChainageMeters?: number
}

export type PreviewDemoControls = {
  startAtPin: (sortOrder: number, options?: PreviewDemoStartOptions) => Promise<void>
  reset: () => void
  nextPinOrder: () => number | null
  isActive: () => boolean
  /** Manual PIN from preview map/dropdown — used by PREVIEW GPS DEMO PLAY. */
  manualStartPinOrder: () => number | null
}

export function ExamDriveSession({
  route,
  userId,
  deviceId,
  tabId,
  onPhaseChange,
  onReturnToMenu,
  persistenceScope,
  previewGpsSource,
  onPreviewDemoControls,
  offlineMaps = false,
  planFeaturesOverride,
  debugPanels,
}: Props) {
  const features = usePlanFeatures(planFeaturesOverride)
  const debugPanelEnabled = debugPanels ?? SPEED_LIMIT_DEBUG_PANEL
  
  // Try to restore saved exam state (slug survives local-route-* → Supabase UUID)
  // savedEpoch is bumped by Finish/restart so a stale memo can never resurrect a finished exam.
  const [savedEpoch, setSavedEpoch] = useState(0)
  const [remoteSavedState, setRemoteSavedState] = useState<SavedExamState | null>(null)
  const localSavedState = useMemo(
    () => loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [route.id, route.slug, route.name_ka, persistenceScope, savedEpoch],
  )
  const savedState =
    localSavedState ??
    (remoteSavedState?.routeSlug === route.slug &&
    remoteSavedState.userId === userId &&
    remoteSavedState.deviceId === deviceId
      ? remoteSavedState
      : null)
  const [remotePersistenceError, setRemotePersistenceError] = useState<string | null>(null)
  const [remoteSessionLoading, setRemoteSessionLoading] = useState(
    Boolean(REMOTE_EXAM_SESSION_BACKEND_ENABLED && isSupabaseConfigured && userId && deviceId),
  )
  const [remoteSessionCreating, setRemoteSessionCreating] = useState(false)
  const [remoteRetryToken, setRemoteRetryToken] = useState(0)
  const [remoteRestoreToken, setRemoteRestoreToken] = useState(0)
  const remoteWriterRef = useRef<RemoteExamSessionWriter | null>(null)
  const remoteSessionIdRef = useRef<string | null>(localSavedState?.examSessionId ?? null)
  const remoteLoadAttemptRef = useRef(0)
  const remoteCreatePromiseRef = useRef<Promise<void> | null>(null)
  const remoteWriteBlockedRef = useRef(false)
  const remoteWriteRevisionRef = useRef(localSavedState?.examSessionRevision ?? 0)
  const pendingRemoteWritesRef = useRef(new Set<Promise<void>>())
  const saveNowRef = useRef<((allowProgressRollback?: boolean) => void | Promise<void>) | null>(null)

  function trackRemoteWrite<T>(operation: Promise<T>): Promise<T> {
    const settled = operation.then(() => undefined, () => undefined)
    pendingRemoteWritesRef.current.add(settled)
    void settled.then(() => pendingRemoteWritesRef.current.delete(settled))
    return operation
  }

  useEffect(() => {
    if (!REMOTE_EXAM_SESSION_BACKEND_ENABLED || !isSupabaseConfigured || !userId || !deviceId || !tabId) return
    const identity = { userId, deviceId, tabId }
    const lifecycle = createExamSessionLifecycle({
      save: () => saveNowRef.current?.(),
      waitForPendingWrites: async () => {
        const pending = [...pendingRemoteWritesRef.current]
        if (remoteCreatePromiseRef.current) {
          pending.push(remoteCreatePromiseRef.current.catch(() => undefined))
        }
        await Promise.all(pending)
      },
      releaseLease: () => releaseExamTabLease(identity),
      onSaveFailure: () => {
        console.warn('Final exam progress could not be confirmed; the tab lease will expire.')
      },
      onReleaseFailure: () => {
        console.warn('Exam tab lease release could not be confirmed.')
      },
    })
    window.addEventListener('pagehide', lifecycle.pagehide)
    window.addEventListener('pageshow', lifecycle.pageshow)
    return () => {
      window.removeEventListener('pagehide', lifecycle.pagehide)
      window.removeEventListener('pageshow', lifecycle.pageshow)
      lifecycle.unmount()
    }
  }, [userId, deviceId, tabId])
  const [phase, setPhase] = useState<Phase>(() =>
    savedState?.phase === 'summary' ? 'summary' : savedState ? 'active' : 'preview',
  )
  const sessionStartModeRef = useRef<'automatic' | 'manual'>(savedState?.startMode ?? 'manual')
  // The manual choice is kept per route (slug + scope), so a refresh keeps it and another route never sees it.
  const [previewSelectionMode, setPreviewSelectionMode] = useState<'automatic' | 'manual'>(() =>
    loadManualPinSelection(route.slug, persistenceScope) !== null ? 'manual' : 'automatic',
  )
  const [previewPinSelection, setPreviewPinSelection] = useState<{
    routeId: string
    sortOrder: number
  } | null>(() => {
    const stored = loadManualPinSelection(route.slug, persistenceScope)
    return stored !== null ? { routeId: route.id, sortOrder: stored } : null
  })
  useEffect(() => {
    const stored = loadManualPinSelection(route.slug, persistenceScope)
    setPreviewSelectionMode(stored !== null ? 'manual' : 'automatic')
    setPreviewPinSelection(stored !== null ? { routeId: route.id, sortOrder: stored } : null)
  }, [route.id, route.slug, persistenceScope])
  function selectManualPin(sortOrder: number) {
    setResumeError(null)
    setPreviewPinSelection({ routeId: route.id, sortOrder })
    saveManualPinSelection(route.slug, sortOrder, persistenceScope)
  }
  // Same-render sync: slug match after local→UUID must not paint preview+saved (empty map).
  if (savedState && phase === 'preview') {
    setPhase(savedState.phase === 'summary' ? 'summary' : 'active')
  }
  const [driveView, setDriveView] = useState<ExamDriveView>(() => {
    const stored = loadDriveView(route.slug, persistenceScope)
    if (stored) return stored
    if (savedState?.driveView === 'panel' || savedState?.driveView === 'map') {
      return savedState.driveView
    }
    return 'map'
  })
  const driveViewRef = useRef<ExamDriveView>(driveView)
  driveViewRef.current = driveView
  const [exam, setExam] = useState(() =>
    savedState ? savedState.exam : createExamSession(route.id, route.name_ka),
  )
  const [examSummary, setExamSummary] = useState<ExamSessionSummary | null>(() =>
    savedState?.phase === 'summary' ? savedState.summary ?? null : null,
  )
  const [lastHistory] = useState(() => loadExamHistory(route.id, persistenceScope))
  const [initialAudioQueue] = useState(() =>
    restoreAudioQueue(route.pins, savedState?.pendingPinSortOrder, savedState?.queuedPinSortOrders),
  )

  const [gpsStarted, setGpsStarted] = useState(savedState ? true : false)
  const [gpsStarting, setGpsStarting] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(() => getGpsEnvironmentIssue())
  const [rawPos, setRawPos] = useState<GpsPosition | null>(null)
  const [userPos, setUserPos] = useState<LatLng | null>(savedState?.userPos || null)
  const currentPositionRef = useRef<LatLng | null>(savedState?.userPos || null)
  /** Map arrow position (display only, never read by navigation logic). */
  const [mapVehiclePos, setMapVehiclePos] = useState<LatLng | null>(null)
  /** Map arrow motion (display only): filtered route progress + speed, for zero-lag prediction. */
  const [mapVehicleMotion, setMapVehicleMotion] = useState<VehicleMotion | null>(null)
  /** Display-only route progress behind mapVehiclePos (see display-progress.ts). */
  const displayProgressRef = useRef<DisplayProgress | null>(null)
  /** Along-road u on examRoadTrace for km-based speed zones (monotonic). */
  const [speedRoadU, setSpeedRoadU] = useState<number | null>(null)
  const speedRoadURef = useRef<number | null>(null)
  const speedLimitRoadRef = useRef<LatLng[] | null>(null)
  /** Debug panel only: GPS readings dropped by the filter. */
  const [gpsRejection, setGpsRejection] = useState<GpsRejectionInfo | null>(null)
  const [heading, setHeading] = useState(savedState?.heading || 0)
  const [speedKmh, setSpeedKmh] = useState(savedState?.speedKmh ?? 0)
  const [elapsedMs, setElapsedMs] = useState(() =>
    savedState ? examElapsedMsNow(savedState) : 0,
  )
  const [distanceMeters, setDistanceMeters] = useState(() =>
    savedState && typeof savedState.distanceMeters === 'number' && Number.isFinite(savedState.distanceMeters)
      ? Math.max(0, savedState.distanceMeters)
      : 0,
  )
  const [nextPin, setNextPin] = useState<PinRow | null>(null)
  const nextPinRef = useRef<PinRow | null>(null)
  nextPinRef.current = nextPin
  const [lastSpoken, setLastSpoken] = useState<string | null>(null)
  const [routeComplete, setRouteComplete] = useState(false)
  const [audioPlaybackError, setAudioPlaybackError] = useState<{
    sortOrder: number
    message: string
  } | null>(null)
  const [audioRetryToken, setAudioRetryToken] = useState(0)
  /** True while the top banner waits for retry / continue after audio failure. */
  const audioWaitingForUserRef = useRef(false)
  const continueFailedAudioPinRef = useRef<(() => void) | null>(null)
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [pendingPinSortOrder, setPendingPinSortOrderState] = useState<number | null>(initialAudioQueue.pending)
  /** After mid-route დასრულება, summary offers გაგრძელება using kept localStorage progress. */
  const [summaryCanContinue, setSummaryCanContinue] = useState(
    () => Boolean(savedState?.phase === 'summary' && savedState.summaryCanContinue),
  )
  const [summaryFinalized, setSummaryFinalized] = useState(false)
  const resumePendingRef = useRef(false)
  const resumeBlockedRef = useRef(false)
  
  // DEBUG: Session diagnostic panel state
  // Production: panel and its 500 ms re-render timer are off. Development: unchanged.
  const [debugSessionVisible, setDebugSessionVisible] = useState(debugPanelEnabled)
  const [, forceDebugUpdate] = useState(0)
  useEffect(() => {
    if (!debugPanelEnabled || !debugSessionVisible) return
    const interval = setInterval(() => {
      forceDebugUpdate(v => v + 1)
    }, 500)
    return () => clearInterval(interval)
  }, [debugPanelEnabled, debugSessionVisible])

  const phaseRef = useRef<Phase>(phase)
  // Sync during render so save-effect cleanup never overwrites a Summary snapshot as active.
  phaseRef.current = phase

  useEffect(() => {
    if (!REMOTE_EXAM_SESSION_BACKEND_ENABLED || !isSupabaseConfigured || !userId || !deviceId) {
      setRemoteSessionLoading(false)
      return
    }
    if (!tabId) {
      setRemoteSessionLoading(false)
      setRemotePersistenceError('ამ მოწყობილობის ბრაუზერის tab-ის იდენტიფიკაცია ვერ მოხერხდა.')
      return
    }

    const loadAttempt = ++remoteLoadAttemptRef.current
    let timedOut = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    const isCurrentAttempt = () => !cancelled && remoteLoadAttemptRef.current === loadAttempt
    remoteWriterRef.current = null
    remoteSessionIdRef.current = null
    remoteWriteBlockedRef.current = false
    setRemoteSavedState(null)
    let cancelled = false
    setRemoteSessionLoading(true)
    setRemotePersistenceError(null)

    const loadRemoteSession = async () => {
      const tabIdentity = { userId, deviceId, tabId }
      const local = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
      let remote = local?.examSessionId
        ? await getRemoteExamSession(local.examSessionId, tabIdentity)
        : null
      if (!isCurrentAttempt() || timedOut) return
      if (!local?.examSessionId) {
        const candidates = (await listRemoteExamSessions(tabIdentity))
          .filter((item) => item.route_slug === route.slug)
        remote = candidates
          .sort((first, second) => Date.parse(second.updated_at) - Date.parse(first.updated_at))[0] ?? null
      }

      if (!isCurrentAttempt() || timedOut) return
      if (local?.examSessionId && !remote) {
        throw new Error('ამ მოწყობილობის შენახული გამოცდის სესია სერვერზე აღარ არსებობს.')
      }
      if (!remote) return
      if (
        remote.user_id !== userId ||
        remote.device_id !== deviceId ||
        (remote.tab_id !== null && remote.tab_id !== tabId) ||
        remote.route_slug !== route.slug ||
        (remote.status !== 'active' && remote.status !== 'paused')
      ) {
        throw new Error('Սերվერული გამოცდის სესია չի համապատხვდება այս ანგარიშს, მოწყობილობას ან მარშრუტს.')
      }

      const remoteProgress = isSavedExamState(remote.progress) ? remote.progress : null
      const source = reconcileRemoteExamProgress(
        local,
        remoteProgress,
        remote.session_id,
        remote.version,
      )
      if (!source) {
        throw new Error('სერვერზე შენახული გამოცდის პროგრესი ვერ აღდგა.')
      }

      const restored: SavedExamState = {
        ...source,
        userId,
        deviceId,
        ...(tabId ? { tabId } : {}),
        examSessionId: remote.session_id,
        examSessionVersion: remote.version,
        savedAt: Math.max(source.savedAt, Date.parse(remote.updated_at) || 0),
      }
      remoteSessionIdRef.current = remote.session_id
      remoteWriterRef.current = new RemoteExamSessionWriter(remote.session_id, remote.version, tabIdentity)
      remoteWriteRevisionRef.current = Math.max(
        remoteWriteRevisionRef.current,
        local?.examSessionRevision ?? 0,
      )
      remoteWriteBlockedRef.current = false
      saveActiveExam(restored, { allowProgressRollback: true }, persistenceScope)
      setRemoteSavedState(restored)
      setSavedEpoch((value) => value + 1)
      setRemoteRestoreToken((value) => value + 1)
      if (restored.examSessionDirty) {
        void persistRemoteSnapshot(restored).catch(() => {})
      }
    }

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true
        reject(new Error('სერვერული გამოცდის სესიის ჩატვირთვას 25 წამზე მეტი დასჭირდა.'))
      }, REMOTE_EXAM_SESSION_LOAD_TIMEOUT_MS)
    })

    void Promise.race([loadRemoteSession(), timeout])
      .catch((error: unknown) => {
        if (!isCurrentAttempt()) return
        const detail = error instanceof Error ? error.message : 'უცნობი შეცდომა'
        console.error('Remote exam session restore failed:', error)
        setRemotePersistenceError(`სერვერული გამოცდის სესია ვერ აღდგა: ${detail}`)
      })
      .finally(() => {
        if (timeoutId !== null) clearTimeout(timeoutId)
        if (isCurrentAttempt()) setRemoteSessionLoading(false)
      })

    return () => {
      cancelled = true
      if (timeoutId !== null) clearTimeout(timeoutId)
      if (remoteLoadAttemptRef.current === loadAttempt) {
        remoteLoadAttemptRef.current += 1
      }
    }
  }, [
    userId,
    deviceId,
    tabId,
    route.id,
    route.slug,
    route.name_ka,
    persistenceScope,
    remoteRetryToken,
  ])

  const finishRouteSlugRef = useRef<string | null>(null)
  const initialProgressRead = useMemo(
    () => readRoutePinProgress(route.slug, persistenceScope),
    [route.slug, persistenceScope, savedEpoch],
  )
  const initialProgressIsUnreadable =
    initialProgressRead.status === 'invalid' || initialProgressRead.status === 'unavailable'
  const initialRoutePinProgress = useMemo(
    () => initialProgressRead.status === 'valid' ? initialProgressRead.orders : [],
    [initialProgressRead],
  )
  const savedProgressOrders = savedState
    ? initialHandledOrders(savedState, route.pins, route.slug)
    : null
  const initialProgressOrders = mostAdvancedPinProgress(
    route.pins,
    initialRoutePinProgress,
    savedProgressOrders,
  )
  const initialTriggeredPinIds = new Set(
    savedProgressOrders === null ? savedState?.triggeredPins ?? [] : [],
  )
  for (const id of pinIdsForOrders(route.pins, initialProgressOrders)) {
    initialTriggeredPinIds.add(id)
  }
  const triggeredRef = useRef<Set<string>>(initialTriggeredPinIds)
  /** Routes 2/3: handled pins by sort_order (Tbilisi resume). Null until a save can be placed. */
  const handledOrdersRef = useRef<Set<number> | null>(
    FIELD_TEST_SLUGS.has(route.slug)
      ? initialProgressOrders
      : null,
  )
  // Audio catch-up bookkeeping (closest approach per PIN, failed-playback attempts). Not persisted.
  const pinApproachRef = useRef<Map<string, number>>(new Map())
  const pendingPinSortOrderRef = useRef<number | null>(initialAudioQueue.pending)
  const queuedAudioPinOrdersRef = useRef<number[]>(initialAudioQueue.queued)
  const audioAttemptInFlightRef = useRef(false)
  const audioRetryTimerRef = useRef<number | null>(null)
  const audioQueueWatchdogRef = useRef<number | null>(null)
  const audioPlaybackAttemptRef = useRef(0)
  const startAudioRetryTimerRef = useRef<number | null>(null)
  const startAudioPendingRef = useRef(false)
  const automaticFinishStartedRef = useRef(false)
  const releaseWake = useRef<(() => void) | null>(null)
  const sessionStartRef = useRef(
    savedState ? examSessionOriginMs(savedState) : 0,
  )
  const resumedSlugRef = useRef<string | null>(null)
  const finishInProgressRef = useRef(false)
  const audioSessionGenerationRef = useRef(0)
  const audioRouteSlugRef = useRef(route.slug)
  const saveOwnerRef = useRef(0)
  const prevGpsRef = useRef<GpsPosition | null>(null)
  const speedTrackerRef = useRef(createSpeedTracker())
  const gpsFilterRef = useRef(createGpsFilter())
  const routeOdometerRef = useRef((() => {
    const odo = createRouteOdometer()
    if (
      savedState &&
      typeof savedState.distanceMeters === 'number' &&
      Number.isFinite(savedState.distanceMeters)
    ) {
      odo.restore(Math.max(0, savedState.distanceMeters))
    }
    return odo
  })())
  const distanceMetersRef = useRef(distanceMeters)
  distanceMetersRef.current = distanceMeters
  const routeDistanceOriginMetersRef = useRef(0)
  const routeMatchStateRef = useRef<RouteMatchState | null>(null)
  /** Arrow-only chainage guard (monotonic, speed-plausible). Never feeds HUD km / PIN logic. */
  const arrowChainageRef = useRef<ArrowTrackerState | null>(null)
  /** Demo km-seek / approach chainage — consumed once by the next startSession seed. */
  const seedHintChainageRef = useRef<number | null>(null)
  const gpsAutoStartBlockedRef = useRef(false)
  const roundaboutGateRef = useRef<RoundaboutReturnGateState | null>(null)
  /** Kilometre trigger (active mode): PIN orders queued to be marked passed WITHOUT audio. */
  const silentPinOrdersRef = useRef<Set<number>>(new Set(savedState?.silentPinSortOrders ?? []))
  const chainageTriggerStateRef = useRef<ChainageTriggerState>(INITIAL_CHAINAGE_TRIGGER_STATE)
  /** Kilometre trigger (shadow mode): what the new trigger would already have fired. */
  const shadowFiredOrdersRef = useRef<Set<number>>(new Set())
  const shadowTriggerStateRef = useRef<ChainageTriggerState>(INITIAL_CHAINAGE_TRIGGER_STATE)

  const setPendingPinSortOrder = useCallback((sortOrder: number | null) => {
    pendingPinSortOrderRef.current = sortOrder
    setPendingPinSortOrderState(sortOrder)
  }, [])

  const polyline = route.polyline as LatLng[]
  /** Street-matched line used for GPS pin start (same as exam geometry), not the coarse route.polyline. */
  const autoStartPolyline = useMemo(
    () => examRouteLine(route.slug, route.pins) as LatLng[],
    [route.slug, route.pins],
  )
  const routeGeometry = useMemo(() => {
    if (!FIELD_TEST_SLUGS.has(route.slug)) return null
    try {
      // Same rounded street line as the blue map polyline (examRouteLine), so the
      // arrow follows the visible curve — not a sharp raw tip chord.
      const streetTrace = examRouteLine(route.slug, route.pins)
      return prepareRouteGeometry(route.slug as ActiveRouteId, streetTrace.length >= 2 ? streetTrace : polyline)
    } catch (error) {
      console.error('Failed to prepare route geometry:', route.slug, error)
      return null
    }
  }, [route.slug, route.pins, polyline])
  const routeGeometryRef = useRef(routeGeometry)
  routeGeometryRef.current = routeGeometry
  /** Full street-road length (rounded exam line), not pin-to-pin shortcuts. */
  const routeLengthM = useMemo(() => {
    const line =
      (routeGeometry?.coordinates as LatLng[] | undefined)?.length && routeGeometry
        ? ([...routeGeometry.coordinates] as LatLng[])
        : autoStartPolyline.length >= 2
          ? autoStartPolyline
          : polyline
    return routeLengthMeters(line)
  }, [routeGeometry, autoStartPolyline, polyline])
  const distanceProgressPct =
    routeLengthM > 0 ? Math.min(100, Math.max(0, (distanceMeters / routeLengthM) * 100)) : 0
  const routeLengthKmLabel = routeLengthM > 0 ? distanceKmTenths(routeLengthM).toFixed(1) : '—'
  const traveledKmLabel = distanceKmTenths(distanceMeters).toFixed(1)
  const progressLengthLine = useMemo(() => {
    const street = examStreetRoad(route.slug)
    if (street) return street
    if (autoStartPolyline.length >= 2) return autoStartPolyline
    return polyline
  }, [route.slug, autoStartPolyline, polyline])

  function seedLiveDistanceMeters(
    startSortOrder: number,
    gpsPos?: LatLng | null,
    hintChainageMeters?: number | null,
  ): number {
    // PIN 1 sits on the agency loop (start ≈ finish). Nearest-on-line hits the end of
    // the road (~full route km). Starting from PIN 1 must always show 0.0 კმ.
    if (startSortOrder <= 1) return 0

    const pin = voicePins.find((row) => row.sort_order === startSortOrder)
    const pinPos: LatLng | null =
      pin && Number.isFinite(pin.lat) && Number.isFinite(pin.lng) ? [pin.lat, pin.lng] : null
    // Prefer the caller's GPS (live start) over a stale pin fallback.
    const position =
      (gpsPos !== undefined ? gpsPos : currentPositionRef.current) ?? pinPos
    if (!position) return 0
    // Mid/late starts: GPS nearest + continuity with seek/previous hint.
    // Never let a distant expected-PIN window pull onto a parallel section
    // (R1 ~2.25 km vs PIN12 ≈2.69 km ambiguity → false 2.57 km seed).
    if (routeGeometry) {
      const exactPinChainage = resolveExactPinChainageMeters(startSortOrder)
      const nearest = projectPointToRoute(routeGeometry, position)
      const hint =
        hintChainageMeters != null && Number.isFinite(hintChainageMeters)
          ? Math.max(0, hintChainageMeters)
          : null
      const hintAnchored =
        hint != null
          ? projectPointToRouteNearChainage(routeGeometry, position, hint, 80)
          : null
      const pinAnchored =
        exactPinChainage != null
          ? projectPointToRouteNearChainage(routeGeometry, position, exactPinChainage, 150)
          : null
      const decision = resolveGpsSeedChainageMeters({
        nearest: nearest
          ? {
              chainageMeters: nearest.chainageMeters,
              crossTrackMeters: nearest.crossTrackMeters,
            }
          : null,
        pinAnchored: pinAnchored
          ? {
              chainageMeters: pinAnchored.chainageMeters,
              crossTrackMeters: pinAnchored.crossTrackMeters,
            }
          : null,
        hintAnchored: hintAnchored
          ? {
              chainageMeters: hintAnchored.chainageMeters,
              crossTrackMeters: hintAnchored.crossTrackMeters,
            }
          : null,
        exactPinChainageMeters: exactPinChainage,
        distanceToPinMeters: pinPos ? distanceToPinMeters(position, pinPos) : null,
        hintChainageMeters: hint,
      })
      if (decision.action !== 'none') {
        return decision.chainageMeters
      }
      if (nearest && Number.isFinite(nearest.chainageMeters)) {
        return Math.max(0, nearest.chainageMeters)
      }
    }
    return seedAlongRouteMeters(progressLengthLine, position)
  }

  function applySeededDistance(meters: number) {
    const safe = Number.isFinite(meters) && meters > 0 ? meters : 0
    routeOdometerRef.current.restore(safe)
    distanceMetersRef.current = safe
    setDistanceMeters(safe)
  }

  function route1StartPinChainageMeters(): number {
    const geometry = routeGeometryRef.current
    const startPin = voicePinsRef.current.find((pin) => pin.sort_order === 1)
    if (!geometry || !startPin) return 0
    return projectPointToRouteNearChainage(
      geometry,
      [startPin.lat, startPin.lng],
      0,
      40,
    )?.chainageMeters ?? 0
  }

  /** Exact along-route chainage for a confirmed PIN (no 0.1 km rounding). */
  function resolveExactPinChainageMeters(sortOrder: number): number | null {
    const geometry = routeGeometryRef.current
    if (!geometry) return null
    if (route.slug === 'route-1' && sortOrder === 1) return 0
    if (route.slug === 'route-1' && sortOrder === 2) {
      const pin = voicePinsRef.current.find((row) => row.sort_order === sortOrder)
      if (!pin) return null
      return projectPointToRoute(geometry, [pin.lat, pin.lng])?.chainageMeters ?? null
    }
    if (route.slug === 'route-2' && sortOrder === 3) {
      const pin = voicePinsRef.current.find((row) => row.sort_order === sortOrder)
      const matchedChainage = routeMatchStateRef.current?.chainageMeters
      if (pin && matchedChainage != null) {
        return projectPointToRouteNearChainage(
          geometry,
          [pin.lat, pin.lng],
          matchedChainage,
          40,
        )?.chainageMeters ?? matchedChainage
      }
    }
    if (route.slug === 'route-2' && sortOrder === 26) {
      const pin = voicePinsRef.current.find((row) => row.sort_order === sortOrder)
      const matchedChainage = routeMatchStateRef.current?.chainageMeters
      if (pin && matchedChainage != null) {
        return projectPointToRouteNearChainage(
          geometry,
          [pin.lat, pin.lng],
          matchedChainage,
          40,
        )?.chainageMeters ?? matchedChainage
      }
    }
    const pins = voicePinsRef.current
    const prior = [...pins]
      .map((pin) => pin.sort_order)
      .filter((order) => order < sortOrder)
      .sort((a, b) => b - a)[0]
    const after = prior === undefined
      ? 0
      : route.slug === 'route-1' && prior === 2
        ? resolveExactPinChainageMeters(prior) ?? 0
        : resolveDemoPinChainage(geometry, pins, prior, 0) ?? 0
    return resolveDemoPinChainage(geometry, pins, sortOrder, after)
  }

  /**
   * Keep HUD კმ / speed bands / saved progress on the same route-chainage source.
   * Optionally re-lock match state so recovery continues from this chainage.
   */
  function applyRouteChainageMeters(
    meters: number,
    options?: { readonly syncMatchState?: boolean; readonly timestampMs?: number },
  ) {
    const safe = Number.isFinite(meters) && meters > 0 ? meters : 0
    applySeededDistance(Math.max(0, safe - routeDistanceOriginMetersRef.current))
    if (!options?.syncMatchState) return
    const geometry = routeGeometryRef.current
    if (!geometry) return
    const position = positionAtChainageMeters(geometry, safe)
    if (!position) return
    const snapped =
      projectPointToRouteNearChainage(geometry, position, safe, 5) ??
      projectPointToRoute(geometry, position)
    if (!snapped) return
    arrowChainageRef.current = null
    routeMatchStateRef.current = {
      routeId: geometry.routeId,
      chainageMeters: snapped.chainageMeters,
      segmentIndex: snapped.segmentIndex,
      position: snapped.position,
      timestampMs: options.timestampMs ?? Date.now(),
      accuracyMeters: 5,
    }
  }
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
  const voicePinsRef = useRef(voicePins)
  voicePinsRef.current = voicePins
  /**
   * PINs anchored to exact route kilometres (src/data/pin-chainage.json) for the
   * kilometre trigger. Null (legacy trigger only) when the table does not match
   * this PIN list or the frozen geometry version — it fails closed.
   */
  const chainagePins = useMemo(() => {
    if (!FIELD_TEST_SLUGS.has(route.slug)) return null
    const result = chainagePinsForRoute(route.slug, voicePins)
    if ('reason' in result) {
      if (voicePins.length > 0) devLog('[PIN KM] chainage table unavailable:', route.slug, result.reason)
      return null
    }
    return result.pins
  }, [route.slug, voicePins])
  const chainagePinsRef = useRef<ChainagePin[] | null>(chainagePins)
  chainagePinsRef.current = chainagePins
  // Field-test check (dev / Preview console only): which PIN trigger this route uses.
  useEffect(() => {
    if (!FIELD_TEST_SLUGS.has(route.slug)) return
    devLog(
      '[PIN KM] trigger mode',
      route.slug.toUpperCase(),
      chainagePins !== null && isChainageTriggerEnabled(route.slug) ? 'KILOMETRE' : 'LEGACY',
    )
  }, [route.slug, chainagePins])

  function chainageTriggerActive(): boolean {
    return chainagePinsRef.current !== null && isChainageTriggerEnabled(route.slug)
  }

  /** Orders the kilometre trigger must not fire again: handled, playing, queued or silently passed. */
  function chainageDoneOrders(): Set<number> {
    return new Set<number>([
      ...(handledOrdersRef.current ?? []),
      ...(pendingPinSortOrderRef.current !== null ? [pendingPinSortOrderRef.current] : []),
      ...queuedAudioPinOrdersRef.current,
      ...silentPinOrdersRef.current,
    ])
  }

  function shadowDoneOrders(): Set<number> {
    return new Set<number>([...(handledOrdersRef.current ?? []), ...shadowFiredOrdersRef.current])
  }

  /** Saved-progress fields for the kilometre system (route identity is the save key + slug). */
  function chainagePersistenceFields(): Pick<
    SavedExamState,
    'silentPinSortOrders' | 'routeGeometryVersion' | 'routeChainageMeters'
  > {
    const version = routeGeometryVersion(route.slug)
    const chainage = routeMatchStateRef.current?.chainageMeters
    return {
      ...(silentPinOrdersRef.current.size > 0
        ? { silentPinSortOrders: [...silentPinOrdersRef.current].sort((a, b) => a - b) }
        : {}),
      ...(version && chainage != null && Number.isFinite(chainage)
        ? { routeGeometryVersion: version, routeChainageMeters: Math.max(0, chainage) }
        : {}),
    }
  }

  function resetChainageTriggerState() {
    silentPinOrdersRef.current = new Set()
    chainageTriggerStateRef.current = INITIAL_CHAINAGE_TRIGGER_STATE
    shadowFiredOrdersRef.current = new Set()
    shadowTriggerStateRef.current = INITIAL_CHAINAGE_TRIGGER_STATE
  }

  /**
   * Hand a kilometre-trigger decision to the EXISTING audio queue, so duplicate
   * protection, retries, persistence and in-order completion stay unchanged.
   * Silent entries complete immediately without playback. Queued audible PINs
   * that are now behind a newer PIN are turned silent (never play outdated turns).
   */
  function scheduleChainagePin(order: number, silent: boolean) {
    const pin = voicePinsRef.current.find((item) => item.sort_order === order)
    if (!pin) return
    if (silent) {
      silentPinOrdersRef.current.add(order)
    } else {
      for (const queued of queuedAudioPinOrdersRef.current) {
        if (queued < order) silentPinOrdersRef.current.add(queued)
      }
    }
    markPinTriggered(pin)
    if (pendingPinSortOrderRef.current === null) {
      setPendingPinSortOrder(order)
    } else if (
      pendingPinSortOrderRef.current !== order &&
      !queuedAudioPinOrdersRef.current.includes(order)
    ) {
      queuedAudioPinOrdersRef.current.push(order)
      queuedAudioPinOrdersRef.current.sort((a, b) => a - b)
    }
  }
  const completedPreviewOrders = mostAdvancedPinProgress(
    sortedPins,
    initialRoutePinProgress,
    savedState ? savedProgressOrders : null,
  )
  const pinsActive = voicePins.length > 0
  // Exam street line for GPS speed zones (same roadU progress as before the odometer switch).
  const speedLimitRoad = useMemo(() => examRoadTrace(route.slug, voicePins), [route.slug, voicePins])
  speedLimitRoadRef.current = speedLimitRoad
  const roundaboutGateGeometry = useMemo(() => {
    if (!speedLimitRoad || speedLimitRoad.length < 2) return null
    try {
      return prepareRouteGeometry(route.slug as ActiveRouteId, speedLimitRoad)
    } catch (error) {
      console.error('Failed to prepare roundabout gate road trace:', route.slug, error)
      return null
    }
  }, [route.slug, speedLimitRoad])
  // Automatic start: see resolveAutoStart. Preview label uses saved progress only (cheap);
  // live GPS snap (never rewind) runs on დაწყება / გაგრძელება.
  const previewProgress = initialProgressIsUnreadable
    ? { status: 'error' as const, message: RESUME_UNRESOLVED_MESSAGE }
    : resolvePinProgress(sortedPins, initialRoutePinProgress)
  const autoStartPin = useMemo(() => {
    if (initialProgressIsUnreadable) return null
    return resolveAutoStart(sortedPins, new Set(initialRoutePinProgress)).pin
  }, [initialProgressIsUnreadable, sortedPins, initialRoutePinProgress])
  const previewPin =
    previewProgress.status === 'resume' &&
    previewProgress.nextSortOrder !== null &&
    previewPinSelection?.routeId === route.id &&
    !completedPreviewOrders.has(previewPinSelection.sortOrder)
      ? sortedPins.find((pin) => pin.sort_order === previewPinSelection.sortOrder) ?? autoStartPin
      : previewProgress.status === 'resume' ? autoStartPin : null
  const previewRouteComplete =
    previewProgress.status === 'resume' &&
    sortedPins.length > 0 &&
    previewProgress.nextSortOrder === null
  const speedLimitChainageMeters =
    distanceMeters +
    (route.slug === 'route-1' ? routeDistanceOriginMetersRef.current : 0)
  // Keep the 0.1 km bands on absolute route chainage, not the Route 1 session odometer.
  const speedLimitKmh = useMemo(
    () => resolveSpeedLimitByOdometerMeters(route.slug, speedLimitChainageMeters),
    [route.slug, speedLimitChainageMeters],
  )

  useEffect(() => {
    speedRoadURef.current = null
    setSpeedRoadU(null)
  }, [route.slug, speedLimitRoad])

  const updateSpeedRoadProgress = useCallback((pos: LatLng | null, reset = false) => {
    const road = speedLimitRoadRef.current
    // Keep last roadU on missing GPS so the km-based limit stays on.
    if (!pos || !road || road.length < 2) return
    const prev = reset ? null : speedRoadURef.current
    const next = advanceRoadProgressU(pos, road, prev)
    speedRoadURef.current = next
    setSpeedRoadU(next)
  }, [])

  const active = phase === 'active'
  const summaryOpen = phase === 'summary'
  /** Keep the map shell mounted through Summary so finish never kicks the user off the map. */
  const onRouteMapScreen = active || summaryOpen
  const layoutMode = useExamLayoutMode()

  const mapOnly = features.mapNav && !features.errorPanel
  const panelOnly = features.errorPanel && !features.mapNav
  const showMapView = onRouteMapScreen && features.mapNav && driveView === 'map'
  const showPanelView = active && features.errorPanel && (panelOnly || (features.canSwitchViews && driveView === 'panel'))
  const showVoiceInToolbar = showPanelView && !mapOnly
  const showErrorsInToolbar = features.errorPanel && (panelOnly || driveView === 'panel')

  useEffect(() => {
    if (mapOnly) setDriveView('map')
    else if (panelOnly) setDriveView('panel')
  }, [mapOnly, panelOnly, route.id])

  useLayoutEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  useEffect(() => {
    if (audioRouteSlugRef.current !== route.slug) {
      audioRouteSlugRef.current = route.slug
      audioSessionGenerationRef.current++
      roundaboutGateRef.current = null
      audioEngine.stopAll()
      startAudioPendingRef.current = false
      if (startAudioRetryTimerRef.current !== null) {
        clearTimeout(startAudioRetryTimerRef.current)
        startAudioRetryTimerRef.current = null
      }
      if (audioRetryTimerRef.current !== null) {
        clearTimeout(audioRetryTimerRef.current)
        audioRetryTimerRef.current = null
      }
      if (audioQueueWatchdogRef.current !== null) {
        clearTimeout(audioQueueWatchdogRef.current)
        audioQueueWatchdogRef.current = null
      }
      audioAttemptInFlightRef.current = false
      pinApproachRef.current.clear()
      queuedAudioPinOrdersRef.current = []
      setPendingPinSortOrder(null)
      // Route switch: kilometre-trigger state never leaks between routes.
      resetChainageTriggerState()
      displayProgressRef.current = null
      setMapVehiclePos(null)
      setMapVehicleMotion(null)
    }
    // ============================================================
    // Resume by slug so local-route-* → Supabase UUID does not drop the session.
    // Hydrate once per slug. Do not reset to preview. Do not call startSession().
    // ============================================================
    // After Finish the summary must stay. The flag stays up until restartPreview()/startSession()
    // (it is not consumed here), so a later re-run of this effect cannot overwrite the summary.
    if (finishInProgressRef.current && finishRouteSlugRef.current !== route.slug) {
      finishInProgressRef.current = false
      finishRouteSlugRef.current = null
    }
    if (
      finishInProgressRef.current ||
      (phaseRef.current === 'summary' && finishRouteSlugRef.current === route.slug)
    ) return

    if (initialProgressIsUnreadable) {
      resumedSlugRef.current = route.slug
      resumeBlockedRef.current = true
      resumePendingRef.current = false
      setResumeError(RESUME_UNRESOLVED_MESSAGE)
      setNextPin(null)
      setRouteComplete(false)
      setPhase('preview')
      return
    }

    const saved = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)

    if (saved) {
      if (resumedSlugRef.current !== route.slug) {
        resumedSlugRef.current = route.slug
        sessionStartModeRef.current = saved.startMode ?? 'manual'
        resumeBlockedRef.current = false
        const restoredOrders = FIELD_TEST_SLUGS.has(route.slug)
          ? restoredHandledOrders(saved, sortedPins, route.slug, persistenceScope)
          : null
        triggeredRef.current = restoredOrders
          ? pinIdsForOrders(sortedPins, restoredOrders)
          : new Set(saved.triggeredPins)
        const restoredAudio = restoreAudioQueue(
          sortedPins,
          saved.pendingPinSortOrder,
          saved.queuedPinSortOrders,
        )
        setPendingPinSortOrder(restoredAudio.pending)
        queuedAudioPinOrdersRef.current = restoredAudio.queued
        // Silent (outdated) queue entries survive a reload so they are never spoken.
        resetChainageTriggerState()
        silentPinOrdersRef.current = new Set(
          (saved.silentPinSortOrders ?? []).filter(
            (order) => order === restoredAudio.pending || restoredAudio.queued.includes(order),
          ),
        )
        sessionStartRef.current = examSessionOriginMs(saved)
        setExam(saved.exam)
        setExamSummary(null)
        currentPositionRef.current = saved.userPos
        setUserPos(saved.userPos)
        updateSpeedRoadProgress(saved.userPos, true)
        setHeading(saved.heading)
        setSpeedKmh(saved.speedKmh)
        setElapsedMs(examElapsedMsNow(saved))
        {
          const nextOrder =
            sortedPins.find((pin) => !triggeredRef.current.has(pin.id))?.sort_order ?? 1
          const route1StartPin = sortedPins.find((pin) => pin.sort_order === 1)
          const restoredAtRoute1Start =
            route.slug === 'route-1' &&
            nextOrder === 2 &&
            saved.userPos != null &&
            route1StartPin != null &&
            distanceToPinMeters(saved.userPos, [route1StartPin.lat, route1StartPin.lng]) <= 25
          const hasSavedDistance =
            typeof saved.distanceMeters === 'number' &&
            Number.isFinite(saved.distanceMeters) &&
            saved.distanceMeters > 0
          const restoredDistance =
            nextOrder <= 1
              ? 0
              : restoredAtRoute1Start
                ? 0
              : hasSavedDistance
                ? saved.distanceMeters
                : seedLiveDistanceMeters(nextOrder, saved.userPos)
          routeDistanceOriginMetersRef.current =
            route.slug === 'route-1' && nextOrder > 1
              ? route1StartPinChainageMeters()
              : 0
          if (route.slug === 'route-1' && nextOrder === 1 && routeGeometryRef.current) {
            applyRouteChainageMeters(0, {
              syncMatchState: true,
              timestampMs: Date.now(),
            })
          } else if (route.slug === 'route-1' && restoredAtRoute1Start) {
            applyRouteChainageMeters(routeDistanceOriginMetersRef.current, {
              syncMatchState: true,
              timestampMs: Date.now(),
            })
          } else {
            // Kilometre trigger: resume from the exact saved route chainage, but
            // only when it was measured on the SAME frozen geometry version and
            // belongs to this route's save. Otherwise fall back to the legacy
            // distance-based restore (older saves have no chainage).
            const savedChainageUsable =
              chainageTriggerActive() &&
              nextOrder > 1 &&
              (saved.routeSlug === undefined || saved.routeSlug === route.slug) &&
              typeof saved.routeChainageMeters === 'number' &&
              Number.isFinite(saved.routeChainageMeters) &&
              saved.routeGeometryVersion === routeGeometryVersion(route.slug)
            const restoredChainage = savedChainageUsable
              ? saved.routeChainageMeters!
              : route.slug === 'route-1' && hasSavedDistance
                ? restoredDistance + routeDistanceOriginMetersRef.current
                : restoredDistance
            applyRouteChainageMeters(restoredChainage, {
              syncMatchState: true,
              timestampMs: Date.now(),
            })
          }
        }
        setGpsStarted(true)
        {
          // Prefer the dedicated drive-view key, then the exam snapshot. Update the
          // ref synchronously so the mount-time persist effect cannot overwrite PANEL
          // with the default MAP before setState flushes.
          const restoredView: ExamDriveView =
            loadDriveView(route.slug, persistenceScope) ??
            (saved.driveView === 'panel' || saved.driveView === 'map'
              ? saved.driveView
              : features.mapNav
                ? 'map'
                : 'panel')
          driveViewRef.current = restoredView
          setDriveView(restoredView)
          saveDriveView(route.slug, restoredView, persistenceScope)
        }
        if (FIELD_TEST_SLUGS.has(route.slug)) {
          handledOrdersRef.current = restoredOrders
          if (restoredOrders) {
            const orders = persistMostAdvancedPinProgress(restoredOrders)
            handledOrdersRef.current = orders
            triggeredRef.current = pinIdsForOrders(sortedPins, orders)
            const progress = nextSortOrder(sortedPins, orders)
            setNextPin(sortedPins.find((pin) => pin.sort_order === progress.nextSortOrder) ?? null)
            setRouteComplete(sortedPins.length > 0 && progress.nextSortOrder === null)
            resumePendingRef.current = false
            setResumeError(null)
          } else {
            const resolution = resolveExamResume(saved, sortedPins, route.slug)
            let gpsRecovered = false
            handledOrdersRef.current = null
            resumeBlockedRef.current =
              resolution.status === 'error' ||
              (resolution.status === 'resume' && resolution.handledOrders !== null)
            resumePendingRef.current =
              resolution.status === 'pending' ||
              (resolution.status === 'resume' && resolution.handledOrders === null)
            if (resolution.status === 'pending' && saved.phase === 'active' && saved.userPos) {
              const gpsPin = resolveAutoStart(
                sortedPins,
                new Set(),
                saved.userPos,
                autoStartPolyline,
                route.slug as 'route-1' | 'route-2' | 'route-3' | 'route-4',
              ).pin
              if (gpsPin) {
                const recovered = new Set(
                  sortedPins
                    .filter((pin) => pin.sort_order < gpsPin.sort_order)
                    .map((pin) => pin.sort_order),
                )
                const orders = persistMostAdvancedPinProgress(recovered)
                handledOrdersRef.current = orders
                triggeredRef.current = pinIdsForOrders(sortedPins, orders)
                setNextPin(gpsPin)
                resumePendingRef.current = false
                resumeBlockedRef.current = false
                setResumeError(null)
                gpsRecovered = true
              }
            }
            if (!gpsRecovered) {
              setResumeError(
                resolution.status === 'resume'
                  ? resolution.handledOrders === null ? RESUME_PENDING_MESSAGE : RESUME_UNRESOLVED_MESSAGE
                  : resolution.message,
              )
              setNextPin(null)
            }
            setRouteComplete(false)
          }
        }
        console.log('🔄 Resuming saved exam session', route.slug)
      }
      if (saved.phase === 'summary') {
        const restoredOrders = FIELD_TEST_SLUGS.has(route.slug)
          ? restoredHandledOrders(saved, sortedPins, route.slug, persistenceScope)
          : null
        if (restoredOrders) {
          handledOrdersRef.current = restoredOrders
          triggeredRef.current = pinIdsForOrders(sortedPins, restoredOrders)
        }
        const summary =
          saved.summary ??
          {
            ...finishExamSession(saved.exam),
            finishedAt: saved.savedAt,
            elapsedMs: saved.elapsedMs,
            passedPinOrders: saved.triggeredSortOrders,
          }
        setExamSummary(summary)
        setSummaryCanContinue(
          saved.summaryCanContinue ??
            (FIELD_TEST_SLUGS.has(route.slug)
              ? nextSortOrder(sortedPins, restoredOrders ?? new Set()).nextSortOrder !== null
              : false),
        )
        setSummaryFinalized(false)
        setPhase('summary')
        return
      }
      setPhase('active')
      return
    }

    // Slug says a session exists; local id may not have matched yet. Do not reset to preview
    // and do not clobber MAP/PANEL — hydrate above restores driveView once the slug matches.
    if (hasSavedExamForSlug(route.slug, route.name_ka, persistenceScope)) {
      setPhase('active')
      return
    }

    resumedSlugRef.current = null
    resumeBlockedRef.current = false
    sessionStartRef.current = 0
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setPhase('preview')
    {
      const nextView: ExamDriveView = features.mapNav ? 'map' : 'panel'
      driveViewRef.current = nextView
      setDriveView(nextView)
      saveDriveView(route.slug, nextView, persistenceScope)
    }
    setGpsError(getGpsEnvironmentIssue())
    setLastSpoken(null)
    const progressRead = readRoutePinProgress(route.slug, persistenceScope)
    if (progressRead.status === 'invalid' || progressRead.status === 'unavailable') {
      resumeBlockedRef.current = true
      handledOrdersRef.current = null
      resumePendingRef.current = false
      setResumeError(RESUME_UNRESOLVED_MESSAGE)
      setNextPin(null)
      setRouteComplete(false)
      return
    }
    const savedOrders = new Set(
      progressRead.status === 'valid' ? progressRead.orders : [],
    )
    const progressResolution = FIELD_TEST_SLUGS.has(route.slug)
      ? resolvePinProgress(sortedPins, savedOrders)
      : null
    const safeOrders =
      progressResolution?.status === 'resume'
        ? new Set(progressResolution.handledOrders ?? [])
        : savedOrders
    triggeredRef.current = pinIdsForOrders(sortedPins, safeOrders)
    if (FIELD_TEST_SLUGS.has(route.slug)) handledOrdersRef.current = safeOrders
    setPendingPinSortOrder(null)
    queuedAudioPinOrdersRef.current = []
    resumePendingRef.current = progressResolution?.status === 'pending'
    setResumeError(progressResolution?.status === 'error' ? progressResolution.message : null)
    setRouteComplete(
      progressResolution?.status === 'resume' &&
      sortedPins.length > 0 &&
      progressResolution.nextSortOrder === null,
    )
    setNextPin(
      progressResolution?.status === 'resume'
        ? sortedPins.find((pin) => pin.sort_order === progressResolution.nextSortOrder) ?? null
        : sortedPins.find((pin) => !triggeredRef.current.has(pin.id)) ?? null,
    )
    prevGpsRef.current = null
    routeMatchStateRef.current = null
    arrowChainageRef.current = null
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
    setSpeedKmh(0)
    setHeading(0)
  }, [
    route.id,
    route.slug,
    route.name_ka,
    persistenceScope,
    sortedPins,
    features.mapNav,
    setPendingPinSortOrder,
    remoteRestoreToken,
  ])

  // Local p2-/p3- ids and Supabase UUIDs share sort_order. Progress is kept by sort_order,
  // so a pin list swap re-derives the handled ids instead of dropping or guessing them.
  useEffect(() => {
    if (!FIELD_TEST_SLUGS.has(route.slug)) return
    if (resumeBlockedRef.current) return
    if (handledOrdersRef.current === null) {
      const derived = ordersForIds(triggeredRef.current, sortedPins, route.slug)
      if (sortedPins.length === 0) return
      if (derived.unknown.length > 0) {
        resumePendingRef.current = true
        return
      }
      handledOrdersRef.current = derived.orders
    }
    if (sortedPins.length === 0) return
    const resolution = resolvePinProgress(sortedPins, handledOrdersRef.current)
    if (resolution.status !== 'resume') {
      resumeBlockedRef.current = true
      resumePendingRef.current = false
      setResumeError(resolution.message)
      setNextPin(null)
      return
    }
    triggeredRef.current = pinIdsForOrders(sortedPins, handledOrdersRef.current)
    resumePendingRef.current = false
    setResumeError(null)
    if (phaseRef.current !== 'active') return
    setNextPin(sortedPins.find((pin) => pin.sort_order === resolution.nextSortOrder) ?? null)
    setRouteComplete(sortedPins.length > 0 && resolution.nextSortOrder === null)
  }, [sortedPins, route.id, route.slug, route.name_ka])

  const enableGps = useCallback(async (silent = false) => {
    if (!silent) setGpsStarting(true)
    setGpsError(null)
    try {
      const pos = previewGpsSource
        ? await previewGpsSource.getCurrentPosition()
        : await requestGpsOnce({ allowCached: silent || hasGpsConsent() })
      const raw = gpsToLatLng(pos)
      if (!Number.isFinite(raw[0]) || !Number.isFinite(raw[1])) {
        setGpsError('GPS კოორდინატები არასწორია')
        return { position: null, fix: null, denied: false }
      }
      setRawPos(pos)
      currentPositionRef.current = raw
      setUserPos(raw)
      updateSpeedRoadProgress(raw)
      setHeading(resolveHeading(pos, null, raw, polyline))
      prevGpsRef.current = pos
      setSpeedKmh(0)
      setGpsStarted(true)
      if (!previewGpsSource) markGpsConsentGranted()
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
  }, [polyline, previewGpsSource, updateSpeedRoadProgress])

  useEffect(() => {
    if (previewGpsSource || gpsStarted || gpsStarting || getGpsEnvironmentIssue()) return
    let cancelled = false
    void (async () => {
      if (!(await shouldAutoStartGps())) return
      if (cancelled) return
      await enableGps(true)
    })()
    return () => {
      cancelled = true
    }
  }, [route.id, gpsStarted, gpsStarting, enableGps, previewGpsSource])

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
    // Start immediately so the first PINs are warm before GPS unlock finishes.
    const t = window.setTimeout(preload, 0)
    return () => window.clearTimeout(t)
  }, [route.id, route.slug, sortedPins])

  // Wake lock for tablet / Android monitor drives. Re-acquire after screen blank
  // (Android releases the lock on visibility hidden).
  useEffect(() => {
    let cancelled = false
    const acquireWake = () => {
      void requestWakeLock().then((release) => {
        if (cancelled) {
          release()
          return
        }
        releaseWake.current = release
      })
    }
    acquireWake()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquireWake()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      releaseWake.current?.()
      audioSessionGenerationRef.current++
      if (audioRetryTimerRef.current !== null) {
        clearTimeout(audioRetryTimerRef.current)
        audioRetryTimerRef.current = null
      }
      if (audioQueueWatchdogRef.current !== null) {
        clearTimeout(audioQueueWatchdogRef.current)
        audioQueueWatchdogRef.current = null
      }
      audioAttemptInFlightRef.current = false
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

  // Latest values for the auto-save below. The save effect reads these refs so it
  // does not re-subscribe (and save twice) on every 1 s timer tick / GPS fix.
  const examRef = useRef(exam)
  examRef.current = exam
  const headingRef = useRef(heading)
  headingRef.current = heading
  const speedKmhRef = useRef(speedKmh)
  speedKmhRef.current = speedKmh
  const elapsedMsRef = useRef(elapsedMs)
  elapsedMsRef.current = elapsedMs

  // Auto-save exam state every 5 seconds when active; also persist on hide /
  // unmount (Home/leave), on PIN events (saveNowRef) and on exam-error changes.
  useEffect(() => {
    if (phase !== 'active') return
    if (finishInProgressRef.current) return // Skip saving if finish is in progress

    saveOwnerRef.current = ++examSaveOwner
    const saveState = (allowProgressRollback = false) => {
      if (finishInProgressRef.current) return // Guard against saving during finish
      if (phaseRef.current !== 'active') return // Never overwrite a finished Summary snapshot
      if (saveOwnerRef.current !== examSaveOwner) return // a newer session already owns storage
      if (audioRouteSlugRef.current !== route.slug) return // never let an old route overwrite the new route's queue
      const liveElapsed = sessionStartRef.current
        ? Math.max(0, Date.now() - sessionStartRef.current)
        : elapsedMsRef.current
      const pins = pinsRef.current
      const fieldTest = FIELD_TEST_SLUGS.has(route.slug)
        ? (() => {
            const orders = handledOrdersRef.current
            if (orders === null) return {}
            const sorted = [...orders].sort((a, b) => a - b)
            if (pins.length === 0) {
              const previous = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
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
      const snapshot: SavedExamState = {
          routeId: route.id,
          routeSlug: route.slug,
          routeName: route.name_ka,
          phase: 'active',
          ...(userId ? { userId } : {}),
          ...(deviceId ? { deviceId } : {}),
          ...(tabId ? { tabId } : {}),
          ...(remoteSessionIdRef.current ? { examSessionId: remoteSessionIdRef.current } : {}),
          startMode: sessionStartModeRef.current,
          exam: examRef.current,
          userPos: currentPositionRef.current,
          heading: headingRef.current,
          speedKmh: speedKmhRef.current,
          elapsedMs: liveElapsed,
          distanceMeters: distanceMetersRef.current,
          triggeredPins: Array.from(triggeredRef.current),
          pendingPinSortOrder: pendingPinSortOrderRef.current,
          queuedPinSortOrders: [...queuedAudioPinOrdersRef.current],
          ...chainagePersistenceFields(),
          driveView:
            loadDriveView(route.slug, persistenceScope) ?? driveViewRef.current,
          ...fieldTest,
          savedAt: Date.now(),
        }
      saveActiveExam(snapshot, { allowProgressRollback }, persistenceScope)
      return persistRemoteSnapshot(snapshot)
    }

    saveNowRef.current = saveState
    const saveAndHandleFailure = () => {
      const pendingSave = saveState()
      if (pendingSave) void pendingSave.catch(() => undefined)
    }
    saveAndHandleFailure()
    const id = window.setInterval(saveAndHandleFailure, 5000)
    const persistIfHidden = () => {
      if (document.visibilityState === 'hidden') saveAndHandleFailure()
    }
    document.addEventListener('visibilitychange', persistIfHidden)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', persistIfHidden)
      if (saveNowRef.current === saveState) saveNowRef.current = null
      if (!finishInProgressRef.current) saveState()
    }
  }, [
    phase,
    route.id,
    route.slug,
    route.name_ka,
    persistenceScope,
    userId,
    deviceId,
    tabId,
    sortedPins,
  ])

  // An exam error (or severe-quick) changes the score: persist it right away,
  // as the previous every-render save did.
  useEffect(() => {
    if (phaseRef.current !== 'active') return
    const pendingSave = saveNowRef.current?.()
    if (pendingSave) void pendingSave.catch(() => undefined)
  }, [exam])

  useEffect(() => {
    if (!gpsStarted) return
    const subscribe = previewGpsSource
      ? previewGpsSource.watchPosition.bind(previewGpsSource)
      : watchGps
    return subscribe(
      (pos) => {
        // Development builds only: keep the raw fix for field replay (no-op in production).
        recordGpsTraceFix(route.slug, pos)
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
          if (debugPanelEnabled) {
            setGpsRejection((prev) => ({
              reason: gpsFilterRef.current.lastRejection ?? 'unknown',
              count: (prev?.count ?? 0) + 1,
              accuracyM: pos.accuracy,
            }))
          }
          return
        }
        if (debugPanelEnabled) {
          setGpsRejection((prev) => (prev && prev.reason ? { ...prev, reason: null } : prev))
        }
        
        setRawPos(pos)
        setGpsError(null)
        const raw = filtered.position
        setUserPos(raw)
        currentPositionRef.current = raw
        // Map arrow (display only): during an active exam on a matched route the
        // arrow follows ACCEPTED road-matched positions only (set below).
        if (!routeGeometryRef.current || phaseRef.current !== 'active') {
          displayProgressRef.current = null
          setMapVehiclePos(raw)
          setMapVehicleMotion(null)
        }
        updateSpeedRoadProgress(raw)
        const prevRaw = prevGpsRef.current ? gpsToLatLng(prevGpsRef.current) : null
        // When exam route geometry exists (R1–R4), arrow heading is owned by
        // matched projection + stabilizeRoadArrowHeading below. Raw GPS/demo
        // segment bearings snap ~180° on sharp U-tips — do not use them here.
        if (!routeGeometryRef.current) {
          setHeading(resolveHeading(pos, prevRaw, raw, polyline))
        }
        if (phaseRef.current === 'active') {
          setSpeedKmh(resolveExamSpeedKmh(pos, prevGpsRef.current, speedTrackerRef.current))
          // With exam route geometry, HUD კმ is route chainage (updated after match
          // below). Do not accumulate raw GPS path length — jumps corrupt km.
          if (!routeGeometryRef.current) {
            const odo = routeOdometerRef.current.observe(raw, pos.timestamp)
            if (odo.accepted || odo.reason === 'anchor') {
              distanceMetersRef.current = odo.totalMeters
              setDistanceMeters(odo.totalMeters)
            }
          }
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
          const scheduledOrders = [
            pendingPinSortOrderRef.current,
            ...queuedAudioPinOrdersRef.current,
          ].filter((order): order is number => order !== null)
          // Keep handled order progression authoritative. Rebuilding triggered pins from
          // audio scheduling must never move the UI back to an already handled PIN.
          triggeredRef.current = new Set(
            voicePins
              .filter((pin) => (
                handledOrdersRef.current?.has(pin.sort_order) ||
                scheduledOrders.includes(pin.sort_order)
              ))
              .map((pin) => pin.id),
          )
        }
        
        // Find the FIRST untriggered pin in sequence
        // This is THE ONLY pin that can trigger right now
        const nextPinIndex = voicePins.findIndex((p) => !triggeredRef.current.has(p.id))
        const nextUnhandledPin = nextPinIndex >= 0 ? voicePins[nextPinIndex] : null

        setNextPin(nextUnhandledPin ?? null)
        if (fieldTest && handledOrdersRef.current && totalPins > 0) {
          setRouteComplete(nextSortOrder(voicePins, handledOrdersRef.current).nextSortOrder === null)
        }
        // Log current state
        if (nextUnhandledPin) {
          devLog('[PIN SEQUENCE]',
            route.slug.toUpperCase(),
            '| Expected: #' + (nextPinIndex + 1),
            '| ID:', nextUnhandledPin.id,
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

        if (phaseRef.current !== 'active' || !features.routeAudio || finishInProgressRef.current) return

        if (!routeGeometry) {
          if (!routeGeometry && debugPanelEnabled) {
            setGpsRejection((prev) => ({
              reason: 'route geometry unavailable',
              count: (prev?.count ?? 0) + 1,
              accuracyM: pos.accuracy,
            }))
          }
          return
        }

        const previousRouteMatch = routeMatchStateRef.current
        // PIN that steers the route matcher ("lit PIN"). Legacy: the next
        // unhandled PIN. Kilometre trigger: the next PIN whose trigger point
        // progress has NOT reached yet — the legacy matcher never lets progress
        // run more than 20 m past its lit PIN, so steering on a PIN that progress
        // already reached (but could not speak consistently) would clamp
        // progress there for good after a sparse fix or a GPS outage.
        const pending = (() => {
          if (!nextUnhandledPin || !chainageTriggerActive()) return nextUnhandledPin
          const done = chainageDoneOrders()
          const lastProgress = previousRouteMatch?.chainageMeters
          const steer = chainagePinsRef.current!.find(
            (pin) =>
              !done.has(pin.sortOrder) &&
              (lastProgress == null || pin.chainageMeters - pin.leadMeters > lastProgress),
          )
          return steer ? voicePins.find((pin) => pin.sort_order === steer.sortOrder) ?? null : null
        })()
        // Context PINs speak only at their ordered forward occurrence.
        const usesOrderedRouteContext = FIELD_TEST_SLUGS.has(route.slug)
        const usesRoute2Pin3ContextTarget =
          route.slug === 'route-2' && pending?.sort_order === 3
        const usesRouteContextTarget =
          (route.slug === 'route-1' && pending?.sort_order === 32) ||
          usesRoute2Pin3ContextTarget ||
          (route.slug === 'route-2' && pending?.sort_order === 26) ||
          (route.slug === 'route-3' && pending?.sort_order === 28) ||
          (route.slug === 'route-4' && pending?.sort_order === 29)
        const orderedPendingProjection = pending
          ? projectOrderedPointsToRoute(
            routeGeometry,
            voicePins
              .filter((pin) => pin.sort_order <= pending.sort_order)
              .sort((first, second) => first.sort_order - second.sort_order)
              .map((pin) => [pin.lat, pin.lng] as const),
            20,
            route.slug === 'route-3' && pending.sort_order === 13,
          )
          : null
        const usesOrderedPendingContext =
          usesOrderedRouteContext || usesRouteContextTarget
        const usesTargetOccurrenceContext = usesRouteContextTarget
        // Speak window: nearest roadside (post-turn on Alazani loops). Same as R3.
        const usesRoute1Pin2Projection =
          route.slug === 'route-1' && pending?.sort_order === 2
        const usesRoute34Pin2Projection =
          (route.slug === 'route-3' || route.slug === 'route-4') &&
          pending?.sort_order === 2
        const nearestPendingProjection = pending
          ? projectPointToRoute(routeGeometry, [pending.lat, pending.lng])
          : null
        const nearbyForwardPinProjection =
          orderedPendingProjection &&
          nearestPendingProjection &&
          nearestPendingProjection.chainageMeters > orderedPendingProjection.chainageMeters &&
          nearestPendingProjection.chainageMeters - orderedPendingProjection.chainageMeters <= 25
            ? nearestPendingProjection
            : orderedPendingProjection
        const pendingRouteProjection = pending && (
          usesTargetOccurrenceContext ||
          usesRoute1Pin2Projection ||
          usesRoute34Pin2Projection
        )
          ? nearestPendingProjection
          : pending && usesOrderedPendingContext
            ? nearbyForwardPinProjection
            : null
        // R3: ordered projection is often null → forward = nearest, speak after the turn.
        // R1/R2/R4: ordered sits ~150 m before nearest on the dual pass — hold forward on
        // ordered until the car reaches it, then open forward to nearest (turn, then speak).
        const pendingForwardChainageMeters = pending
          ? resolveDemoPinChainage(
              routeGeometry,
              voicePins,
              pending.sort_order,
              previousRouteMatch?.chainageMeters ?? 0,
            )
          : null
        const orderedForwardM = orderedPendingProjection?.chainageMeters
        const nearestForwardM = pendingRouteProjection?.chainageMeters
        let expectedForwardChainageMeters: number | undefined
        if (
          usesTargetOccurrenceContext &&
          !usesRoute2Pin3ContextTarget &&
          orderedForwardM != null &&
          nearestForwardM != null &&
          nearestForwardM > orderedForwardM + 40
        ) {
          // Dual-pass Alazani: never prefer nearest until the car has crawled the
          // U-turn — otherwise match teleports and 300m-right speaks too early.
          if (
            previousRouteMatch == null ||
            previousRouteMatch.chainageMeters < orderedForwardM - 10
          ) {
            expectedForwardChainageMeters = orderedForwardM
          } else if (previousRouteMatch.chainageMeters < nearestForwardM - 5) {
            // Route 2 PIN 26 follows a sharp finish U-turn; its match can lag the
            // fixed crawl, so let the expected corridor catch up locally.
            const forwardCrawlMeters =
              route.slug === 'route-2' && pending?.sort_order === 26 ? 40 : 25
            expectedForwardChainageMeters = Math.min(
              nearestForwardM,
              previousRouteMatch.chainageMeters + forwardCrawlMeters,
            )
          } else {
            expectedForwardChainageMeters = nearestForwardM
          }
        } else {
          // Route 3 style: ordered is null / ≈ nearest → forward = speak occurrence.
          expectedForwardChainageMeters =
            nearestForwardM ??
            orderedForwardM ??
            pendingForwardChainageMeters ??
            undefined
        }
        let expectedChainageMeters: number | undefined
        let expectedPinChainageMeters = usesTargetOccurrenceContext || usesOrderedRouteContext
          ? pendingRouteProjection?.chainageMeters
          : undefined
        if (!previousRouteMatch) {
          const handledOrders = handledOrdersRef.current ?? new Set<number>()
          const routeContextPins = [
            ...(pending ? [pending] : []),
            ...voicePins
              .filter((pin) => handledOrders.has(pin.sort_order))
              .sort((first, second) => second.sort_order - first.sort_order),
          ]
          const contextPin = routeContextPins.find(
            (pin) => distanceToPinMeters(raw, [pin.lat, pin.lng]) <= 25,
          )
          const routeStart = routeGeometry.coordinates[0]
          const startsAtFirstPin =
            contextPin?.sort_order === 1 &&
            distanceToPinMeters([routeStart[0], routeStart[1]], [contextPin.lat, contextPin.lng]) <= 20
          const orderedContextProjection = contextPin
            ? contextPin === pending
              ? pendingRouteProjection
              : projectOrderedPointsToRoute(
                  routeGeometry,
                  voicePins
                    .filter((pin) => pin.sort_order <= contextPin.sort_order)
                    .sort((first, second) => first.sort_order - second.sort_order)
                    .map((pin) => [pin.lat, pin.lng] as const),
                  20,
                  route.slug === 'route-3' && contextPin.sort_order === 13,
                )
            : null
          const contextProjection = contextPin
            ? startsAtFirstPin
              ? projectPointToRoute(routeGeometry, routeStart)
            : usesOrderedPendingContext
                ? orderedContextProjection
                : projectPointToRoute(routeGeometry, [contextPin.lat, contextPin.lng])
            : null
          if (contextProjection && contextProjection.crossTrackMeters <= 20) {
            expectedChainageMeters = contextProjection.chainageMeters
            if (contextPin === pending) {
              expectedPinChainageMeters = contextProjection.chainageMeters
            }
          }
        }
        const routeFix = {
          position: raw,
          accuracyMeters: pos.accuracy,
          timestampMs: pos.timestamp,
          headingDegrees: pos.heading,
        }
        const routeMatchOptions = {
          nowMs: Date.now(),
          maxGpsAgeMs: 15_000,
          maxAccuracyMeters: AUDIO_GPS_MAX_ACCURACY_M,
          maxCrossTrackMeters: AUDIO_GPS_MAX_CROSS_TRACK_M,
          maxSpeedMetersPerSecond: 55,
          stationaryThresholdMeters: 2,
          ambiguityToleranceMeters: 5,
          ambiguitySeparationMeters: 100,
        }
        let routeMatch = matchGpsPosition(routeGeometry, routeFix, previousRouteMatch, {
          ...routeMatchOptions,
          expectedChainageMeters,
          expectedForwardChainageMeters,
        })
        // Kilometre trigger only: the legacy lit-PIN corridor never lets a match
        // land more than 20 m past its lit PIN, so after a GPS outage / sparse
        // fixes that carried the car beyond it every fix was rejected forever
        // (progress and every later PIN frozen). Retry the same matcher WITHOUT
        // lit-PIN steering; keep its time-plausibility and loop-ambiguity
        // rejection, and accept only a forward, physically consistent match.
        if (
          chainageTriggerActive() &&
          previousRouteMatch &&
          !routeMatch.accepted &&
          (routeMatch.status === 'off-route' ||
            routeMatch.status === 'gps-jump' ||
            routeMatch.status === 'ambiguous-route-match')
        ) {
          const recovery = matchGpsPosition(routeGeometry, routeFix, previousRouteMatch, routeMatchOptions)
          if (
            recovery.accepted &&
            recovery.direction === 'forward' &&
            recovery.projection != null &&
            recovery.projection.crossTrackMeters <= PIN_FIRE_MAX_CROSS_TRACK_M
          ) {
            devLog('[PIN KM] route match recovered without lit-PIN steering', route.slug.toUpperCase(),
              Math.round(recovery.projection.chainageMeters) + 'm')
            routeMatch = recovery
          }
        }

        devLog('[ROUTE MATCH]',
          route.slug.toUpperCase(),
          '| Status:', routeMatch.status,
          '| Direction:', routeMatch.direction,
          '| Chainage:', routeMatch.projection ? Math.round(routeMatch.projection.chainageMeters) + 'm' : '—',
        )

        // Map arrow (display only, see display-progress.ts / vehicle-motion.ts):
        // never read by route progress, chainage, PIN triggering or speed.
        const publishMapArrow = (
          candidateChainageMeters: number,
          crossTrackMeters: number,
          fallbackPosition: LatLng | null,
          /** Rejected match: any good local road position wins (not only a nearer one). */
          preferLocal = false,
        ) => {
          // The matcher may hold or snap onto another pass of the route that
          // runs physically near the car (road doubling back, lit-PIN steering).
          // If the raw fix is clearly better supported by the road just around
          // the arrow, the ARROW uses that local position (display only).
          let displayCandidate = candidateChainageMeters
          let displayCrossTrack = crossTrackMeters
          const previousDisplay = displayProgressRef.current
          if (previousDisplay) {
            const local = projectPointToRouteNearChainage(
              routeGeometry,
              raw,
              previousDisplay.chainageMeters,
              DISPLAY_LOCAL_WINDOW_M,
            )
            if (
              local &&
              local.crossTrackMeters <= DISPLAY_LOCAL_MAX_CROSS_TRACK_M &&
              (preferLocal ||
                (local.crossTrackMeters + DISPLAY_LOCAL_BETTER_BY_M < crossTrackMeters &&
                  Math.abs(local.chainageMeters - candidateChainageMeters) > DISPLAY_LOCAL_MIN_GAP_M))
            ) {
              displayCandidate = local.chainageMeters
              displayCrossTrack = local.crossTrackMeters
            }
          }
          const display = stepDisplayProgress(displayProgressRef.current, {
            candidateChainageMeters: displayCandidate,
            crossTrackMeters: displayCrossTrack,
            speedMps: pos.speed,
            timestampMs: pos.timestamp,
          })
          displayProgressRef.current = display
          const shown = positionAtChainageMeters(routeGeometry, display.chainageMeters)
          const shownPosition: LatLng | null = shown ? [shown[0], shown[1]] : fallbackPosition
          if (shownPosition) setMapVehiclePos(shownPosition)
          setMapVehicleMotion((previous) => ({
            geometry: routeGeometry,
            chainageMeters: display.chainageMeters,
            speedMps: display.speedMps,
            seq: (previous?.seq ?? 0) + 1,
          }))
        }

        // Keep arrow slewing through brief off-route gaps on all R1–R4 U-tips:
        // never freeze then snap ~180°. Pin speak / 300m-right gate logic untouched.
        // Arrow heading is ALWAYS forward along increasing chainage (Maps-style
        // look-ahead) — never raw segment bearing or reverse+180 (those spin /
        // face previous points on short zig-zags and reject gaps).
        const chainageDecision = decideChainageFromMatch({
          previousChainageMeters:
            previousRouteMatch?.chainageMeters ??
            (distanceMetersRef.current + routeDistanceOriginMetersRef.current > 0
              ? distanceMetersRef.current + routeDistanceOriginMetersRef.current
              : null),
          candidateChainageMeters: routeMatch.nextState?.chainageMeters,
          matchAccepted: Boolean(routeMatch.accepted && routeMatch.nextState),
          elapsedMs: previousRouteMatch
            ? Math.max(0, pos.timestamp - previousRouteMatch.timestampMs)
            : 0,
          maxReverseMeters:
            route.slug === 'route-2' && pending?.sort_order === 4 ? 2 : undefined,
        })
        const pendingPinRecoveryReady =
          pending != null &&
          routeMatch.accepted &&
          routeMatch.projection != null &&
          routeMatch.nextState != null &&
          routeMatch.direction === 'forward' &&
          expectedPinChainageMeters != null &&
          Math.abs(
            routeMatch.projection.chainageMeters - expectedPinChainageMeters,
          ) <= pinAudioApproachWindowMeters(route.slug, pending.sort_order) &&
          distanceToPinMeters(raw, [pending.lat, pending.lng]) <=
            Math.max(40, pinAudioTriggerDistanceMeters(route.slug, pending.sort_order))
        const matchUsableForProgress =
          (chainageDecision.action === 'adopt' || pendingPinRecoveryReady) &&
          routeMatch.accepted &&
          routeMatch.nextState != null

        if (!matchUsableForProgress) {
          // Priority 2: preserve last valid chainage while recovery continues.
          // Do not adopt an implausible / rejected match into HUD კმ or match lock.
          if (chainageDecision.action === 'freeze') {
            applyRouteChainageMeters(chainageDecision.chainageMeters)
          }
          // Never chase a rejected nearest projection on the opposing pass
          // (same plaza / out-and-back ~+180°). Keep/advance along the locked pass.
          // Cold start on dual-pass plazas (R3 PIN15): prefer the lit-PIN chainage
          // over a finish-loop / opposing-pass nearest snap.
          let rejectChainage: number | null =
            previousRouteMatch?.chainageMeters ??
            (distanceMetersRef.current + routeDistanceOriginMetersRef.current > 0
              ? distanceMetersRef.current + routeDistanceOriginMetersRef.current
              : null) ??
            (expectedForwardChainageMeters != null &&
            Number.isFinite(expectedForwardChainageMeters)
              ? expectedForwardChainageMeters
              : null) ??
            (routeMatch.projection != null &&
            routeMatch.projection.chainageMeters <= 150
              ? routeMatch.projection.chainageMeters
              : null)
          if (
            previousRouteMatch &&
            rejectChainage != null &&
            prevRaw
          ) {
            // Creep look-ahead forward with real movement so heading does not
            // freeze through long ambiguous dual-pass stretches (R3 PIN15).
            const crept = Math.min(
              routeGeometry.totalLengthMeters,
              previousRouteMatch.chainageMeters +
                Math.min(25, Math.max(0, distanceToPinMeters(prevRaw, raw))),
            )
            rejectChainage = crept
          }
          // Map arrow input: the forward estimate BEFORE any pass switch below.
          const mapArrowRejectChainage = rejectChainage
          // Arrow only: on a doubled road the locked pass can be the wrong one;
          // the car's real travel direction may move the arrow to the right pass.
          if (rejectChainage != null) {
            arrowChainageRef.current = stepArrowTracker(arrowChainageRef.current, {
              geometry: routeGeometry,
              position: raw,
              matchedChainageMeters: rejectChainage,
              timestampMs: pos.timestamp,
              aggressiveSelfCorrection:
                route.slug === 'route-2' &&
                (pending?.sort_order === 3 || pending?.sort_order === 4),
            })
            if (arrowChainageRef.current?.override) {
              rejectChainage = arrowChainageRef.current.chain.chainageMeters
            }
          }
          // Map arrow (display only): keep it moving through rejected stretches
          // (e.g. hairpin turns) instead of freezing and then jumping when
          // matches resume. Prefer the raw fix on the road right around the
          // arrow; otherwise the forward estimate, treated as untrusted (the
          // arrow coasts at its learned speed, never jumps to another pass).
          if (mapArrowRejectChainage != null && previousRouteMatch && prevRaw) {
            publishMapArrow(mapArrowRejectChainage, Number.POSITIVE_INFINITY, null, true)
          }
          const rejectTarget =
            rejectChainage != null
              ? forwardBearingAlongRoute(
                  routeGeometry,
                  rejectChainage,
                  ARROW_LOOK_AHEAD_M,
                )
              : null
          if (rejectTarget != null) {
            setHeading((prev) =>
              stabilizeRoadArrowHeading(prev, rejectTarget, ARROW_MAX_STEP_DEG, ARROW_DEADBAND_DEG, false),
            )
          }
          return
        }
        // Priority 1: recovered / plausible match — HUD კმ = route chainage.
        const adoptedChainageMeters =
          pendingPinRecoveryReady && routeMatch.nextState
            ? routeMatch.nextState.chainageMeters
            : chainageDecision.chainageMeters
        applyRouteChainageMeters(adoptedChainageMeters)
        // Arrow = forward look-ahead from matched chainage, slewed on every route.
        routeMatchStateRef.current = routeMatch.nextState
        const matchedPosition: LatLng = [
          routeMatch.projection.position[0],
          routeMatch.projection.position[1],
        ]
        setUserPos(matchedPosition)
        // Map arrow (display only): filtered progress along the fixed route line,
        // so GPS noise / matcher snaps can never make the arrow jump ahead.
        publishMapArrow(
          routeMatch.nextState.chainageMeters,
          routeMatch.projection.crossTrackMeters,
          matchedPosition,
        )
        currentPositionRef.current = matchedPosition
        {
          arrowChainageRef.current = stepArrowTracker(arrowChainageRef.current, {
            geometry: routeGeometry,
            position: raw,
            matchedChainageMeters: routeMatch.nextState.chainageMeters,
            timestampMs: pos.timestamp,
            aggressiveSelfCorrection:
              route.slug === 'route-2' &&
              (pending?.sort_order === 3 || pending?.sort_order === 4),
          })
          const matchedHeading = forwardBearingAlongRoute(
            routeGeometry,
            arrowChainageRef.current?.chain.chainageMeters ??
              routeMatch.nextState.chainageMeters,
            ARROW_LOOK_AHEAD_M,
          )
          if (matchedHeading != null) {
            setHeading((prev) =>
              stabilizeRoadArrowHeading(
                prev,
                matchedHeading,
                ARROW_MAX_STEP_DEG,
                ARROW_DEADBAND_DEG,
                false,
              ),
            )
          }
        }

        // ============================================================
        // KILOMETRE-CROSSING PIN TRIGGER
        // Flag OFF (default): shadow only — computed and reported, the legacy
        // trigger below stays in control. Flag ON for this route: the PIN fires
        // when accepted route progress reaches its stored kilometre − lead.
        // ============================================================
        const chainagePins = chainagePinsRef.current
        if (chainagePins) {
          const activeMode = isChainageTriggerEnabled(route.slug)
          const decision = decideChainageTrigger({
            pins: chainagePins,
            done: activeMode ? chainageDoneOrders() : shadowDoneOrders(),
            progressAccepted: true,
            progressMeters: adoptedChainageMeters,
            crossTrackMeters: routeMatch.projection.crossTrackMeters,
            gpsPosition: raw,
            gpsHeadingDegrees: pos.heading,
            gpsSpeedMps: pos.speed,
            routeBearingDegrees: routeMatch.projection.segmentBearingDegrees,
            state: activeMode ? chainageTriggerStateRef.current : shadowTriggerStateRef.current,
          })
          if (activeMode) chainageTriggerStateRef.current = decision.state
          else shadowTriggerStateRef.current = decision.state
          if (decision.play !== null || decision.passSilently.length > 0) {
            reportPinTriggerEvent({
              routeSlug: route.slug,
              mode: activeMode ? 'active' : 'shadow',
              play: decision.play,
              passSilently: decision.passSilently,
              progressMeters: adoptedChainageMeters,
              gpsTimestampMs: pos.timestamp,
            })
            devLog(
              activeMode ? '[PIN KM]' : '[PIN KM SHADOW]',
              route.slug.toUpperCase(),
              '| progress:', Math.round(adoptedChainageMeters) + 'm',
              '| play:', decision.play ?? '—',
              '| passed silently:', decision.passSilently.join(',') || '—',
            )
            if (activeMode) {
              for (const order of decision.passSilently) scheduleChainagePin(order, true)
              if (decision.play !== null) scheduleChainagePin(decision.play, false)
              const pendingSave = saveNowRef.current?.()
              if (pendingSave) void pendingSave.catch(() => undefined)
            } else {
              for (const order of decision.passSilently) shadowFiredOrdersRef.current.add(order)
              if (decision.play !== null) shadowFiredOrdersRef.current.add(decision.play)
            }
          }
          if (activeMode) return
        }

        const target = pending
        const gateTarget = target
          ? identifyRoundaboutGateTarget(route.slug, target.sort_order, target.lat, target.lng)
          : null
        if (gateTarget) {
          if (!roundaboutGateGeometry) return
          const targetProjection = projectPointToRoute(
            roundaboutGateGeometry,
            [gateTarget.lat, gateTarget.lng],
          )
          const currentProjection = projectPointToRoute(
            roundaboutGateGeometry,
            [raw[0], raw[1]],
          )
          if (
            targetProjection &&
            currentProjection &&
            targetProjection.crossTrackMeters <= 30 &&
            currentProjection.crossTrackMeters <= 30
          ) {
            roundaboutGateRef.current = updateRoundaboutReturnGate(
              roundaboutGateRef.current,
              {
                route: gateTarget.route,
                sortOrder: gateTarget.sortOrder,
                lat: gateTarget.lat,
                lng: gateTarget.lng,
                currentChainageMeters: currentProjection.chainageMeters,
                targetChainageMeters: targetProjection.chainageMeters,
                currentCrossTrackMeters: currentProjection.crossTrackMeters,
                targetCrossTrackMeters: targetProjection.crossTrackMeters,
              },
            )
          }
        }

        const movementMeters = prevRaw ? distanceToPinMeters(prevRaw, raw) : 0
        const pendingTriggerM = pending
          ? pinAudioTriggerDistanceMeters(route.slug, pending.sort_order)
          : 18
        const nearPendingPin = pending
          ? distanceToPinMeters(raw, [pending.lat, pending.lng]) <= pendingTriggerM * 1.5
          : false
        // Ignore pure jitter — but never freeze near a pending PIN (tablet GPS often
        // reports sub-metre steps while the car is almost stationary).
        if (movementMeters < 0.5 && !nearPendingPin) return

        if (!target) {
          // Never auto-finish / auto-play გილოცავთ — examiner presses დასრულება.
          return
        }

        const targetTriggerM = pinAudioTriggerDistanceMeters(route.slug, target.sort_order)
        const gpsToTargetM = distanceToPinMeters(raw, [target.lat, target.lng])
        const completion = evaluatePinRouteCompletion(
          routeGeometry,
          [target.lat, target.lng],
          routeMatch,
          previousRouteMatch,
          {
            maxPinCrossTrackMeters: AUDIO_GPS_MAX_CROSS_TRACK_M,
            maxFixCrossTrackMeters: AUDIO_GPS_MAX_CROSS_TRACK_M,
            maxAccuracyMeters: AUDIO_GPS_MAX_ACCURACY_M,
            approachWindowMeters: pinAudioApproachWindowMeters(route.slug, target.sort_order),
            minimumForwardMeters: 1,
            expectedPinChainageMeters,
            pinProjectionWindowMeters:
              route.slug === 'route-2' && target.sort_order === 3 ? 20 : undefined,
            requireExpectedPinChainage: usesTargetOccurrenceContext,
            gpsPosition: raw,
            maxGpsToPinMeters: Math.max(40, targetTriggerM),
          },
        )

        // When route-geometry matching fails (loop ambiguity / off-center pin), still
        // fire if the live GPS is inside the PIN's audio bubble. Sequential pending
        // order is unchanged — only the next PIN can use this fallback.
        const audioHeadingToleranceDeg =
          usesRouteContextTarget
            ? 45
            : AUDIO_HEADING_TOLERANCE_DEG
        // Loop-context PINs (R1#32 / R2#26 / R3#28 / R4#29): first roadside can be
        // near the same coords — only route-geometry + expected chainage may speak.
        const proximityReady =
          !usesTargetOccurrenceContext &&
          gpsToTargetM <= targetTriggerM &&
          audioHeadingOk(
            headingMatches(
              raw,
              [target.lat, target.lng],
              pos.heading,
              audioHeadingToleranceDeg,
            ),
            pos.speed,
          )

        devLog('[PIN GEOMETRY]',
          route.slug.toUpperCase(),
          '| Expected:', `#${nextPinIndex + 1} (PIN ${target.sort_order})`,
          '| Status:', completion.status,
          '| Pin cross-track:', completion.pinProjection ? Math.round(completion.pinProjection.crossTrackMeters) + 'm' : '—',
          proximityReady && !completion.ready ? '| Proximity fallback' : '',
        )

        // Geometry OR proximity is enough — do not block a ready pin on heading noise.
        if (!completion.ready && !proximityReady) return
        if (
          completion.ready &&
          completion.pinProjection &&
          completion.fixProjection &&
          completion.pinProjection.chainageMeters >= completion.fixProjection.chainageMeters &&
          !audioHeadingOk(
            headingMatches(
              raw,
              [target.lat, target.lng],
              pos.heading,
              audioHeadingToleranceDeg,
            ),
            pos.speed,
          )
        ) return
        if (gateTarget) {
          if (!isRoundaboutReturnGateOpened(
            route.slug,
            target.sort_order,
            target.lat,
            target.lng,
            roundaboutGateRef.current,
          )) {
            devLog('[ROUNDABOUT AUDIO GATE]',
              route.slug.toUpperCase(),
              '| PIN:', target.sort_order,
              '| Phase:', roundaboutGateRef.current.phase,
              '| Returning:', false,
            )
            return
          }
        }

        if (triggeredRef.current.has(target.id) || pendingPinSortOrderRef.current === target.sort_order) {
          return
        }
        devLog('[PIN SEQUENCE]',
          route.slug.toUpperCase(),
          '| 🔊 PIN #' + (nextPinIndex + 1) + ' TRIGGERED (route geometry)!',
          '| Audio:', target.instruction_ka,
          '| Progress:', (triggeredRef.current.size + 1) + '/' + totalPins,
        )
        markPinTriggered(target)
        if (pendingPinSortOrderRef.current === null) {
          setPendingPinSortOrder(target.sort_order)
        } else if (!queuedAudioPinOrdersRef.current.includes(target.sort_order)) {
          queuedAudioPinOrdersRef.current.push(target.sort_order)
        }
        const pendingSave = saveNowRef.current?.()
        if (pendingSave) void pendingSave.catch(() => undefined)
      },
      (err) => {
        setGpsError(formatGpsError(err))
        // Keep last speedRoadU / km-based limit; do not clear on GPS loss.
      },
    )
    // Intentionally omit `phase` from deps: use phaseRef so GPS watch is not torn down on
    // active→summary (temporary GPS gaps must not unmount/remount the route map).
  }, [gpsStarted, voicePins, route.slug, features.routeAudio, polyline, previewGpsSource, updateSpeedRoadProgress])

  useEffect(() => {
    if (
      phase !== 'active' ||
      !features.routeAudio ||
      pendingPinSortOrder === null ||
      finishInProgressRef.current
    ) return

    const target = voicePins.find((pin) => pin.sort_order === pendingPinSortOrder)
    if (!target) return
    const generation = audioSessionGenerationRef.current
    let busyRetries = 0
    let playFailures = 0

    const isCurrent = () =>
      generation === audioSessionGenerationRef.current &&
      phaseRef.current === 'active' &&
      !finishInProgressRef.current &&
      pendingPinSortOrderRef.current === target.sort_order

    const scheduleRetry = (delayMs = AUDIO_RETRY_BASE_MS) => {
      if (!isCurrent() || audioRetryTimerRef.current !== null) return
      audioRetryTimerRef.current = window.setTimeout(() => {
        audioRetryTimerRef.current = null
        void attemptPlayback()
      }, delayMs)
    }

    const completePin = (silent = false) => {
      if (!isCurrent()) return
      if (audioQueueWatchdogRef.current !== null) {
        clearTimeout(audioQueueWatchdogRef.current)
        audioQueueWatchdogRef.current = null
      }
      audioAttemptInFlightRef.current = false
      audioWaitingForUserRef.current = false
      continueFailedAudioPinRef.current = null
      const currentPin = voicePinsRef.current.find((pin) => pin.sort_order === target.sort_order) ?? target
      markPinHandled(currentPin)
      pinApproachRef.current.delete(currentPin.id)
      setAudioPlaybackError(null)
      if (!silent) setLastSpoken(formatPinInstructionLabel(currentPin.sort_order, currentPin.instruction_ka))
      setPendingPinSortOrder(queuedAudioPinOrdersRef.current.shift() ?? null)
      const pendingSave = saveNowRef.current?.()
      if (pendingSave) void pendingSave.catch(() => undefined)
    }

    /** After auto-retries fail: keep this PIN pending and ask the driver to retry or continue. */
    const holdForUserContinue = (message: string) => {
      if (!isCurrent()) return
      if (audioQueueWatchdogRef.current !== null) {
        clearTimeout(audioQueueWatchdogRef.current)
        audioQueueWatchdogRef.current = null
      }
      if (audioRetryTimerRef.current !== null) {
        clearTimeout(audioRetryTimerRef.current)
        audioRetryTimerRef.current = null
      }
      audioAttemptInFlightRef.current = false
      audioWaitingForUserRef.current = true
      continueFailedAudioPinRef.current = () => {
        if (!isCurrent()) return
        completePin()
      }
      setAudioPlaybackError({ sortOrder: target.sort_order, message })
    }

    const attemptPlayback = async () => {
      if (!isCurrent() || audioAttemptInFlightRef.current || audioWaitingForUserRef.current) return
      // Kilometre trigger: an outdated PIN the car already passed is marked
      // handled WITHOUT playing its instruction.
      if (silentPinOrdersRef.current.has(target.sort_order)) {
        silentPinOrdersRef.current.delete(target.sort_order)
        completePin(true)
        return
      }
      if (startAudioPendingRef.current || audioEngine.isBusy()) {
        busyRetries += 1
        if (busyRetries > AUDIO_BUSY_MAX_RETRIES) {
          console.warn(
            '[AUDIO] PIN voice blocked by busy engine; waiting for driver continue',
            target.sort_order,
          )
          holdForUserContinue('ხმა ვერ გაეშვა (დაკავებულია). სცადეთ ხელახლა ან გააგრძელეთ.')
          return
        }
        scheduleRetry()
        return
      }

      audioAttemptInFlightRef.current = true
      let settled = false
      const attemptId = ++audioPlaybackAttemptRef.current
      const isAttemptCurrent = () =>
        attemptId === audioPlaybackAttemptRef.current && isCurrent()
      // Auto-retry a few times; then hold for the driver so progress is not lost silently.
      const failed = (reason: PlaybackFailureReason | null = null) => {
        if (settled || !isAttemptCurrent()) return
        settled = true
        audioAttemptInFlightRef.current = false
        if (audioQueueWatchdogRef.current !== null) {
          clearTimeout(audioQueueWatchdogRef.current)
          audioQueueWatchdogRef.current = null
        }
        if (reason !== null) {
          playFailures += 1
          if (playFailures < AUDIO_MAX_ATTEMPTS) {
            console.warn(
              '[AUDIO] PIN voice failed; retrying',
              target.sort_order,
              reason,
              `${playFailures}/${AUDIO_MAX_ATTEMPTS}`,
            )
            audioEngine.unlock()
            const url = voicePinsRef.current.find((pin) => pin.sort_order === target.sort_order)?.audio_url
            if (url) audioEngine.preload(url)
            audioPlaybackAttemptRef.current += 1
            scheduleRetry(Math.min(AUDIO_RETRY_BASE_MS * playFailures, AUDIO_RETRY_MAX_MS))
            return
          }
          console.warn(
            '[AUDIO] PIN voice failed after retries; waiting for driver continue',
            target.sort_order,
            reason,
          )
          holdForUserContinue('ხმა ვერ გაეშვა. სცადეთ ხელახლა ან გააგრძელეთ შემდეგ პინზე.')
          return
        }
        busyRetries += 1
        if (busyRetries > AUDIO_BUSY_MAX_RETRIES) {
          console.warn(
            '[AUDIO] PIN voice busy/cancelled too long; waiting for driver continue',
            target.sort_order,
          )
          holdForUserContinue('ხმა ვერ გაეშვა (დაკავებულია). სცადეთ ხელახლა ან გააგრძელეთ.')
          return
        }
        audioPlaybackAttemptRef.current += 1
        scheduleRetry()
      }
      const completed = () => {
        if (settled || !isAttemptCurrent()) return
        settled = true
        completePin()
      }

      const currentTarget = voicePinsRef.current.find((pin) => pin.sort_order === target.sort_order)
      if (!currentTarget) {
        audioAttemptInFlightRef.current = false
        return
      }
      // ფინიში only on Alazani / near PIN 1 — outside that zone advance silently.
      if (currentTarget.instruction_ka === 'ფინიში') {
        const pin1 = voicePinsRef.current.find((pin) => pin.sort_order === 1) ?? null
        if (!isFinishAudioAllowed(route.slug, currentPositionRef.current, pin1)) {
          console.warn('[AUDIO] Finish voice skipped — outside PIN 1 radius', route.slug)
          completePin()
          return
        }
      }
      if (currentTarget.audio_url) audioEngine.preload(currentTarget.audio_url)
      // Warm the next queued voices so catch-up does not hitch.
      for (const order of queuedAudioPinOrdersRef.current.slice(0, 3)) {
        const queued = voicePinsRef.current.find((pin) => pin.sort_order === order)
        if (queued?.audio_url) audioEngine.preload(queued.audio_url)
      }
      try {
        audioQueueWatchdogRef.current = window.setTimeout(() => {
          if (!isAttemptCurrent() || settled) return
          settled = true
          audioAttemptInFlightRef.current = false
          if (audioQueueWatchdogRef.current !== null) {
            clearTimeout(audioQueueWatchdogRef.current)
            audioQueueWatchdogRef.current = null
          }
          playFailures += 1
          console.warn(
            '[AUDIO] PIN playback watchdog expired',
            target.sort_order,
            `${playFailures}/${AUDIO_MAX_ATTEMPTS}`,
          )
          audioEngine.stopAll()
          if (playFailures < AUDIO_MAX_ATTEMPTS) {
            audioEngine.unlock()
            if (currentTarget.audio_url) audioEngine.preload(currentTarget.audio_url)
            audioPlaybackAttemptRef.current += 1
            scheduleRetry(Math.min(AUDIO_RETRY_BASE_MS * playFailures, AUDIO_RETRY_MAX_MS))
            return
          }
          holdForUserContinue('ხმა ვერ გაეშვა (timeout). სცადეთ ხელახლა ან გააგრძელეთ.')
        }, AUDIO_QUEUE_WATCHDOG_MS)
        const status = await audioEngine.playDetailed(
          currentTarget.audio_url,
          currentTarget.id,
          currentTarget.instruction_ka,
          {
            onEnded: completed,
            onFailure: failed,
            playbackRate: pinVoicePlaybackRate(route.slug, currentTarget.sort_order),
          },
        )
        if (status === 'failed') failed('play-rejected')
        else if (status === 'busy' || status === 'cancelled') failed(null)
        else if (status === 'duplicate') {
          audioPlaybackAttemptRef.current += 1
          audioAttemptInFlightRef.current = false
          if (audioQueueWatchdogRef.current !== null) {
            clearTimeout(audioQueueWatchdogRef.current)
            audioQueueWatchdogRef.current = null
          }
          busyRetries += 1
          if (busyRetries > AUDIO_BUSY_MAX_RETRIES) {
            console.warn(
              '[AUDIO] PIN voice duplicate too long; waiting for driver continue',
              target.sort_order,
            )
            holdForUserContinue('ხმა ვერ გაეშვა (დაკავებულია). სცადეთ ხელახლა ან გააგრძელეთ.')
            return
          }
          scheduleRetry()
        }
      } catch (error) {
        console.warn('[AUDIO] PIN playback threw; retrying/holding', target.sort_order, error)
        failed('play-rejected')
      }
    }

    if (audioRetryTimerRef.current !== null) {
      clearTimeout(audioRetryTimerRef.current)
      audioRetryTimerRef.current = null
    }
    // Fresh effect run (including explicit retry tap) clears a previous hold.
    audioWaitingForUserRef.current = false
    const resumePendingAudio = () => {
      if (
        document.visibilityState !== 'visible' ||
        audioAttemptInFlightRef.current ||
        audioWaitingForUserRef.current
      ) return
      if (audioRetryTimerRef.current !== null) {
        clearTimeout(audioRetryTimerRef.current)
        audioRetryTimerRef.current = null
      }
      void attemptPlayback()
    }
    document.addEventListener('visibilitychange', resumePendingAudio)
    void attemptPlayback()

    return () => {
      document.removeEventListener('visibilitychange', resumePendingAudio)
      if (audioRetryTimerRef.current !== null) {
        clearTimeout(audioRetryTimerRef.current)
        audioRetryTimerRef.current = null
      }
      if (audioQueueWatchdogRef.current !== null) {
        clearTimeout(audioQueueWatchdogRef.current)
        audioQueueWatchdogRef.current = null
      }
    }
  }, [pendingPinSortOrder, phase, features.routeAudio, route.slug, voicePins, setPendingPinSortOrder, audioRetryToken])

  const handleError = useCallback((errorId: string) => {
    setExam((prev) => recordExamError(prev, errorId, false))
  }, [])

  const handleSevereQuick = useCallback(() => {
    setExam((prev) => recordSevereQuick(prev))
  }, [])

  function playSessionStartAudio(generation: number) {
    const retry = () => {
      if (
        generation !== audioSessionGenerationRef.current ||
        !startAudioPendingRef.current ||
        startAudioRetryTimerRef.current !== null
      ) return
      startAudioRetryTimerRef.current = window.setTimeout(() => {
        startAudioRetryTimerRef.current = null
        playSessionStartAudio(generation)
      }, AUDIO_RETRY_BASE_MS)
    }
    const failed = (reason: PlaybackFailureReason) => {
      if (generation !== audioSessionGenerationRef.current) return
      startAudioPendingRef.current = false
      console.warn('[AUDIO] Session start voice failed', route.slug, reason)
    }
    const completed = () => {
      if (generation !== audioSessionGenerationRef.current) return
      startAudioPendingRef.current = false
      setLastSpoken(EXAM_START_TEXT)
    }

    if (
      generation !== audioSessionGenerationRef.current ||
      !startAudioPendingRef.current ||
      finishInProgressRef.current
    ) return
    if (audioEngine.isBusy()) {
      retry()
      return
    }

    void audioEngine.playDetailed(
      EXAM_START_AUDIO,
      `route-start-${route.slug}-${generation}`,
      EXAM_START_TEXT,
      { onEnded: completed, onFailure: failed },
    ).then((status) => {
      if (generation !== audioSessionGenerationRef.current || !startAudioPendingRef.current) return
      if (status === 'failed') failed('play-rejected')
      else if (status === 'busy' || status === 'cancelled') retry()
      else if (status === 'duplicate') startAudioPendingRef.current = false
    }).catch((error) => {
      if (generation !== audioSessionGenerationRef.current) return
      startAudioPendingRef.current = false
      console.warn('[AUDIO] Session start voice threw', route.slug, error)
    })
  }

  function startSession(
    startSortOrder = 1,
    startMode: 'automatic' | 'manual' = 'automatic',
    sessionVoicePosition?: LatLng | null,
    hintChainageMeters?: number | null,
  ) {
    const isFieldTest = FIELD_TEST_SLUGS.has(route.slug)
    const progressRead = isFieldTest ? readRoutePinProgress(route.slug, persistenceScope) : null
    if (progressRead?.status === 'invalid' || progressRead?.status === 'unavailable') {
      resumeBlockedRef.current = true
      setResumeError(RESUME_UNRESOLVED_MESSAGE)
      setNextPin(null)
      setRouteComplete(false)
      return
    }

    // Completed route: always clear progress so restart never sticks on
    // "ყველა PIN გავლილია" (location must not gate this — დაწყება voice stays
    // gated by isStartAudioAllowed later).
    if (isFieldTest) {
      const priorHandled = mostAdvancedPinProgress(
        voicePins,
        loadRoutePinProgress(route.slug, persistenceScope),
        voicePins.filter((pin) => pin.sort_order < startSortOrder).map((pin) => pin.sort_order),
      )
      const priorResolution = resolvePinProgress(voicePins, priorHandled)
      if (priorResolution.status === 'resume' && priorResolution.nextSortOrder === null) {
        clearRoutePinProgress(route.slug, persistenceScope)
        clearManualPinSelection(route.slug, persistenceScope)
        startSortOrder = 1
        setSavedEpoch((value) => value + 1)
      }
    }

    audioSessionGenerationRef.current++
    setAudioPlaybackError(null)
    audioWaitingForUserRef.current = false
    continueFailedAudioPinRef.current = null
    const sessionGeneration = audioSessionGenerationRef.current
    audioEngine.stopAll()
    if (startAudioRetryTimerRef.current !== null) {
      clearTimeout(startAudioRetryTimerRef.current)
      startAudioRetryTimerRef.current = null
    }
    startAudioPendingRef.current = false
    automaticFinishStartedRef.current = false
    queuedAudioPinOrdersRef.current = []
    if (audioRetryTimerRef.current !== null) {
      clearTimeout(audioRetryTimerRef.current)
      audioRetryTimerRef.current = null
    }
    if (audioQueueWatchdogRef.current !== null) {
      clearTimeout(audioQueueWatchdogRef.current)
      audioQueueWatchdogRef.current = null
    }
    audioAttemptInFlightRef.current = false
    finishInProgressRef.current = false
    finishRouteSlugRef.current = null
    sessionStartModeRef.current = startMode
    const handled = isFieldTest
      ? mostAdvancedPinProgress(
          voicePins,
          loadRoutePinProgress(route.slug, persistenceScope),
          voicePins.filter((pin) => pin.sort_order < startSortOrder).map((pin) => pin.sort_order),
        )
      : new Set(
          voicePins
            .filter((pin) => pin.sort_order < startSortOrder)
            .map((pin) => pin.sort_order),
        )
    routeDistanceOriginMetersRef.current =
      route.slug === 'route-1' && handled.has(1)
        ? route1StartPinChainageMeters()
        : 0
    const resolution = isFieldTest ? resolvePinProgress(voicePins, handled) : null
    if (isFieldTest && (resolution?.status !== 'resume' || resolution.nextSortOrder === null)) {
      setResumeError(
        resolution?.status === 'error'
          ? resolution.message
          : 'მარშრუტზე გასაგრძელებელი PIN აღარ არის. დააჭირეთ „დასრულება“.',
      )
      setRouteComplete(resolution?.status === 'resume' && voicePins.length > 0)
      return
    }
    if (!isFieldTest) clearRoutePinProgress(route.slug, persistenceScope)
    clearManualPinSelection(route.slug, persistenceScope)
    if (isFieldTest && handled.size > 0) saveRoutePinProgress(route.slug, handled, persistenceScope)
    triggeredRef.current = pinIdsForOrders(voicePins, handled)
    pinApproachRef.current = new Map()
    resetChainageTriggerState()
    displayProgressRef.current = null
    setMapVehicleMotion(null)
    routeMatchStateRef.current = null
    arrowChainageRef.current = null
    setPendingPinSortOrder(null)
    if (FIELD_TEST_SLUGS.has(route.slug)) {
      handledOrdersRef.current = handled
    }
    resumeBlockedRef.current = false
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setRouteComplete(false)
    setResumeError(null)
    resumePendingRef.current = false
    sessionStartRef.current = Date.now()
    setElapsedMs(0)
    const voicePos = sessionVoicePosition ?? currentPositionRef.current
    if (voicePos) currentPositionRef.current = voicePos
    const hint =
      hintChainageMeters != null && Number.isFinite(hintChainageMeters)
        ? Math.max(0, hintChainageMeters)
        : seedHintChainageRef.current
    seedHintChainageRef.current = null
    const seededMeters = seedLiveDistanceMeters(
      startSortOrder,
      currentPositionRef.current,
      hint,
    )
    // Lock match state to the seeded chainage so live matching continues from the
    // same pass (do not cold-start toward a distant lit PIN on an ambiguous plaza).
    if (routeGeometryRef.current) {
      applyRouteChainageMeters(seededMeters, {
        syncMatchState: true,
        timestampMs: Date.now(),
      })
    } else {
      applySeededDistance(seededMeters)
    }
    // Arrow only: start facing the road's forward direction at the seeded
    // chainage. The coarse-polyline resolveHeading() used at GPS enable can
    // pick the opposing pass and start the arrow ~180° backwards.
    {
      const startGeometry = routeGeometryRef.current
      if (startGeometry) {
        const startHeading = forwardBearingAlongRoute(
          startGeometry,
          Math.max(0, seededMeters),
          ARROW_LOOK_AHEAD_M,
        )
        if (startHeading != null) setHeading(startHeading)
      }
    }
    setLastSpoken(null)
    
    const nextOrder = resolution?.status === 'resume'
      ? resolution.nextSortOrder
      : voicePins.find((pin) => !triggeredRef.current.has(pin.id))?.sort_order ?? null
    const nextPinCandidate = voicePins.find((pin) => pin.sort_order === nextOrder) ?? null
    
    setNextPin(nextPinCandidate ?? null)
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
    setSpeedKmh(0)
    {
      const nextView: ExamDriveView = features.mapNav ? 'map' : 'panel'
      driveViewRef.current = nextView
      setDriveView(nextView)
      saveDriveView(route.slug, nextView, persistenceScope)
    }
    setPhase('active')
    resumedSlugRef.current = route.slug
    const pin1 = voicePins.find((pin) => pin.sort_order === 1) ?? null
    const pin2 = voicePins.find((pin) => pin.sort_order === 2) ?? null
    // დაწყება only within 30 m of PIN 1.
    startAudioPendingRef.current =
      features.routeAudio && isStartAudioAllowed(route.slug, voicePos, pin1, pin2)
    if (startAudioPendingRef.current) playSessionStartAudio(sessionGeneration)
  }

  async function handleStartSession(
    startAtSortOrder?: number,
    startOptions?: PreviewDemoStartOptions,
  ) {
    // Must run synchronously inside the click, before any await (GPS prompt would lose the gesture).
    audioEngine.unlock()
    if (gpsStarting) return
    if (remoteSessionLoading || remoteSessionCreating || remotePersistenceError) return
    if (
      startOptions?.hintChainageMeters != null &&
      Number.isFinite(startOptions.hintChainageMeters)
    ) {
      seedHintChainageRef.current = Math.max(0, startOptions.hintChainageMeters)
    }
    if (FIELD_TEST_SLUGS.has(route.slug)) {
      const progressRead = readRoutePinProgress(route.slug, persistenceScope)
      if (progressRead.status === 'invalid' || progressRead.status === 'unavailable') {
        resumeBlockedRef.current = true
        setResumeError(RESUME_UNRESOLVED_MESSAGE)
        setNextPin(null)
        return
      }
    }
    
    // ============================================================
    // If savedState exists, we're RESUMING - don't reset session!
    // Just ensure GPS is ready and stay in active phase
    // ============================================================
    if (savedState) {
      try {
        await ensureRemoteExamSession(savedState)
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'უცნობი შეცდომა'
        console.error('Could not bind the resumed exam to its server session:', error)
        setRemotePersistenceError(`გამოცდის სერვერულ სესიასთან მიბმა ვერ მოხერხდა: ${detail}`)
        return
      }
      console.log('🔄 Resuming active session - not calling startSession()')
      sessionStartModeRef.current = savedState.startMode ?? 'manual'
      if (savedState.phase === 'summary') {
        setPhase('summary')
        return
      }
      if (FIELD_TEST_SLUGS.has(route.slug)) {
        const restoredOrders = restoredHandledOrders(savedState, voicePins, route.slug, persistenceScope)
        if (restoredOrders) {
          const orders = persistMostAdvancedPinProgress(restoredOrders)
          handledOrdersRef.current = orders
          triggeredRef.current = pinIdsForOrders(voicePins, handledOrdersRef.current)
          const progress = nextSortOrder(voicePins, orders)
          setNextPin(voicePins.find((pin) => pin.sort_order === progress.nextSortOrder) ?? null)
          setRouteComplete(voicePins.length > 0 && progress.nextSortOrder === null)
          resumePendingRef.current = false
        } else {
          const resolution = resolveExamResume(savedState, voicePins, route.slug)
          resumeBlockedRef.current =
            resolution.status === 'error' ||
            (resolution.status === 'resume' && resolution.handledOrders !== null)
          if (resolution.status === 'pending' ||
            (resolution.status === 'resume' && resolution.handledOrders === null)) {
            resumePendingRef.current = true
            if (savedState.phase === 'active' && savedState.userPos) {
              const gpsPin = resolveAutoStart(
                voicePins,
                new Set(),
                savedState.userPos,
                autoStartPolyline,
                route.slug as 'route-1' | 'route-2' | 'route-3' | 'route-4',
              ).pin
              if (gpsPin) {
                const recovered = new Set(
                  voicePins
                    .filter((pin) => pin.sort_order < gpsPin.sort_order)
                    .map((pin) => pin.sort_order),
                )
                const orders = persistMostAdvancedPinProgress(recovered)
                handledOrdersRef.current = orders
                triggeredRef.current = pinIdsForOrders(voicePins, orders)
                setNextPin(gpsPin)
                resumePendingRef.current = false
                resumeBlockedRef.current = false
              }
            }
          }
          if (resolution.status === 'error') {
            setResumeError(resolution.message)
          } else if (
            resolution.status === 'resume' &&
            resolution.handledOrders === null &&
            resumePendingRef.current
          ) {
            setResumeError(RESUME_PENDING_MESSAGE)
          }
        }
      }
      if (phase !== 'active') setPhase('active')
      const resumeGps = !gpsStarted
        ? await enableGps(true)
        : rawPos
          ? { position: userPos, fix: rawPos, denied: false }
          : await enableGps(true)
      // Auto გაგრძელება: if the car already passed saved next, snap forward — never stay behind.
      if (
        !resumeGps.denied &&
        resumeGps.position &&
        (savedState.startMode ?? sessionStartModeRef.current) === 'automatic' &&
        FIELD_TEST_SLUGS.has(route.slug)
      ) {
        const floorOrders = handledOrdersRef.current ?? new Set<number>()
        const gpsPin = resolveAutoStart(
          voicePins,
          floorOrders,
          resumeGps.position,
          autoStartPolyline,
          route.slug as 'route-1' | 'route-2' | 'route-3' | 'route-4',
        ).pin
        if (gpsPin) {
          const currentNext = nextSortOrder(voicePins, floorOrders).nextSortOrder
          if (currentNext == null || gpsPin.sort_order > currentNext) {
            const advanced = new Set(
              voicePins
                .filter((pin) => pin.sort_order < gpsPin.sort_order)
                .map((pin) => pin.sort_order),
            )
            const orders = persistMostAdvancedPinProgress(advanced)
            handledOrdersRef.current = orders
            triggeredRef.current = pinIdsForOrders(voicePins, orders)
            setNextPin(gpsPin)
            setRouteComplete(false)
            resumePendingRef.current = false
            resumeBlockedRef.current = false
            setResumeError(null)
          }
        }
      }
      return
    }
    
    // No saved state - this is a NEW session. Resume returned above.
    const gpsResult = previewGpsSource
      ? await enableGps(false)
      : rawPos
        ? { position: userPos, fix: rawPos, denied: false }
        : await enableGps(false)
    if (gpsResult.denied) return
    const gpsAutoStartPin =
      gpsResult.position && previewSelectionMode === 'automatic'
        ? resolveAutoStart(
            voicePins,
            new Set(initialRoutePinProgress),
            gpsResult.position,
            autoStartPolyline,
            route.slug as 'route-1' | 'route-2' | 'route-3' | 'route-4',
          ).pin
        : null
    const selectedSortOrder = startAtSortOrder ?? (
      previewSelectionMode === 'manual'
        ? previewPin?.sort_order
        : (gpsAutoStartPin ?? autoStartPin)?.sort_order
    )
    if (selectedSortOrder === undefined || selectedSortOrder === null) return
    if (startAtSortOrder !== undefined) {
      setPreviewSelectionMode('manual')
      setPreviewPinSelection({ routeId: route.id, sortOrder: startAtSortOrder })
      saveManualPinSelection(route.slug, startAtSortOrder, persistenceScope)
    }
    try {
      await ensureRemoteExamSession(
        undefined,
        selectedSortOrder,
        startAtSortOrder === undefined ? previewSelectionMode : 'manual',
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'უცნობი შეცდომა'
      console.error('Could not create the server exam session:', error)
      setRemotePersistenceError(`გამოცდის სერვერული სესია ვერ შეიქმნა: ${detail}`)
      return
    }
    const hintForStart = seedHintChainageRef.current
    startSession(
      selectedSortOrder,
      startAtSortOrder === undefined ? previewSelectionMode : 'manual',
      gpsResult.position ?? currentPositionRef.current,
      hintForStart,
    )
  }

  function fieldTestProgressFields() {
    const pins = pinsRef.current
    const orders = handledOrdersRef.current
    if (orders === null) return {}
    const sorted = [...orders].sort((a, b) => a - b)
    if (pins.length === 0) {
      const previous = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
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

  function getHandledPinOrders(): number[] {
    const handled = handledOrdersRef.current
    const orders =
      handled ??
      ordersForIds(triggeredRef.current, pinsRef.current, route.slug).orders
    return [...orders].sort((a, b) => a - b)
  }

  function persistMostAdvancedPinProgress(...candidates: Array<Iterable<number> | null | undefined>) {
    const orders = mostAdvancedPinProgress(
      pinsRef.current,
      loadRoutePinProgress(route.slug, persistenceScope),
      ...candidates,
    )
    if (orders.size > 0 || loadRoutePinProgress(route.slug, persistenceScope) !== null) {
      saveRoutePinProgress(route.slug, orders, persistenceScope)
    }
    return orders
  }

  /**
   * Re-anchored match state must carry the GPS time of the last accepted fix,
   * not the device wall clock: matchGpsPosition rejects any later fix whose
   * timestamp is not newer ('out-of-order-fix'), so a device clock running
   * ahead of GPS time used to freeze progress and PINs after every anchor.
   */
  function anchorTimestampMs(): number {
    const lastFix = routeMatchStateRef.current?.timestampMs
    return lastFix != null && Number.isFinite(lastFix) ? lastFix : Date.now()
  }

  function anchorDistanceAtConfirmedPin(pin: PinRow) {
    if (chainageTriggerActive()) {
      // Kilometre trigger: GPS route progress is the truth. Snapping progress to
      // the PIN (the legacy anchor, up to ~60 m backwards on loop PINs) would
      // corrupt it. Route 1 keeps its HUD km origin at PIN 1 only.
      if (route.slug === 'route-1' && pin.sort_order === 1) {
        routeDistanceOriginMetersRef.current = route1StartPinChainageMeters()
        const current = routeMatchStateRef.current?.chainageMeters
        if (current != null) applyRouteChainageMeters(current)
      }
      return
    }
    if (route.slug === 'route-1' && pin.sort_order === 1) {
      routeDistanceOriginMetersRef.current = route1StartPinChainageMeters()
      applyRouteChainageMeters(routeDistanceOriginMetersRef.current, {
        syncMatchState: true,
        timestampMs: anchorTimestampMs(),
      })
      return
    }
    // Priority 3: confirmed PIN restores exact predefined route chainage.
    const pinChainage = resolveExactPinChainageMeters(pin.sort_order)
    if (pinChainage == null) return
    const decision = decideChainageFromPinAnchor(pinChainage)
    if (decision.action !== 'pin-anchor') return
    applyRouteChainageMeters(decision.chainageMeters, {
      syncMatchState: true,
      timestampMs: anchorTimestampMs(),
    })
  }

  function markPinHandled(pin: PinRow) {
    anchorDistanceAtConfirmedPin(pin)
    if (FIELD_TEST_SLUGS.has(route.slug)) {
      const orders = handledOrdersRef.current ?? new Set<number>()
      orders.add(pin.sort_order)
      const progressOrders = persistMostAdvancedPinProgress(orders)
      handledOrdersRef.current = progressOrders
      const scheduledOrders = [
        pendingPinSortOrderRef.current,
        ...queuedAudioPinOrdersRef.current,
      ].filter((order): order is number => order !== null)
      triggeredRef.current = new Set([
        ...triggeredRef.current,
        ...pinIdsForOrders(pinsRef.current, progressOrders),
        ...pinIdsForOrders(pinsRef.current, new Set(scheduledOrders)),
      ])
      setNextPin(pinsRef.current.find((item) => !triggeredRef.current.has(item.id)) ?? null)
      setRouteComplete(pinsRef.current.length > 0 && nextSortOrder(pinsRef.current, progressOrders).nextSortOrder === null)
      return
    }

    triggeredRef.current.add(pin.id)
    setNextPin(pinsRef.current.find((item) => !triggeredRef.current.has(item.id)) ?? null)
    persistMostAdvancedPinProgress(getHandledPinOrders())
  }

  function markPinTriggered(pin: PinRow) {
    if (!FIELD_TEST_SLUGS.has(route.slug)) {
      // Non-field: handled immediately (anchor runs inside markPinHandled).
      markPinHandled(pin)
      return
    }
    // Field-test: anchor as soon as the PIN is confirmed on-route (before audio
    // finishes), so HUD კმ / speed bands recover even if matching is unstable.
    anchorDistanceAtConfirmedPin(pin)
    triggeredRef.current.add(pin.id)
    setNextPin(pinsRef.current.find((item) => !triggeredRef.current.has(item.id)) ?? null)
  }

  async function ensureRemoteExamSession(
    initialState?: SavedExamState,
    startSortOrder = 1,
    startMode: 'automatic' | 'manual' = 'automatic',
  ): Promise<void> {
    if (!REMOTE_EXAM_SESSION_BACKEND_ENABLED || !isSupabaseConfigured || !userId || !deviceId) return
    if (!tabId) throw new Error('ამ მოწყობილობის ბრაუზერის tab-ის იდენტიფიკაცია ვერ მოხერხდა.')
    if (remoteWriterRef.current && remoteSessionIdRef.current) return
    if (remoteCreatePromiseRef.current) return remoteCreatePromiseRef.current

    setRemoteSessionCreating(true)
    const creation = (async () => {
      const priorOrders = voicePins
        .filter((pin) => pin.sort_order < startSortOrder)
        .map((pin) => pin.sort_order)
      const progressFields = FIELD_TEST_SLUGS.has(route.slug)
        ? {
            triggeredSortOrders: priorOrders,
            lastPassedSortOrder: priorOrders.at(-1) ?? null,
            nextSortOrder: voicePins.find((pin) => pin.sort_order >= startSortOrder)?.sort_order ?? null,
          }
        : {}
      const initialSnapshot: SavedExamState = initialState ?? {
        routeId: route.id,
        routeSlug: route.slug,
        routeName: route.name_ka,
        phase: 'active',
        userId,
        deviceId,
        startMode,
        exam: createExamSession(route.id, route.name_ka),
        userPos: currentPositionRef.current,
        heading,
        speedKmh,
        elapsedMs: 0,
        distanceMeters: distanceMetersRef.current,
        triggeredPins: Array.from(pinIdsForOrders(voicePins, new Set(priorOrders))),
        pendingPinSortOrder: null,
        queuedPinSortOrders: [],
        driveView: driveViewRef.current,
        ...progressFields,
        savedAt: Date.now(),
      }
      const sessionSnapshot: SavedExamState = {
        ...initialSnapshot,
        userId,
        deviceId,
        ...(tabId ? { tabId } : {}),
      }
      const migrationKeyStorageKey =
        `cityroute-exam-create:${encodeURIComponent(userId)}:${encodeURIComponent(deviceId)}:${encodeURIComponent(tabId ?? 'no-tab')}:${encodeURIComponent(route.slug)}`
      let migrationKey: string | null
      try {
        migrationKey = sessionStorage.getItem(migrationKeyStorageKey)
        if (!migrationKey) {
          migrationKey = newExamSessionMigrationKey()
          sessionStorage.setItem(migrationKeyStorageKey, migrationKey)
        }
      } catch (error) {
        throw new Error('გამოცდის სესიის უსაფრთხო აღდგენის გასაღები ვერ შეინახა.', { cause: error })
      }

      const session = await createRemoteExamSession({
        userId,
        routeSlug: route.slug,
        deviceId,
        tabId: tabId ?? '',
        progress: toJson(sessionSnapshot),
        errors: toJson(sessionSnapshot.exam.counts),
        elapsedMs: sessionSnapshot.elapsedMs,
        startedAt: new Date(sessionSnapshot.exam.startedAt).toISOString(),
        migrationKey,
      })
      if (
        session.user_id !== userId ||
        session.device_id !== deviceId ||
        session.tab_id !== (tabId ?? '') ||
        session.route_slug !== route.slug
      ) {
        throw new Error('სერვერმა სხვა ანგარიშის, მოწყობილობის ან მარშრუტის გამოცდის სესია დააბრუნა.')
      }

      remoteSessionIdRef.current = session.session_id
      remoteWriterRef.current = new RemoteExamSessionWriter(
        session.session_id,
        session.version,
        { userId, deviceId, tabId },
      )
      remoteWriteBlockedRef.current = false
      const initialRevision = ++remoteWriteRevisionRef.current
      sessionStorage.removeItem(migrationKeyStorageKey)
      const restored = {
        ...sessionSnapshot,
        userId,
        deviceId,
        examSessionId: session.session_id,
        examSessionVersion: session.version,
        examSessionRevision: initialRevision,
        examSessionDirty: false,
      }
      saveActiveExam(restored, { allowProgressRollback: true }, persistenceScope)
      setRemoteSavedState(restored)
      setSavedEpoch((value) => value + 1)
      setRemotePersistenceError(null)
    })()
    remoteCreatePromiseRef.current = creation
    try {
      await creation
    } finally {
      if (remoteCreatePromiseRef.current === creation) remoteCreatePromiseRef.current = null
      setRemoteSessionCreating(false)
    }
  }

  function persistRemoteSnapshot(
    snapshot: SavedExamState,
    status: 'active' | 'paused' = 'active',
  ): Promise<void> {
    if (!REMOTE_EXAM_SESSION_BACKEND_ENABLED || !isSupabaseConfigured || !userId || !deviceId) {
      return Promise.resolve()
    }
    if (remoteWriteBlockedRef.current) {
      return Promise.reject(new Error('სერვერული სესია შეიცვალა სხვა აქტიურ ჩანაწერში; ავტომატური გადაწერა შეჩერებულია.'))
    }
    const writer = remoteWriterRef.current
    if (!writer || !snapshot.examSessionId) {
      const error = new Error('გამოცდის სესია სერვერზე ჯერ არ არის მიბმული.')
      setRemotePersistenceError(error.message)
      return Promise.reject(error)
    }
    const stored = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
    const revision = ++remoteWriteRevisionRef.current
    const pendingSnapshot: SavedExamState = {
      ...(stored?.examSessionId === snapshot.examSessionId ? stored : snapshot),
      ...(tabId ? { tabId } : {}),
      examSessionId: remoteSessionIdRef.current,
      examSessionRevision: revision,
      examSessionDirty: true,
    }
    saveActiveExam(pendingSnapshot, { allowProgressRollback: true }, persistenceScope)
    const requestSnapshot =
      loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope) ?? pendingSnapshot
    const remoteOnlyFields = new Set([
      'examSessionVersion',
      'examSessionRevision',
      'examSessionDirty',
    ])
    const remoteProgress = Object.fromEntries(
      Object.entries(requestSnapshot).filter(([key]) => !remoteOnlyFields.has(key)),
    )
    const progress = toJson(remoteProgress)
    const errors = toJson(requestSnapshot.exam.counts)
    return trackRemoteWrite(writer.save(status, progress, errors, requestSnapshot.elapsedMs)
      .then((session) => {
        const current = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
        const committed = applyRemoteExamSaveVersion(
          current,
          revision,
          session.version,
          requestSnapshot,
        )
        if (committed && committed !== current) {
          saveActiveExam(committed, { allowProgressRollback: true }, persistenceScope)
        }
        setRemotePersistenceError(null)
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'უცნობი შეცდომა'
        remoteWriteBlockedRef.current = true
        console.error('Remote exam session save failed:', error)
        setRemotePersistenceError(`სერვერზე გამოცდის პროგრესი ვერ შეინახა: ${detail}`)
        throw error
      }))
  }

  function persistActiveExamNow() {
    if (phaseRef.current !== 'active' || finishInProgressRef.current) return
    const liveElapsed = sessionStartRef.current
      ? Math.max(0, Date.now() - sessionStartRef.current)
      : elapsedMs
    const snapshot: SavedExamState = {
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'active',
      ...(userId ? { userId } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(tabId ? { tabId } : {}),
      ...(remoteSessionIdRef.current ? { examSessionId: remoteSessionIdRef.current } : {}),
      exam,
      userPos: currentPositionRef.current,
      heading,
      speedKmh,
      elapsedMs: liveElapsed,
      distanceMeters: distanceMetersRef.current,
      triggeredPins: Array.from(triggeredRef.current),
      startMode: sessionStartModeRef.current,
      pendingPinSortOrder: pendingPinSortOrderRef.current,
      queuedPinSortOrders: [...queuedAudioPinOrdersRef.current],
      ...chainagePersistenceFields(),
      driveView: loadDriveView(route.slug, persistenceScope) ?? driveViewRef.current,
      ...(FIELD_TEST_SLUGS.has(route.slug) ? fieldTestProgressFields() : {}),
      savedAt: Date.now(),
    }
    saveActiveExam(snapshot, {}, persistenceScope)
    void persistRemoteSnapshot(snapshot).catch(() => {})
  }

  function handleDriveViewChange(view: ExamDriveView) {
    setDriveView(view)
    driveViewRef.current = view
    saveDriveView(route.slug, view, persistenceScope)
    if (phaseRef.current !== 'active' && phaseRef.current !== 'summary') return
    const existing = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
    if (!existing) return
    saveActiveExam(
      { ...existing, driveView: view, savedAt: Date.now() },
      { allowProgressRollback: true },
      persistenceScope,
    )
  }

  /** True when Telavi field-test routes still have an unhandled PIN (mid-route stop). */
  function routeHasRemainingPins(): boolean {
    if (!FIELD_TEST_SLUGS.has(route.slug)) return false
    const pins = pinsRef.current
    if (pins.length === 0) return false
    const orders = handledOrdersRef.current ?? new Set<number>()
    return nextSortOrder(pins, orders).nextSortOrder !== null
  }

  async function finishSession() {
    if (finishInProgressRef.current) return
    audioSessionGenerationRef.current++
    finishInProgressRef.current = true
    finishRouteSlugRef.current = route.slug
    if (startAudioRetryTimerRef.current !== null) {
      clearTimeout(startAudioRetryTimerRef.current)
      startAudioRetryTimerRef.current = null
    }
    startAudioPendingRef.current = false
    if (audioRetryTimerRef.current !== null) {
      clearTimeout(audioRetryTimerRef.current)
      audioRetryTimerRef.current = null
    }
    if (audioQueueWatchdogRef.current !== null) {
      clearTimeout(audioQueueWatchdogRef.current)
      audioQueueWatchdogRef.current = null
    }
    audioAttemptInFlightRef.current = false
    setRouteComplete(false)
    const handledOrders = persistMostAdvancedPinProgress(getHandledPinOrders())
    if (FIELD_TEST_SLUGS.has(route.slug)) handledOrdersRef.current = handledOrders
    triggeredRef.current = pinIdsForOrders(pinsRef.current, handledOrders)
    const pausedElapsedMs = sessionStartRef.current
      ? Math.max(0, Date.now() - sessionStartRef.current)
      : elapsedMs
    const pausedAt = Date.now()
    const summary = {
      ...finishExamSession(exam),
      finishedAt: pausedAt,
      elapsedMs: pausedElapsedMs,
      passedPinOrders: [...handledOrders].sort((first, second) => first - second),
    }
    const handled = new Set(handledOrders)
    const fieldTest = FIELD_TEST_SLUGS.has(route.slug)
      ? (() => {
          const progress = nextSortOrder(pinsRef.current, handled)
          return {
            triggeredSortOrders: [...handled].sort((a, b) => a - b),
            lastPassedSortOrder: progress.lastPassedSortOrder,
            nextSortOrder: progress.nextSortOrder,
          }
        })()
      : {}
    const hasRemainingPins = routeHasRemainingPins()
    const pausedSnapshot: SavedExamState = {
      routeId: route.id,
      routeSlug: route.slug,
      routeName: route.name_ka,
      phase: 'summary',
      ...(userId ? { userId } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(tabId ? { tabId } : {}),
      ...(remoteSessionIdRef.current ? { examSessionId: remoteSessionIdRef.current } : {}),
      exam,
      userPos: currentPositionRef.current,
      heading,
      speedKmh,
      elapsedMs: pausedElapsedMs,
      // Session KM resets on finish; continue/start reseed from the live place.
      distanceMeters: 0,
      triggeredPins: Array.from(triggeredRef.current),
      startMode: sessionStartModeRef.current,
      pendingPinSortOrder: pendingPinSortOrderRef.current,
      queuedPinSortOrders: [...queuedAudioPinOrdersRef.current],
      driveView: driveViewRef.current,
      summary,
      summaryCanContinue: hasRemainingPins,
      ...fieldTest,
      savedAt: pausedAt,
    }
    saveActiveExam(pausedSnapshot, { allowProgressRollback: true }, persistenceScope)
    const persistedPause = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
    if (
      !persistedPause ||
      persistedPause.exam.startedAt !== exam.startedAt ||
      persistedPause.elapsedMs !== pausedElapsedMs ||
      persistedPause.exam.minorTotal !== exam.minorTotal ||
      persistedPause.exam.severeTotal !== exam.severeTotal
    ) {
      finishInProgressRef.current = false
      finishRouteSlugRef.current = null
      setResumeError('სესიის შენახვა ვერ მოხერხდა. სცადეთ ხელახლა; შენახული მონაცემები არ წაშლილა.')
      return
    }
    if (REMOTE_EXAM_SESSION_BACKEND_ENABLED && isSupabaseConfigured && userId && deviceId && tabId) {
      try {
        await persistRemoteSnapshot(persistedPause, 'paused')
      } catch {
        finishInProgressRef.current = false
        finishRouteSlugRef.current = null
        setResumeError('სერვერზე გამოცდის სესიის შენახვა ვერ მოხერხდა. პროგრესი ლოკალურად შენახულია; სცადეთ ხელახლა.')
        return
      }
    }
    setSummaryCanContinue(hasRemainingPins)
    setSummaryFinalized(false)
    setExamSummary(summary)
    setPhase('summary')
    routeOdometerRef.current.reset()
    distanceMetersRef.current = 0
    setDistanceMeters(0)
    // Full route done (same for 1/2/3/4): drop PIN progress so return/restart
    // cannot reopen the complete wall at 0.0 კმ (R3 loop end ≈ start).
    if (!hasRemainingPins && FIELD_TEST_SLUGS.has(route.slug)) {
      clearRoutePinProgress(route.slug, persistenceScope)
      clearManualPinSelection(route.slug, persistenceScope)
      handledOrdersRef.current = new Set()
      routeDistanceOriginMetersRef.current = 0
      setSavedEpoch((value) => value + 1)
    }
    releaseWake.current?.()
    audioEngine.stopAll()
    sessionStartRef.current = 0
    setElapsedMs(pausedElapsedMs)
    finishInProgressRef.current = false
    // გილოცავთ voice plays only when the examiner presses the გილოცავთ control — never on დასრულება.
    if (
      hasRemainingPins &&
      FIELD_TEST_SLUGS.has(route.slug) &&
      sessionStartModeRef.current === 'manual'
    ) {
      const resolution = resolvePinProgress(sortedPins, handledOrders)
      if (resolution.status === 'resume' && resolution.nextSortOrder !== null) {
        saveManualPinSelection(route.slug, resolution.nextSortOrder, persistenceScope)
      }
    }
  }

  async function finalizeSession() {
    if (!examSummary || summaryFinalized) return
    const saved = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
    if (REMOTE_EXAM_SESSION_BACKEND_ENABLED && isSupabaseConfigured && userId && deviceId && tabId) {
      try {
        if (!remoteWriterRef.current || !remoteSessionIdRef.current || !saved) {
          throw new Error('სერვერული გამოცდის სესია ვერ მოიძებნა.')
        }
        await trackRemoteWrite(remoteWriterRef.current.finish(
          toJson(saved),
          toJson(saved.exam.counts),
          saved.elapsedMs,
          toJson(examSummary),
        ))
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'უცნობი შეცდომა'
        console.error('Remote exam session finish failed:', error)
        setRemotePersistenceError(`გამოცდის სერვერზე დასრულება ვერ მოხერხდა: ${detail}`)
        return
      }
      void releaseExamTabLease({ userId, deviceId, tabId }).catch(() => {
        console.warn('Exam tab lease release could not be confirmed.')
      })
    }
    try {
      saveExamSummary(examSummary, persistenceScope)
    } catch (error) {
      console.error('Failed to save completed exam summary:', error)
      setResumeError('შედეგების შენახვა ვერ მოხერხდა. დასრულებული სესია შენახული დარჩა.')
      return
    }
    clearActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
    remoteSessionIdRef.current = null
    remoteWriterRef.current = null
    setSummaryCanContinue(false)
    setSummaryFinalized(true)
    setResumeError(null)
    setSavedEpoch((value) => value + 1)
  }

  function playCelebrateSuccess() {
    audioEngine.unlock()
    void audioEngine
      .playDetailed(
        EXAM_SUCCESS_AUDIO,
        `route-success-${route.slug}-${audioSessionGenerationRef.current}-${Date.now()}`,
        EXAM_SUCCESS_TEXT,
        {
          onFailure: (reason) => {
            console.warn('[AUDIO] Route success voice failed', route.slug, reason)
          },
        },
      )
      .catch((error) => {
        console.warn('[AUDIO] Route success voice threw', route.slug, error)
      })
  }

  function continueFromSummary() {
    audioEngine.unlock()
    const saved = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
    if (!saved) {
      setResumeError('შეჩერებული სესია ვერ მოიძებნა. შენახული პროგრესი უცვლელია.')
      return
    }
    // Leaving summary returns the persisted session to an active drive snapshot.
    if (saved.phase === 'summary') {
      saveActiveExam(
        {
          ...saved,
          phase: 'active',
          summary: undefined,
          summaryCanContinue: undefined,
          savedAt: Date.now(),
        },
        { allowProgressRollback: true },
        persistenceScope,
      )
    }
    const orders = FIELD_TEST_SLUGS.has(route.slug)
      ? restoredHandledOrders(saved, sortedPins, route.slug, persistenceScope) ??
        new Set(loadRoutePinProgress(route.slug, persistenceScope) ?? [])
      : null
    const restoredIds = orders
      ? pinIdsForOrders(sortedPins, orders)
      : new Set(saved.triggeredPins)
    const restoredAudio = restoreAudioQueue(
      sortedPins,
      saved.pendingPinSortOrder,
      saved.queuedPinSortOrders,
    )
    finishInProgressRef.current = true
    finishRouteSlugRef.current = null
    audioSessionGenerationRef.current++
    audioEngine.stopAll()
    setAudioPlaybackError(null)
    queuedAudioPinOrdersRef.current = restoredAudio.queued
    setPendingPinSortOrder(restoredAudio.pending)
    setSummaryCanContinue(false)
    setSummaryFinalized(false)
    setExamSummary(null)
    setExam(saved.exam)
    triggeredRef.current = restoredIds
    pinApproachRef.current = new Map()
    routeMatchStateRef.current = null
    arrowChainageRef.current = null
    if (FIELD_TEST_SLUGS.has(route.slug)) handledOrdersRef.current = orders
    sessionStartModeRef.current = saved.startMode ?? 'manual'
    currentPositionRef.current = saved.userPos
    setUserPos(saved.userPos)
    setHeading(saved.heading)
    setSpeedKmh(saved.speedKmh)
    const pausedElapsedMs = Math.max(0, saved.elapsedMs)
    setElapsedMs(pausedElapsedMs)
    sessionStartRef.current = Date.now() - pausedElapsedMs
    {
      const nextOrder =
        sortedPins.find((pin) => !restoredIds.has(pin.id))?.sort_order ??
        sortedPins.at(-1)?.sort_order ??
        1
      const hasSavedDistance =
        typeof saved.distanceMeters === 'number' &&
        Number.isFinite(saved.distanceMeters) &&
        saved.distanceMeters > 0
      const restoredDistance =
        nextOrder <= 1
          ? 0
          : hasSavedDistance
            ? saved.distanceMeters
            : seedLiveDistanceMeters(nextOrder, saved.userPos)
      routeDistanceOriginMetersRef.current =
        route.slug === 'route-1' && nextOrder > 1
          ? route1StartPinChainageMeters()
          : 0
      if (route.slug === 'route-1' && nextOrder === 1 && routeGeometryRef.current) {
        applyRouteChainageMeters(0, {
          syncMatchState: true,
          timestampMs: Date.now(),
        })
      } else {
        const restoredChainage =
          route.slug === 'route-1' && hasSavedDistance
            ? restoredDistance + routeDistanceOriginMetersRef.current
            : restoredDistance
        applyRouteChainageMeters(restoredChainage, {
          syncMatchState: true,
          timestampMs: Date.now(),
        })
      }
    }
    let next =
      sortedPins.find((pin) => !restoredIds.has(pin.id)) ?? null
    if (
      (saved.startMode ?? 'manual') === 'automatic' &&
      saved.userPos &&
      FIELD_TEST_SLUGS.has(route.slug)
    ) {
      const floor = orders ?? new Set<number>()
      const gpsPin = resolveAutoStart(
        sortedPins,
        floor,
        saved.userPos,
        autoStartPolyline,
        route.slug as 'route-1' | 'route-2' | 'route-3' | 'route-4',
      ).pin
      if (gpsPin && (!next || gpsPin.sort_order > next.sort_order)) {
        const advanced = new Set(
          sortedPins
            .filter((pin) => pin.sort_order < gpsPin.sort_order)
            .map((pin) => pin.sort_order),
        )
        const snapped = persistMostAdvancedPinProgress(advanced)
        handledOrdersRef.current = snapped
        triggeredRef.current = pinIdsForOrders(sortedPins, snapped)
        next = gpsPin
      }
    }
    setNextPin(next)
    setRouteComplete(false)
    setLastSpoken(null)
    resumedSlugRef.current = route.slug
    resumePendingRef.current = false
    resumeBlockedRef.current = false
    setResumeError(null)
    setPhase('active')
    finishInProgressRef.current = false
    setSavedEpoch((v) => v + 1)
  }

  async function restartPreview() {
    if (remoteWriterRef.current && remoteSessionIdRef.current) {
      try {
        await trackRemoteWrite(remoteWriterRef.current.abandon())
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'უცნობი შეცდომა'
        console.error('Remote exam session abandon failed:', error)
        setRemotePersistenceError(`გამოცდის სერვერულად გაუქმება ვერ მოხერხდა: ${detail}`)
        return
      }
    }
    remoteSessionIdRef.current = null
    remoteWriterRef.current = null
    setRemoteSavedState(null)
    setRemotePersistenceError(null)
    const handled = new Set<number>()
    // თავიდან დაწყება clears progress; next Auto start uses live GPS (never stuck behind).
    gpsAutoStartBlockedRef.current = false
    automaticFinishStartedRef.current = false
    startAudioPendingRef.current = false
    setAudioPlaybackError(null)
    if (startAudioRetryTimerRef.current !== null) {
      clearTimeout(startAudioRetryTimerRef.current)
      startAudioRetryTimerRef.current = null
    }
    clearRoutePinProgress(route.slug, persistenceScope)
    clearManualPinSelection(route.slug, persistenceScope)
    queuedAudioPinOrdersRef.current = []
    finishInProgressRef.current = true
    finishRouteSlugRef.current = null
    setPhase('preview')
    setResumeError(null)
    resumeBlockedRef.current = false
    setRawPos(null)
    setUserPos(null)
    currentPositionRef.current = null
    setGpsStarted(false)
    setPreviewSelectionMode('automatic')
    setPreviewPinSelection(
      sortedPins[0] ? { routeId: route.id, sortOrder: sortedPins[0].sort_order } : null,
    )
    setExamSummary(null)
    setSummaryCanContinue(false)
    setSummaryFinalized(false)
    setExam(createExamSession(route.id, route.name_ka))
    triggeredRef.current = pinIdsForOrders(sortedPins, handled)
    pinApproachRef.current = new Map()
    routeMatchStateRef.current = null
    arrowChainageRef.current = null
    seedHintChainageRef.current = null
    setPendingPinSortOrder(null)
    if (FIELD_TEST_SLUGS.has(route.slug)) handledOrdersRef.current = handled
    resumedSlugRef.current = null
    resumePendingRef.current = false
    setRouteComplete(false)
    setNextPin(sortedPins.find((pin) => !triggeredRef.current.has(pin.id)) ?? null)
    setLastSpoken(null)
    setElapsedMs(0)
    sessionStartRef.current = 0
    routeOdometerRef.current.reset()
    distanceMetersRef.current = 0
    routeDistanceOriginMetersRef.current = 0
    setDistanceMeters(0)
    clearActiveExam(route.id, route.slug, route.name_ka, persistenceScope) // Clear this route's saved state when restarting
    setSavedEpoch((v) => v + 1)
  }

  const previewDemoActionsRef = useRef<PreviewDemoControls | null>(null)
  previewDemoActionsRef.current = {
    startAtPin: (sortOrder, options) => handleStartSession(sortOrder, options),
    reset: restartPreview,
    nextPinOrder: () => nextPinRef.current?.sort_order ?? null,
    isActive: () => phaseRef.current === 'active',
    manualStartPinOrder: () =>
      previewSelectionMode === 'manual' &&
      previewPinSelection?.routeId === route.id &&
      !completedPreviewOrders.has(previewPinSelection.sortOrder)
        ? previewPinSelection.sortOrder
        : null,
  }
  const previewDemoControlsRef = useRef<PreviewDemoControls | null>(null)
  if (previewDemoControlsRef.current === null) {
    const currentActions = () => {
      if (!previewDemoActionsRef.current) {
        throw new Error('Preview DEMO controls are not ready')
      }
      return previewDemoActionsRef.current
    }
    previewDemoControlsRef.current = {
      startAtPin: (sortOrder, options) => currentActions().startAtPin(sortOrder, options),
      reset: () => currentActions().reset(),
      nextPinOrder: () => currentActions().nextPinOrder(),
      isActive: () => currentActions().isActive(),
      manualStartPinOrder: () => currentActions().manualStartPinOrder(),
    }
  }

  useEffect(() => {
    if (!onPreviewDemoControls) return
    onPreviewDemoControls(previewDemoControlsRef.current)
    return () => onPreviewDemoControls(null)
  }, [onPreviewDemoControls])

  const nextPinDistanceLabel =
    active && pinsActive && nextPin && userPos && showVoiceInToolbar
      ? (() => {
          const meters = Math.round(distanceToPinMeters(userPos, [nextPin.lat, nextPin.lng]))
          return meters <= 9999 ? `${meters} მ` : '—'
        })()
      : null

  const sessionLayout = mapOnly ? 'nav-only' : features.canSwitchViews ? 'switchable' : 'panel-only'
  // Display-only: an inaccurate/rejected fix never moves the map arrow off the road.
  const mapCenter: LatLng | null =
    mapVehiclePos ?? userPos ?? polyline[0] ?? ([TELAVI_CENTER.lat, TELAVI_CENTER.lng] as LatLng)
  const shouldRenderMap = Boolean(showMapView && mapCenter)
  const mapConditions = {
    showMapView,
    hasUserPos: !!userPos,
    hasPolyline: !!polyline[0],
    shouldRenderMap,
  }

  return (
    <>
    {remoteSessionLoading && userId && (
      <p role="status" className="session-hint">სერვერული გამოცდის სესია იტვირთება...</p>
    )}
    {remotePersistenceError && userId && (
      <div role="alert" data-testid="exam-session-persistence-error" className="error-text">
        <p>{remotePersistenceError}</p>
        <button
          type="button"
          className="nav-start-btn"
          disabled={remoteSessionLoading || remoteSessionCreating}
          onClick={() => {
            setRemoteSessionLoading(true)
            setRemoteRetryToken((value) => value + 1)
          }}
        >
          ხელახლა ცდა
        </button>
      </div>
    )}
    <div
      className={`exam-session exam-session--${layoutMode} exam-session--${sessionLayout}${active ? ' exam-session--active' : ''}${summaryOpen ? ' exam-session--summary' : ''}${active && debugPanelEnabled ? ' exam-session--sl-debug' : ''}`}
    >
      {active && audioPlaybackError && (
        <div className="exam-audio-hold-banner" role="alert" data-testid="audio-playback-error">
          <p className="exam-audio-hold-banner__text">
            <strong>PIN {audioPlaybackError.sortOrder}</strong>
            <span>{audioPlaybackError.message}</span>
          </p>
          <div className="exam-audio-hold-banner__actions">
            <button
              type="button"
              className="nav-start-btn exam-audio-hold-banner__retry"
              onClick={() => {
                audioEngine.unlock()
                audioAttemptInFlightRef.current = false
                audioWaitingForUserRef.current = false
                setAudioPlaybackError(null)
                setAudioRetryToken((token) => token + 1)
              }}
            >
              აუდიოს ხელახლა ცდა
            </button>
            <button
              type="button"
              className="nav-start-btn exam-audio-hold-banner__continue"
              onClick={() => {
                audioEngine.unlock()
                const continuePin = continueFailedAudioPinRef.current
                continueFailedAudioPinRef.current = null
                audioWaitingForUserRef.current = false
                setAudioPlaybackError(null)
                continuePin?.()
              }}
            >
              პინის გაგრძელება
            </button>
          </div>
        </div>
      )}
      {onRouteMapScreen && (
        <>
          {active && (
            <>
              <div className={`exam-topbar${showErrorsInToolbar ? ' exam-topbar--panel' : ''}`}>
                <ExamScoreboard
                  elapsedMs={elapsedMs}
                  speedKmh={speedKmh}
                  speedLimitKmh={speedLimitKmh}
                  minorTotal={exam.minorTotal}
                  severeTotal={exam.severeTotal}
                  onRecordSevere={handleSevereQuick}
                  showErrors={showErrorsInToolbar}
                  compact={mapOnly}
                />

                {showVoiceInToolbar && (
                  <div className="exam-voice-bar exam-voice-bar--toolbar">
                    {nextPinDistanceLabel && nextPin && (
                      <p className="exam-voice-next">
                        <small>შემდეგი · PIN {nextPin.sort_order} · {nextPinDistanceLabel}</small>
                        <strong>
                          {formatPinInstructionLabel(nextPin.sort_order, nextPin.instruction_ka)}
                        </strong>
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

                {features.canSwitchViews && (
                  <ExamViewSwitcher view={driveView} onChange={handleDriveViewChange} />
                )}

                {!routeComplete && (
                  <button type="button" className="exam-finish-fab" onClick={finishSession}>
                    დასრულება
                  </button>
                )}
              </div>

              {routeComplete && FIELD_TEST_SLUGS.has(route.slug) && (
                <div
                  role="status"
                  data-testid="route-complete"
                  className="exam-route-complete"
                >
                  <p className="exam-route-complete__message">
                    მარშრუტი დასრულებულია — ყველა PIN გავლილია.
                  </p>
                  <button
                    type="button"
                    className="exam-route-complete__finish"
                    onClick={() => {
                      // Same as routes 1/2/4 preview complete: clear progress so
                      // 0.0 კმ + „ყველა PIN გავლილია“ cannot stick (esp. R3 loop).
                      // დასრულება never plays გილოცავთ.
                      void restartPreview()
                    }}
                  >
                    დასრულება
                  </button>
                  <button
                    type="button"
                    className="nav-start-btn"
                    data-testid="route-complete-celebrate"
                    onClick={playCelebrateSuccess}
                  >
                    გილოცავთ
                  </button>
                </div>
              )}

              {resumeError && FIELD_TEST_SLUGS.has(route.slug) && (
                <div role="alert" data-testid="resume-error" className="error-text">
                  <p>{resumeError}</p>
                  <button type="button" className="nav-start-btn" onClick={restartPreview}>
                    თავიდან დაწყება
                  </button>
                </div>
              )}

              {debugPanelEnabled && (
                <SpeedLimitDebugPanel
                  routeSlug={route.slug}
                  routeId={route.id}
                  gpsStarted={gpsStarted}
                  gpsError={gpsError}
                  rawPos={rawPos}
                  userPos={userPos}
                  road={speedLimitRoad}
                  roadU={speedRoadU}
                  speedLimitKmh={speedLimitKmh}
                  rejection={gpsRejection}
                />
              )}
            </>
          )}

          <div className="exam-drive-main">
            {shouldRenderMap && mapCenter && (
              <ExamLiveMap
                route={route}
                userPos={mapCenter}
                heading={heading}
                nextPin={summaryOpen ? null : nextPin}
                hasGpsFix={userPos !== null}
                offlineMaps={offlineMaps}
                vehicleMotion={mapVehicleMotion}
              />
            )}
            {shouldRenderMap && active && (
              <div className="exam-navigation-dock" aria-label="გავლილი მანძილი და დრო">
                <div className="exam-navigation-dock__metric" data-testid="live-distance">
                  <small>გავლილი მანძილი</small>
                  <strong>
                    {traveledKmLabel}
                    <span className="exam-navigation-dock__total"> / {routeLengthKmLabel} კმ</span>
                  </strong>
                </div>
                <div
                  className="exam-navigation-dock__progress"
                  data-testid="live-distance-progress"
                  role="progressbar"
                  aria-label={`მარშრუტის პროგრესი ${routeLengthKmLabel} კმ-დან`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(distanceProgressPct)}
                >
                  <span
                    className="exam-navigation-dock__progress-fill"
                    style={{ width: `${distanceProgressPct}%` }}
                  />
                </div>
                <div className="exam-navigation-dock__metric" data-testid="live-elapsed">
                  <small>დრო</small>
                  <strong>{formatExamDuration(elapsedMs)}</strong>
                </div>
              </div>
            )}
            {showPanelView && <ExamErrorGrid counts={exam.counts} onError={handleError} />}
          </div>
        </>
      )}

      {phase === 'preview' && !savedState && (
        <div className="exam-preview">
          <RoutePreviewMap
            route={route}
            offlineMaps={offlineMaps}
            // Demo page only (it is the only caller with a simulated GPS source):
            // same turquoise route line and golden PINs as the live navigation map.
            navigationStyle={Boolean(previewGpsSource)}
            selectedPinOrder={
              previewSelectionMode === 'manual'
                ? previewPin?.sort_order ?? null
                : autoStartPin?.sort_order ?? null
            }
            onPinSelect={
              previewSelectionMode === 'manual'
                ? (sortOrder) => selectManualPin(sortOrder)
                : undefined
            }
          />
          <div className="exam-preview__panel">
            {previewProgress.status === 'error' && (
              <div role="alert" data-testid="resume-error" className="error-text">
                <p>{previewProgress.message}</p>
                <button type="button" className="nav-start-btn" onClick={restartPreview}>
                  თავიდან დაწყება
                </button>
              </div>
            )}
            {previewProgress.status !== 'error' && resumeError && (
              <div role="alert" data-testid="resume-error" className="error-text">
                <p>{resumeError}</p>
              </div>
            )}
            {previewRouteComplete && (
              <div role="status" data-testid="route-complete" className="exam-route-complete">
                <p className="exam-route-complete__message">
                  მარშრუტი დასრულებულია — ყველა PIN გავლილია.
                </p>
                <button
                  type="button"
                  className="exam-route-complete__finish"
                  onClick={() => {
                    // Preview has no live session — clear progress so menu/start is fresh.
                    // დასრულება never plays გილოცავთ.
                    restartPreview()
                  }}
                >
                  დასრულება
                </button>
                <button
                  type="button"
                  className="nav-start-btn"
                  data-testid="route-complete-celebrate"
                  onClick={playCelebrateSuccess}
                >
                  გილოცავთ
                </button>
              </div>
            )}
            {!previewRouteComplete && previewProgress.status === 'resume' && (
              <div
                className="exam-preview__mode-controls"
                role="group"
                aria-label="PIN-ის არჩევის რეჟიმი"
                data-testid="exam-pin-selection-controls"
              >
                <button
                  type="button"
                  className={`exam-preview__mode-button${previewSelectionMode === 'automatic' ? ' is-active' : ''}`}
                  aria-pressed={previewSelectionMode === 'automatic'}
                  onClick={() => {
                    setPreviewSelectionMode('automatic')
                    setPreviewPinSelection(null)
                    clearManualPinSelection(route.slug, persistenceScope)
                  }}
                >
                  PIN-ის არჩევა ავტომატურად
                </button>
                <button
                  type="button"
                  className={`exam-preview__mode-button${previewSelectionMode === 'manual' ? ' is-active' : ''}`}
                  aria-pressed={previewSelectionMode === 'manual'}
                  onClick={() => {
                    setPreviewSelectionMode('manual')
                    if (previewPin) selectManualPin(previewPin.sort_order)
                  }}
                >
                  PIN-ის არჩევა ხელით
                </button>
              </div>
            )}
            {previewPin && previewSelectionMode === 'manual' && (
              <div className="exam-preview__pin-picker">
                <label htmlFor="exam-preview-pin">აირჩიეთ PIN</label>
                <select
                  id="exam-preview-pin"
                  aria-label="PIN-ების არჩევა"
                  value={previewPin.sort_order}
                  onChange={(event) => selectManualPin(Number(event.currentTarget.value))}
                >
                  {sortedPins.map((pin) => (
                    <option key={pin.id} value={pin.sort_order}>
                      PIN {pin.sort_order} — {pin.instruction_ka}
                    </option>
                  ))}
                </select>
                <p data-testid="selected-preview-pin">
                  <strong>
                    {formatPinInstructionLabel(previewPin.sort_order, previewPin.instruction_ka)}
                  </strong>
                </p>
              </div>
            )}
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
            {!previewRouteComplete && (
              <button
                type="button"
                className="nav-start-btn"
                onClick={() => void handleStartSession()}
                disabled={
                  gpsStarting ||
                  remoteSessionLoading ||
                  remoteSessionCreating ||
                  Boolean(remotePersistenceError) ||
                  previewProgress.status !== 'resume' ||
                  Boolean(resumeError)
                }
              >
                {gpsStarting ? 'GPS იტვირთება...' : savedState ? '▶ გაგრძელება' : '▶ გამოცდის დაწყება'}
              </button>
            )}
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
          onFinish={finalizeSession}
          onContinue={summaryCanContinue ? continueFromSummary : undefined}
          onCelebrate={
            !summaryCanContinue && !isExamFailed(exam) ? playCelebrateSuccess : undefined
          }
          onReturnToMenu={
            onReturnToMenu
              ? () => {
                  // Menu leave must clear completed PIN progress — same as თავიდან —
                  // otherwise DEMO return reopens "ყველა PIN გავლილია" at 0.0 კმ.
                  void restartPreview().then(() => onReturnToMenu())
                }
              : undefined
          }
          finalized={summaryFinalized}
          error={resumeError}
        />
      )}
      
      {/* DEBUG PANEL - Session diagnostic */}
      {debugPanelEnabled && debugSessionVisible && (
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
            <div><strong>userPos:</strong> {userPos && Number.isFinite(userPos[0]) && Number.isFinite(userPos[1]) ? `✅ [${userPos[0].toFixed(4)}, ${userPos[1].toFixed(4)}]` : '❌'}</div>
            
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
