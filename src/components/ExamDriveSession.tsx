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
  reconcileRemoteExamProgress,
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
import { isRouteFinishGpsReady, isStartAudioAllowed } from '@/data/route-finish'
import { createSpeedTracker, gpsToLatLng, resolveExamSpeedKmh, resolveHeading } from '@/lib/route-nav'
import { createGpsFilter, type GpsReading } from '@/lib/gps-filter'
import { resolveAutoStart } from '@/lib/auto-start-pin'
import {
  evaluatePinRouteCompletion,
  matchGpsPosition,
  prepareRouteGeometry,
  projectOrderedPointsToRoute,
  projectPointToRoute,
  type ActiveRouteId,
  type RouteMatchState,
} from '@/lib/pure-route-geometry'
import {
  clearManualPinSelection,
  loadManualPinSelection,
  saveManualPinSelection,
} from '@/lib/manual-pin-selection'
import { examRoadTrace } from '@/lib/pin-route-line'
import {
  AUDIO_HEADING_TOLERANCE_DEG,
  audioHeadingOk,
  identifyRoundaboutGateTarget,
  pinAudioApproachWindowMeters,
  pinAudioTriggerDistanceMeters,
  updateRoundaboutReturnGate,
  isRoundaboutReturnGateOpened,
  type RoundaboutReturnGateState,
  type RoundaboutPinRoute,
} from '@/lib/pin-audio'
import { advanceRoadProgressU, resolveSpeedLimit } from '@/lib/speed-limit'
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

type Phase = 'preview' | 'active' | 'summary'

/** Sort-order resume for Telavi exam routes and the local Tbilisi GPS test city. */
const FIELD_TEST_SLUGS = new Set(['route-1', 'route-2', 'route-3', 'route-4'])
const AUDIO_RETRY_BASE_MS = 500
const AUDIO_RETRY_MAX_MS = 4000
const AUDIO_QUEUE_WATCHDOG_MS = 13_000
const SPEED_LIMIT_FIX_STALE_MS = 20_000

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
let examVoiceVolume = 1

// Per-GPS-fix diagnostics are development-only (production keeps console quiet).
const devLog: typeof console.log = (...args) => {
  if (import.meta.env.DEV) console.log(...args)
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

export type PreviewDemoControls = {
  startAtPin: (sortOrder: number) => Promise<void>
  reset: () => void
  nextPinOrder: () => number | null
  isActive: () => boolean
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
  const remoteLoadKeyRef = useRef<string | null>(null)
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
  const [phase, setPhase] = useState<Phase>(savedState ? 'active' : 'preview')
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
    setPreviewPinSelection({ routeId: route.id, sortOrder })
    saveManualPinSelection(route.slug, sortOrder, persistenceScope)
  }
  // Same-render sync: slug match after local→UUID must not paint preview+saved (empty map).
  if (savedState && phase === 'preview') {
    setPhase('active')
  }
  const [driveView, setDriveView] = useState<ExamDriveView>('map')
  const [exam, setExam] = useState(() =>
    savedState ? savedState.exam : createExamSession(route.id, route.name_ka),
  )
  const [examSummary, setExamSummary] = useState<ExamSessionSummary | null>(null)
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
  const [speedLimitFixSlug, setSpeedLimitFixSlug] = useState<string | null>(null)
  const speedLimitFixTimerRef = useRef<number | null>(null)
  /** Along-road u on examRoadTrace for speed zones (monotonic; optional for resolver). */
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
  const [voiceVolume, setVoiceVolume] = useState(examVoiceVolume)
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
  const [resumeError, setResumeError] = useState<string | null>(null)
  const [pendingPinSortOrder, setPendingPinSortOrderState] = useState<number | null>(initialAudioQueue.pending)
  /** After mid-route დასრულება, summary offers გაგრძელება using kept localStorage progress. */
  const [summaryCanContinue, setSummaryCanContinue] = useState(false)
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
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

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

    const loadKey = `${userId}:${deviceId}:${tabId}:${route.slug}`
    if (remoteLoadKeyRef.current === loadKey) return
    remoteLoadKeyRef.current = loadKey
    remoteWriterRef.current = null
    remoteSessionIdRef.current = null
    remoteWriteBlockedRef.current = false
    setRemoteSavedState(null)
    let cancelled = false
    setRemoteSessionLoading(true)
    setRemotePersistenceError(null)

    void (async () => {
      const tabIdentity = { userId, deviceId, tabId }
      const local = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
      let remote = local?.examSessionId
        ? await getRemoteExamSession(local.examSessionId, tabIdentity)
        : null
      if (!local?.examSessionId) {
        const candidates = (await listRemoteExamSessions(tabIdentity))
          .filter((item) => item.route_slug === route.slug)
        remote = candidates
          .sort((first, second) => Date.parse(second.updated_at) - Date.parse(first.updated_at))[0] ?? null
      }

      if (local?.examSessionId && !remote) {
        throw new Error('ამ მოწყობილობის შენახული გამოცდის სესია სერვერზე აღარ არსებობს.')
      }
      if (cancelled || !remote) return
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
    })()
      .catch((error: unknown) => {
        if (cancelled) return
        const detail = error instanceof Error ? error.message : 'უცნობი შეცდომა'
        console.error('Remote exam session restore failed:', error)
        setRemotePersistenceError(`სერვერული გამოცდის სესია ვერ აღდგა: ${detail}`)
      })
      .finally(() => {
        if (!cancelled) setRemoteSessionLoading(false)
      })

    return () => {
      cancelled = true
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
    remoteRestoreToken,
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
  const routeMatchStateRef = useRef<RouteMatchState | null>(null)
  const gpsAutoStartBlockedRef = useRef(false)
  const roundaboutGateRef = useRef<RoundaboutReturnGateState | null>(null)

  const setPendingPinSortOrder = useCallback((sortOrder: number | null) => {
    pendingPinSortOrderRef.current = sortOrder
    setPendingPinSortOrderState(sortOrder)
  }, [])

  const polyline = route.polyline as LatLng[]
  const routeGeometry = useMemo(() => {
    if (!FIELD_TEST_SLUGS.has(route.slug)) return null
    try {
      const streetTrace = examRoadTrace(route.slug, route.pins)
      return prepareRouteGeometry(route.slug as ActiveRouteId, streetTrace ?? polyline)
    } catch (error) {
      console.error('Failed to prepare route geometry:', route.slug, error)
      return null
    }
  }, [route.slug, route.pins, polyline])
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
  const completedPreviewOrders = mostAdvancedPinProgress(
    sortedPins,
    initialRoutePinProgress,
    savedState ? savedProgressOrders : null,
  )
  const pinsActive = voicePins.length > 0
  // Posted limit comes from the vehicle's real position on the route's road line (not from PIN proximity).
  // null (shown as "—") whenever the position is not inside a known zone.
  // roadU disambiguates Route 4 (and any route) where the same street is driven more than once.
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
  // Automatic start: see resolveAutoStart. Read progress fresh from storage so a finished/restarted
  // route never reuses progress from mount time.
  const previewProgress = initialProgressIsUnreadable
    ? { status: 'error' as const, message: RESUME_UNRESOLVED_MESSAGE }
    : resolvePinProgress(sortedPins, initialRoutePinProgress)
  const positionForAutoStart = savedState?.phase === 'active' ? (savedState.userPos ?? userPos) : null
  const autoStartPin = initialProgressIsUnreadable
    ? null
    : resolveAutoStart(
        sortedPins,
        new Set(initialRoutePinProgress),
        positionForAutoStart,
        route.polyline as LatLng[],
        route.slug as 'route-1' | 'route-2' | 'route-3' | 'route-4',
      ).pin
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
  const speedLimitKmh = useMemo(
    () =>
      speedLimitFixSlug === route.slug
        ? resolveSpeedLimit(route.slug, userPos, speedLimitRoad, speedRoadU)
        : null,
    [route.slug, userPos, speedLimitRoad, speedRoadU, speedLimitFixSlug],
  )

  const clearSpeedLimitFixFreshness = useCallback(() => {
    if (speedLimitFixTimerRef.current !== null) {
      window.clearTimeout(speedLimitFixTimerRef.current)
      speedLimitFixTimerRef.current = null
    }
    setSpeedLimitFixSlug(null)
  }, [])

  const markSpeedLimitFixFresh = useCallback(() => {
    if (speedLimitFixTimerRef.current !== null) {
      window.clearTimeout(speedLimitFixTimerRef.current)
    }
    setSpeedLimitFixSlug(route.slug)
    speedLimitFixTimerRef.current = window.setTimeout(() => {
      speedLimitFixTimerRef.current = null
      setSpeedLimitFixSlug(null)
    }, SPEED_LIMIT_FIX_STALE_MS)
  }, [route.slug])

  useEffect(() => {
    speedRoadURef.current = null
    setSpeedRoadU(null)
  }, [route.slug, speedLimitRoad])

  useEffect(() => {
    setSpeedLimitFixSlug(null)
    if (speedLimitFixTimerRef.current !== null) {
      window.clearTimeout(speedLimitFixTimerRef.current)
      speedLimitFixTimerRef.current = null
    }
    return () => {
      if (speedLimitFixTimerRef.current !== null) {
        window.clearTimeout(speedLimitFixTimerRef.current)
        speedLimitFixTimerRef.current = null
      }
    }
  }, [route.slug])

  const updateSpeedRoadProgress = useCallback((pos: LatLng | null, reset = false) => {
    const road = speedLimitRoadRef.current
    if (!pos || !road || road.length < 2) {
      speedRoadURef.current = null
      setSpeedRoadU(null)
      return
    }
    const prev = reset ? null : speedRoadURef.current
    const next = advanceRoadProgressU(pos, road, prev)
    speedRoadURef.current = next
    setSpeedRoadU(next)
  }, [])

  const active = phase === 'active'
  const layoutMode = useExamLayoutMode()

  const mapOnly = features.mapNav && !features.errorPanel
  const panelOnly = features.errorPanel && !features.mapNav
  const showMapView = active && features.mapNav && driveView === 'map'
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
        sessionStartRef.current = examSessionOriginMs(saved)
        setExam(saved.exam)
        setExamSummary(null)
        currentPositionRef.current = saved.userPos
        setUserPos(saved.userPos)
        updateSpeedRoadProgress(saved.userPos, true)
        setHeading(saved.heading)
        setSpeedKmh(saved.speedKmh)
        setElapsedMs(examElapsedMsNow(saved))
        setGpsStarted(true)
        setDriveView(features.mapNav ? 'map' : 'panel')
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
                polyline,
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
            }
            setNextPin(null)
            setRouteComplete(false)
          }
        }
        console.log('🔄 Resuming saved exam session', route.slug)
      }
      setPhase('active')
      return
    }

    // Slug says a session exists; local id may not have matched yet. Do not reset to preview.
    if (hasSavedExamForSlug(route.slug, route.name_ka, persistenceScope)) {
      setPhase('active')
      setDriveView(features.mapNav ? 'map' : 'panel')
      return
    }

    resumedSlugRef.current = null
    resumeBlockedRef.current = false
    sessionStartRef.current = 0
    setExam(createExamSession(route.id, route.name_ka))
    setExamSummary(null)
    setPhase('preview')
    setDriveView(features.mapNav ? 'map' : 'panel')
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
      setRawPos(pos)
      currentPositionRef.current = raw
      setUserPos(raw)
      markSpeedLimitFixFresh()
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
  }, [polyline, previewGpsSource, markSpeedLimitFixFresh, updateSpeedRoadProgress])

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

  // Auto-save exam state every 5 seconds when active; also persist on unmount (Home/leave).
  useEffect(() => {
    if (phase !== 'active') return
    if (finishInProgressRef.current) return // Skip saving if finish is in progress

    saveOwnerRef.current = ++examSaveOwner
    const saveState = (allowProgressRollback = false) => {
      if (finishInProgressRef.current) return // Guard against saving during finish
      if (saveOwnerRef.current !== examSaveOwner) return // a newer session already owns storage
      if (audioRouteSlugRef.current !== route.slug) return // never let an old route overwrite the new route's queue
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
          exam,
          userPos: currentPositionRef.current,
          heading,
          speedKmh,
          elapsedMs: liveElapsed,
          triggeredPins: Array.from(triggeredRef.current),
          pendingPinSortOrder: pendingPinSortOrderRef.current,
          queuedPinSortOrders: [...queuedAudioPinOrdersRef.current],
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
    exam,
    userPos,
    heading,
    speedKmh,
    elapsedMs,
    sortedPins,
  ])

  useEffect(() => {
    if (!gpsStarted) return
    const subscribe = previewGpsSource
      ? previewGpsSource.watchPosition.bind(previewGpsSource)
      : watchGps
    return subscribe(
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
        markSpeedLimitFixFresh()
        currentPositionRef.current = raw
        updateSpeedRoadProgress(raw)
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

        if (phase !== 'active' || !features.routeAudio || finishInProgressRef.current) return

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
        const usesOrderedRouteContext = route.slug === 'route-3'
        const usesRoute2Pin26Context =
          route.slug === 'route-2' && pending?.sort_order === 26
        const usesRouteContextTarget =
          (route.slug === 'route-1' && pending?.sort_order === 32) ||
          (route.slug === 'route-3' && pending?.sort_order === 29) ||
          (route.slug === 'route-4' && pending?.sort_order === 29)
        const orderedPendingProjection = pending
          ? projectOrderedPointsToRoute(
            routeGeometry,
            voicePins
              .filter((pin) => pin.sort_order <= pending.sort_order)
              .sort((first, second) => first.sort_order - second.sort_order)
              .map((pin) => [pin.lat, pin.lng] as const),
          )
          : null
        const usesOrderedPendingContext =
          usesOrderedRouteContext || usesRouteContextTarget
        const usesTargetOccurrenceContext =
          usesRoute2Pin26Context || usesRouteContextTarget
        const pendingRouteProjection = pending && usesTargetOccurrenceContext
          ? projectPointToRoute(routeGeometry, [pending.lat, pending.lng])
          : pending && usesOrderedPendingContext
            ? orderedPendingProjection
            : null
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
                )
            : null
          const contextProjection = contextPin
            ? startsAtFirstPin
              ? projectPointToRoute(routeGeometry, routeStart)
            : usesOrderedPendingContext || usesRoute2Pin26Context
                ? orderedContextProjection
                : projectPointToRoute(routeGeometry, [contextPin.lat, contextPin.lng])
            : null
          if (contextProjection && contextProjection.crossTrackMeters <= 20) {
            expectedChainageMeters = contextProjection.chainageMeters
            if (contextPin === pending && !usesRoute2Pin26Context) {
              expectedPinChainageMeters = contextProjection.chainageMeters
            }
          }
        }
        const routeMatch = matchGpsPosition(
          routeGeometry,
          {
            position: raw,
            accuracyMeters: pos.accuracy,
            timestampMs: pos.timestamp,
            headingDegrees: pos.heading,
          },
          previousRouteMatch,
          {
            nowMs: Date.now(),
            maxGpsAgeMs: 15_000,
            maxAccuracyMeters: 12,
            maxCrossTrackMeters: 20,
            maxSpeedMetersPerSecond: 55,
            stationaryThresholdMeters: 2,
            ambiguityToleranceMeters: 5,
            ambiguitySeparationMeters: 100,
            expectedChainageMeters,
            expectedForwardChainageMeters: pendingRouteProjection?.chainageMeters,
          },
        )

        devLog('[ROUTE MATCH]',
          route.slug.toUpperCase(),
          '| Status:', routeMatch.status,
          '| Direction:', routeMatch.direction,
          '| Chainage:', routeMatch.projection ? Math.round(routeMatch.projection.chainageMeters) + 'm' : '—',
        )

        if (!routeMatch.accepted || !routeMatch.nextState) return
        routeMatchStateRef.current = routeMatch.nextState
        const matchedPosition: LatLng = [
          routeMatch.projection.position[0],
          routeMatch.projection.position[1],
        ]
        setUserPos(matchedPosition)
        currentPositionRef.current = matchedPosition
        if (
          routeMatch.direction === 'forward' ||
          routeMatch.direction === 'reverse'
        ) {
          const matchedHeading =
            routeMatch.direction === 'reverse'
              ? (routeMatch.projection.segmentBearingDegrees + 180) % 360
              : routeMatch.projection.segmentBearingDegrees
          setHeading(matchedHeading)
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
        if (movementMeters < 2) return
        if (Number.isFinite(pos.speed) && pos.speed != null && pos.speed < 0.5) return

        if (!target) {
          const handledOrders = handledOrdersRef.current
          if (
            !automaticFinishStartedRef.current &&
            handledOrders !== null &&
            pendingPinSortOrderRef.current === null &&
            queuedAudioPinOrdersRef.current.length === 0 &&
            !audioAttemptInFlightRef.current &&
            !startAudioPendingRef.current &&
            !audioEngine.isBusy() &&
            isRouteFinishGpsReady({
              routeSlug: route.slug,
              pins: voicePins,
              handledOrders,
              geometry: routeGeometry,
              match: routeMatch,
              previous: previousRouteMatch,
            })
          ) {
            automaticFinishStartedRef.current = true
            finishSession()
            void audioEngine.playDetailed(
              EXAM_SUCCESS_AUDIO,
              `route-success-${route.slug}-${audioSessionGenerationRef.current}`,
              EXAM_SUCCESS_TEXT,
              {
                onFailure: (reason) => {
                  console.warn('[AUDIO] Route success voice failed', route.slug, reason)
                },
              },
            ).then((status) => {
              if (status === 'failed') {
                console.warn('[AUDIO] Route success voice unavailable', route.slug)
              } else if (status === 'busy' || status === 'cancelled') {
                console.warn('[AUDIO] Route success voice was not played', route.slug, status)
              }
            }).catch((error) => {
              console.warn('[AUDIO] Route success voice threw', route.slug, error)
            })
          }
          return
        }

        const completion = evaluatePinRouteCompletion(
          routeGeometry,
          [target.lat, target.lng],
          routeMatch,
          previousRouteMatch,
          {
            maxPinCrossTrackMeters: 20,
            maxFixCrossTrackMeters: 20,
            maxAccuracyMeters: 12,
            approachWindowMeters: pinAudioApproachWindowMeters(route.slug, target.sort_order),
            minimumForwardMeters: 2,
            expectedPinChainageMeters,
            requireExpectedPinChainage: usesTargetOccurrenceContext,
            gpsPosition: raw,
            maxGpsToPinMeters: usesRoute2Pin26Context
              ? 20
              : pinAudioTriggerDistanceMeters(route.slug, target.sort_order),
          },
        )

        devLog('[PIN GEOMETRY]',
          route.slug.toUpperCase(),
          '| Expected:', `#${nextPinIndex + 1} (PIN ${target.sort_order})`,
          '| Status:', completion.status,
          '| Pin cross-track:', completion.pinProjection ? Math.round(completion.pinProjection.crossTrackMeters) + 'm' : '—',
        )

        if (!completion.ready) return
        if (
          completion.pinProjection &&
          completion.fixProjection &&
          completion.pinProjection.chainageMeters >= completion.fixProjection.chainageMeters &&
          !audioHeadingOk(
            headingMatches(
              raw,
              [target.lat, target.lng],
              pos.heading,
              usesRoute2Pin26Context || usesRouteContextTarget
                ? 45
                : AUDIO_HEADING_TOLERANCE_DEG,
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
        clearSpeedLimitFixFreshness()
      },
    )
  }, [gpsStarted, voicePins, phase, route.slug, features.routeAudio, polyline, previewGpsSource, clearSpeedLimitFixFreshness, markSpeedLimitFixFresh, updateSpeedRoadProgress])

  useEffect(() => {
    if (
      phase !== 'active' ||
      !features.routeAudio ||
      pendingPinSortOrder === null ||
      audioPlaybackError?.sortOrder === pendingPinSortOrder ||
      finishInProgressRef.current
    ) return

    const target = voicePins.find((pin) => pin.sort_order === pendingPinSortOrder)
    if (!target) return
    const generation = audioSessionGenerationRef.current

    const isCurrent = () =>
      generation === audioSessionGenerationRef.current &&
      phaseRef.current === 'active' &&
      !finishInProgressRef.current &&
      pendingPinSortOrderRef.current === target.sort_order

    const scheduleRetry = () => {
      if (!isCurrent() || audioRetryTimerRef.current !== null) return
      audioRetryTimerRef.current = window.setTimeout(() => {
        audioRetryTimerRef.current = null
        void attemptPlayback()
      }, AUDIO_RETRY_BASE_MS)
    }

    const completePin = () => {
      if (!isCurrent()) return
      if (audioQueueWatchdogRef.current !== null) {
        clearTimeout(audioQueueWatchdogRef.current)
        audioQueueWatchdogRef.current = null
      }
      audioAttemptInFlightRef.current = false
      const currentPin = voicePinsRef.current.find((pin) => pin.sort_order === target.sort_order) ?? target
      markPinHandled(currentPin)
      pinApproachRef.current.delete(currentPin.id)
      setAudioPlaybackError(null)
      setLastSpoken(currentPin.instruction_ka)
      setPendingPinSortOrder(queuedAudioPinOrdersRef.current.shift() ?? null)
      const pendingSave = saveNowRef.current?.()
      if (pendingSave) void pendingSave.catch(() => undefined)
    }

    const attemptPlayback = async () => {
      if (!isCurrent() || audioAttemptInFlightRef.current) return
      if (startAudioPendingRef.current || audioEngine.isBusy()) {
        scheduleRetry()
        return
      }

      audioAttemptInFlightRef.current = true
      let settled = false
      const attemptId = ++audioPlaybackAttemptRef.current
      const isAttemptCurrent = () =>
        attemptId === audioPlaybackAttemptRef.current && isCurrent()
      const failed = (reason: PlaybackFailureReason | null = null) => {
        if (settled || !isAttemptCurrent()) return
        settled = true
        audioAttemptInFlightRef.current = false
        if (audioQueueWatchdogRef.current !== null) {
          clearTimeout(audioQueueWatchdogRef.current)
          audioQueueWatchdogRef.current = null
        }
        if (reason !== null) {
          console.warn(
            '[AUDIO] PIN voice failed; keeping PIN pending',
            target.sort_order,
            reason,
          )
          setAudioPlaybackError({
            sortOrder: target.sort_order,
            message: 'აუდიო ვერ ჩაირთო. PIN პროგრესში არ ჩაითვალა.',
          })
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
      try {
        audioQueueWatchdogRef.current = window.setTimeout(() => {
          if (!isAttemptCurrent()) return
          audioPlaybackAttemptRef.current += 1
          console.warn('[AUDIO] PIN playback watchdog expired; keeping PIN pending', target.sort_order)
          audioEngine.stopAll()
          audioAttemptInFlightRef.current = false
          audioQueueWatchdogRef.current = null
          setAudioPlaybackError({
            sortOrder: target.sort_order,
            message: 'აუდიო ვერ დასრულდა. PIN პროგრესში არ ჩაითვალა.',
          })
        }, AUDIO_QUEUE_WATCHDOG_MS)
        const status = await audioEngine.playDetailed(
          currentTarget.audio_url,
          currentTarget.id,
          currentTarget.instruction_ka,
          { onEnded: completed, onFailure: failed },
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
          scheduleRetry()
        }
      } catch (error) {
        console.warn('[AUDIO] PIN playback threw; keeping PIN pending', target.sort_order, error)
        failed('play-rejected')
      }
    }

    if (audioRetryTimerRef.current !== null) {
      clearTimeout(audioRetryTimerRef.current)
      audioRetryTimerRef.current = null
    }
    const resumePendingAudio = () => {
      if (document.visibilityState !== 'visible' || audioAttemptInFlightRef.current) return
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
  }, [pendingPinSortOrder, phase, features.routeAudio, route.slug, voicePins, setPendingPinSortOrder, audioRetryToken, audioPlaybackError])

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

  function startSession(startSortOrder = 1, startMode: 'automatic' | 'manual' = 'automatic') {
    const isFieldTest = FIELD_TEST_SLUGS.has(route.slug)
    const progressRead = isFieldTest ? readRoutePinProgress(route.slug, persistenceScope) : null
    if (progressRead?.status === 'invalid' || progressRead?.status === 'unavailable') {
      resumeBlockedRef.current = true
      setResumeError(RESUME_UNRESOLVED_MESSAGE)
      setNextPin(null)
      setRouteComplete(false)
      return
    }

    audioSessionGenerationRef.current++
    setAudioPlaybackError(null)
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
    const resolution = isFieldTest ? resolvePinProgress(voicePins, handled) : null
    if (isFieldTest && (resolution?.status !== 'resume' || resolution.nextSortOrder === null)) {
      setResumeError(
        resolution?.status === 'error'
          ? resolution.message
          : 'მარშრუტზე გასაგრძელებელი PIN აღარ არის. გამოიყენეთ „თავიდან დაწყება“ პროგრესის გასანულებლად.',
      )
      setRouteComplete(resolution?.status === 'resume' && voicePins.length > 0)
      return
    }
    if (!isFieldTest) clearRoutePinProgress(route.slug, persistenceScope)
    clearManualPinSelection(route.slug, persistenceScope)
    if (isFieldTest && handled.size > 0) saveRoutePinProgress(route.slug, handled, persistenceScope)
    triggeredRef.current = pinIdsForOrders(voicePins, handled)
    pinApproachRef.current = new Map()
    routeMatchStateRef.current = null
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
    setLastSpoken(null)
    
    const nextOrder = resolution?.status === 'resume'
      ? resolution.nextSortOrder
      : voicePins.find((pin) => !triggeredRef.current.has(pin.id))?.sort_order ?? null
    const nextPinCandidate = voicePins.find((pin) => pin.sort_order === nextOrder) ?? null
    
    setNextPin(nextPinCandidate ?? null)
    speedTrackerRef.current = createSpeedTracker()
    gpsFilterRef.current.reset()
    setSpeedKmh(0)
    setDriveView(features.mapNav ? 'map' : 'panel')
    setPhase('active')
    resumedSlugRef.current = route.slug
    startAudioPendingRef.current = features.routeAudio &&
      !(progressRead?.status === 'valid' && progressRead.orders.length > 0) &&
      isStartAudioAllowed(route.slug, startSortOrder)
    if (startAudioPendingRef.current) playSessionStartAudio(sessionGeneration)
  }

  async function handleStartSession(startAtSortOrder?: number) {
    // Must run synchronously inside the click, before any await (GPS prompt would lose the gesture).
    audioEngine.unlock()
    if (gpsStarting) return
    if (remoteSessionLoading || remoteSessionCreating || remotePersistenceError) return
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
                polyline,
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
        }
      }
      if (phase !== 'active') setPhase('active')
      if (!gpsStarted) {
        await enableGps(true)
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
    const gpsAutoStartPin = !gpsAutoStartBlockedRef.current &&
      gpsResult.position &&
      previewSelectionMode === 'automatic'
      ? resolveAutoStart(
          voicePins,
          new Set(initialRoutePinProgress),
          gpsResult.position,
          polyline,
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
    startSession(
      selectedSortOrder,
      startAtSortOrder === undefined ? previewSelectionMode : 'manual',
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

  function markPinHandled(pin: PinRow) {
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
      markPinHandled(pin)
      return
    }

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
        triggeredPins: Array.from(pinIdsForOrders(voicePins, new Set(priorOrders))),
        pendingPinSortOrder: null,
        queuedPinSortOrders: [],
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
      triggeredPins: Array.from(triggeredRef.current),
      startMode: sessionStartModeRef.current,
      pendingPinSortOrder: pendingPinSortOrderRef.current,
      queuedPinSortOrders: [...queuedAudioPinOrdersRef.current],
      ...(FIELD_TEST_SLUGS.has(route.slug) ? fieldTestProgressFields() : {}),
      savedAt: Date.now(),
    }
    saveActiveExam(snapshot, {}, persistenceScope)
    void persistRemoteSnapshot(snapshot).catch(() => {})
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
    const pausedSnapshot: SavedExamState = {
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
      elapsedMs: pausedElapsedMs,
      triggeredPins: Array.from(triggeredRef.current),
      startMode: sessionStartModeRef.current,
      pendingPinSortOrder: pendingPinSortOrderRef.current,
      queuedPinSortOrders: [...queuedAudioPinOrdersRef.current],
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
    const hasRemainingPins = routeHasRemainingPins()
    setSummaryCanContinue(hasRemainingPins)
    setSummaryFinalized(false)
    setExamSummary(summary)
    setPhase('summary')
    releaseWake.current?.()
    audioEngine.stopAll()
    sessionStartRef.current = 0
    setElapsedMs(pausedElapsedMs)
    finishInProgressRef.current = false
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

  function continueFromSummary() {
    audioEngine.unlock()
    const saved = loadActiveExam(route.id, route.slug, route.name_ka, persistenceScope)
    if (!saved) {
      setResumeError('შეჩერებული სესია ვერ მოიძებნა. შენახული პროგრესი უცვლელია.')
      return
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
    if (FIELD_TEST_SLUGS.has(route.slug)) handledOrdersRef.current = orders
    sessionStartModeRef.current = saved.startMode ?? 'manual'
    currentPositionRef.current = saved.userPos
    setUserPos(saved.userPos)
    setHeading(saved.heading)
    setSpeedKmh(saved.speedKmh)
    const pausedElapsedMs = Math.max(0, saved.elapsedMs)
    setElapsedMs(pausedElapsedMs)
    sessionStartRef.current = Date.now() - pausedElapsedMs
    setNextPin(sortedPins.find((pin) => !restoredIds.has(pin.id)) ?? null)
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
    gpsAutoStartBlockedRef.current = true
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
    setPendingPinSortOrder(null)
    if (FIELD_TEST_SLUGS.has(route.slug)) handledOrdersRef.current = handled
    resumedSlugRef.current = null
    resumePendingRef.current = false
    setRouteComplete(false)
    setNextPin(sortedPins.find((pin) => !triggeredRef.current.has(pin.id)) ?? null)
    setLastSpoken(null)
    setElapsedMs(0)
    sessionStartRef.current = 0
    clearActiveExam(route.id, route.slug, route.name_ka, persistenceScope) // Clear this route's saved state when restarting
    setSavedEpoch((v) => v + 1)
  }

  const previewDemoActionsRef = useRef<PreviewDemoControls | null>(null)
  previewDemoActionsRef.current = {
    startAtPin: (sortOrder) => handleStartSession(sortOrder),
    reset: restartPreview,
    nextPinOrder: () => nextPinRef.current?.sort_order ?? null,
    isActive: () => phaseRef.current === 'active',
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
      startAtPin: (sortOrder) => currentActions().startAtPin(sortOrder),
      reset: () => currentActions().reset(),
      nextPinOrder: () => currentActions().nextPinOrder(),
      isActive: () => currentActions().isActive(),
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
    {remoteSessionLoading && userId && (
      <p role="status" className="session-hint">სერვერული გამოცდის სესია იტვირთება...</p>
    )}
    {remotePersistenceError && userId && (
      <p role="alert" data-testid="exam-session-persistence-error" className="error-text">
        {remotePersistenceError}
      </p>
    )}
    <div
      className={`exam-session exam-session--${layoutMode} exam-session--${sessionLayout}${active ? ' exam-session--active' : ''}${active && debugPanelEnabled ? ' exam-session--sl-debug' : ''}`}
    >
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

            {audioPlaybackError && (
              <div role="alert" data-testid="audio-playback-error">
                <p className="error-text">
                  PIN {audioPlaybackError.sortOrder}: {audioPlaybackError.message}
                </p>
                <button
                  type="button"
                  className="nav-start-btn"
                  onClick={() => {
                    audioAttemptInFlightRef.current = false
                    setAudioPlaybackError(null)
                    setAudioRetryToken((token) => token + 1)
                  }}
                >
                  აუდიოს ხელახლა ცდა
                </button>
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
              className="exam-route-complete"
            >
              <p className="exam-route-complete__message">
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

          <div className="exam-drive-main">
            {shouldRenderMap && mapCenter && (
              <ExamLiveMap
                route={route}
                userPos={mapCenter}
                heading={heading}
                nextPin={nextPin}
                hasGpsFix={userPos !== null}
                offlineMaps={offlineMaps}
              />
            )}
            {shouldRenderMap && (
              <div className="exam-navigation-dock" aria-label="ნავიგაციის ინფორმაცია და ხმის კონტროლი">
                <div className="exam-navigation-dock__metric">
                  <small>გავლილი დრო</small>
                  <strong>{formatExamDuration(elapsedMs)}</strong>
                </div>
                <label className="exam-navigation-dock__volume">
                  <span className="exam-navigation-dock__volume-label">ხმა</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={voiceVolume}
                    aria-label="ხმის დონე"
                    onChange={(event) => {
                      const volume = Number(event.currentTarget.value)
                      examVoiceVolume = volume
                      setVoiceVolume(volume)
                      audioEngine.setVolume(volume)
                    }}
                  />
                  <output>{Math.round(voiceVolume * 100)}%</output>
                </label>
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
            {previewRouteComplete && (
              <div role="status" data-testid="route-complete">
                <p>მარშრუტი დასრულებულია — ყველა PIN გავლილია.</p>
                <button type="button" className="nav-start-btn" onClick={restartPreview}>
                  თავიდან დაწყება
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
                  <strong>PIN {previewPin.sort_order}</strong>
                  <span>{previewPin.instruction_ka}</span>
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
          onReturnToMenu={onReturnToMenu}
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
