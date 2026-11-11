export const ACTIVE_ROUTE_IDS = ['route-1', 'route-2', 'route-3', 'route-4'] as const

export type ActiveRouteId = (typeof ACTIVE_ROUTE_IDS)[number]
export type LatLng = readonly [lat: number, lng: number]

export interface PreparedRouteGeometry {
  readonly routeId: ActiveRouteId
  readonly coordinates: readonly LatLng[]
  readonly cumulativeMeters: readonly number[]
  readonly totalLengthMeters: number
}

export interface RouteProjection {
  readonly routeId: ActiveRouteId
  readonly segmentIndex: number
  readonly segmentFraction: number
  readonly position: LatLng
  readonly chainageMeters: number
  readonly crossTrackMeters: number
  readonly segmentBearingDegrees: number
}

export interface GpsFix {
  readonly position: LatLng
  readonly accuracyMeters: number
  readonly timestampMs: number
  readonly headingDegrees?: number | null
}

export interface RouteMatchState {
  readonly routeId: ActiveRouteId
  readonly chainageMeters: number
  readonly segmentIndex: number
  readonly position: LatLng
  readonly timestampMs: number
  readonly accuracyMeters: number
}

export type RouteDirection = 'forward' | 'reverse' | 'stationary' | 'unknown'

export type RouteMatchStatus =
  | 'matched'
  | 'invalid-fix'
  | 'stale-fix'
  | 'future-fix'
  | 'poor-accuracy'
  | 'route-mismatch'
  | 'out-of-order-fix'
  | 'gps-jump'
  | 'off-route'
  | 'ambiguous-route-match'

export interface RouteMatchResult {
  readonly status: RouteMatchStatus
  readonly accepted: boolean
  readonly projection: RouteProjection | null
  readonly direction: RouteDirection
  readonly nextState: RouteMatchState | null
}

export interface PinRouteCompletionOptions {
  readonly maxPinCrossTrackMeters?: number
  readonly maxFixCrossTrackMeters?: number
  readonly maxAccuracyMeters?: number
  readonly approachWindowMeters?: number
  readonly minimumForwardMeters?: number
  readonly expectedPinChainageMeters?: number
  readonly pinProjectionWindowMeters?: number
  readonly requireExpectedPinChainage?: boolean
  readonly gpsPosition?: LatLng
  readonly maxGpsToPinMeters?: number
}

export const MAX_GPS_PASS_GAP_MS = 60_000

export type PinRouteCompletionStatus =
  | 'ready'
  | 'no-route-match'
  | 'gps-gap'
  | 'poor-accuracy'
  | 'stationary'
  | 'reverse-direction'
  | 'gps-off-route'
  | 'pin-off-route'
  | 'gps-too-far-from-pin'
  | 'pin-not-in-approach-window'

export interface PinRouteCompletionResult {
  readonly status: PinRouteCompletionStatus
  readonly ready: boolean
  readonly pinProjection: RouteProjection | null
  readonly fixProjection: RouteProjection | null
}

export interface RouteMatchOptions {
  readonly nowMs: number
  readonly maxGpsAgeMs?: number
  readonly futureToleranceMs?: number
  readonly maxAccuracyMeters?: number
  readonly maxCrossTrackMeters?: number
  readonly maxSpeedMetersPerSecond?: number
  readonly stationaryThresholdMeters?: number
  readonly ambiguityToleranceMeters?: number
  readonly ambiguitySeparationMeters?: number
  readonly expectedChainageMeters?: number
  readonly expectedChainageWindowMeters?: number
  readonly expectedForwardChainageMeters?: number
}

const EARTH_RADIUS_METERS = 6_371_008.8
const DEGREES_TO_RADIANS = Math.PI / 180

function isValidPosition(position: LatLng): boolean {
  const [lat, lng] = position
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function distanceMeters(from: LatLng, to: LatLng): number {
  const lat1 = from[0] * DEGREES_TO_RADIANS
  const lat2 = to[0] * DEGREES_TO_RADIANS
  const deltaLat = (to[0] - from[0]) * DEGREES_TO_RADIANS
  const deltaLng = (to[1] - from[1]) * DEGREES_TO_RADIANS
  const sinLat = Math.sin(deltaLat / 2)
  const sinLng = Math.sin(deltaLng / 2)
  const a = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
}

function bearingDegrees(from: LatLng, to: LatLng): number {
  const lat1 = from[0] * DEGREES_TO_RADIANS
  const lat2 = to[0] * DEGREES_TO_RADIANS
  const deltaLng = (to[1] - from[1]) * DEGREES_TO_RADIANS
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return (Math.atan2(y, x) / DEGREES_TO_RADIANS + 360) % 360
}

function localMeters(origin: LatLng, point: LatLng): readonly [number, number] {
  const meanLatitude = ((origin[0] + point[0]) / 2) * DEGREES_TO_RADIANS
  const x = (point[1] - origin[1]) * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS * Math.cos(meanLatitude)
  const y = (point[0] - origin[0]) * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS
  return [x, y]
}

export function prepareRouteGeometry(
  routeId: ActiveRouteId,
  coordinates: readonly LatLng[],
): PreparedRouteGeometry {
  if (!ACTIVE_ROUTE_IDS.includes(routeId)) {
    throw new RangeError(`Unsupported active route: ${routeId}`)
  }
  if (coordinates.length < 2 || coordinates.some((position) => !isValidPosition(position))) {
    throw new RangeError('Route geometry must contain at least two valid [lat, lng] coordinates')
  }

  const copiedCoordinates = coordinates.map(([lat, lng]) => [lat, lng] as const)
  const cumulativeMeters: number[] = [0]
  for (let index = 1; index < copiedCoordinates.length; index += 1) {
    cumulativeMeters.push(
      cumulativeMeters[index - 1] + distanceMeters(copiedCoordinates[index - 1], copiedCoordinates[index]),
    )
  }

  const totalLengthMeters = cumulativeMeters[cumulativeMeters.length - 1]
  if (!Number.isFinite(totalLengthMeters) || totalLengthMeters <= 0) {
    throw new RangeError('Route geometry must have a positive length')
  }

  return {
    routeId,
    coordinates: copiedCoordinates,
    cumulativeMeters,
    totalLengthMeters,
  }
}

function projectToSegment(
  route: PreparedRouteGeometry,
  position: LatLng,
  segmentIndex: number,
): RouteProjection {
  const start = route.coordinates[segmentIndex]
  const end = route.coordinates[segmentIndex + 1]
  const [endX, endY] = localMeters(start, end)
  const [positionX, positionY] = localMeters(start, position)
  const segmentLengthSquared = endX * endX + endY * endY
  const fraction = segmentLengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (positionX * endX + positionY * endY) / segmentLengthSquared))
  const projectedPosition: LatLng = [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ]
  const [projectedX, projectedY] = localMeters(start, projectedPosition)

  return {
    routeId: route.routeId,
    segmentIndex,
    segmentFraction: fraction,
    position: projectedPosition,
    chainageMeters:
      route.cumulativeMeters[segmentIndex] +
      (route.cumulativeMeters[segmentIndex + 1] - route.cumulativeMeters[segmentIndex]) * fraction,
    crossTrackMeters: Math.hypot(positionX - projectedX, positionY - projectedY),
    segmentBearingDegrees: bearingDegrees(start, end),
  }
}

function getProjections(route: PreparedRouteGeometry, position: LatLng): RouteProjection[] {
  return route.coordinates.slice(0, -1).map((_, index) => projectToSegment(route, position, index))
}

export function findNearestSegment(route: PreparedRouteGeometry, position: LatLng): RouteProjection | null {
  if (!isValidPosition(position)) return null
  return getProjections(route, position).reduce<RouteProjection | null>(
    (nearest, projection) =>
      nearest === null || projection.crossTrackMeters < nearest.crossTrackMeters ? projection : nearest,
    null,
  )
}

export function projectPointToRoute(route: PreparedRouteGeometry, position: LatLng): RouteProjection | null {
  return findNearestSegment(route, position)
}

export function projectPointToRouteNearChainage(
  route: PreparedRouteGeometry,
  position: LatLng,
  expectedChainageMeters: number,
  windowMeters = 40,
): RouteProjection | null {
  if (
    !isValidPosition(position) ||
    !Number.isFinite(expectedChainageMeters) ||
    expectedChainageMeters < 0 ||
    expectedChainageMeters > route.totalLengthMeters ||
    !Number.isFinite(windowMeters) ||
    windowMeters <= 0
  ) return null

  return getProjections(route, position)
    .filter(
      (projection) => Math.abs(projection.chainageMeters - expectedChainageMeters) <= windowMeters,
    )
    .reduce<RouteProjection | null>(
      (nearest, projection) =>
        nearest === null || projection.crossTrackMeters < nearest.crossTrackMeters
          ? projection
          : nearest,
      null,
    )
}

export function projectOrderedPointsToRoute(
  route: PreparedRouteGeometry,
  positions: readonly LatLng[],
  maxCrossTrackMeters = 20,
): RouteProjection | null {
  let minimumChainageMeters = 0
  let lastProjection: RouteProjection | null = null

  for (const position of positions) {
    const projection = getProjections(route, position)
      .filter(
        (candidate) =>
          candidate.chainageMeters >= minimumChainageMeters - 5 &&
          candidate.crossTrackMeters <= maxCrossTrackMeters,
      )
      .reduce<RouteProjection | null>(
        (earliest, candidate) =>
          earliest === null ||
          candidate.chainageMeters < earliest.chainageMeters ||
          (candidate.chainageMeters === earliest.chainageMeters &&
            candidate.crossTrackMeters < earliest.crossTrackMeters)
            ? candidate
            : earliest,
        null,
      )

    if (!projection) return null
    minimumChainageMeters = Math.max(minimumChainageMeters, projection.chainageMeters)
    lastProjection = projection
  }

  return lastProjection
}

export function evaluatePinRouteCompletion(
  route: PreparedRouteGeometry,
  pinPosition: LatLng,
  match: RouteMatchResult,
  previous: RouteMatchState | null,
  options: PinRouteCompletionOptions = {},
): PinRouteCompletionResult {
  const projectionChainage = options.expectedPinChainageMeters ??
    (match.accepted ? match.projection?.chainageMeters : undefined)
  const pinProjection = projectionChainage === undefined
    ? options.requireExpectedPinChainage ? null : projectPointToRoute(route, pinPosition)
    : projectPointToRouteNearChainage(
        route,
        pinPosition,
        projectionChainage,
        options.pinProjectionWindowMeters,
      ) ?? (options.requireExpectedPinChainage ? null : projectPointToRoute(route, pinPosition))
  if (!match.accepted || !match.projection || !match.nextState || !previous) {
    return {
      status: 'no-route-match',
      ready: false,
      pinProjection,
      fixProjection: match.projection,
    }
  }

  if (match.nextState.timestampMs - previous.timestampMs > MAX_GPS_PASS_GAP_MS) {
    return { status: 'gps-gap', ready: false, pinProjection, fixProjection: match.projection }
  }

  const maxAccuracyMeters = options.maxAccuracyMeters ?? 12
  const maxFixCrossTrackMeters = options.maxFixCrossTrackMeters ?? 20
  const maxPinCrossTrackMeters = options.maxPinCrossTrackMeters ?? 20
  const approachWindowMeters = options.approachWindowMeters ?? 20
  const minimumForwardMeters = options.minimumForwardMeters ?? 2

  if (match.nextState.accuracyMeters > maxAccuracyMeters) {
    return { status: 'poor-accuracy', ready: false, pinProjection, fixProjection: match.projection }
  }
  if (match.projection.crossTrackMeters > maxFixCrossTrackMeters) {
    return { status: 'gps-off-route', ready: false, pinProjection, fixProjection: match.projection }
  }
  if (!pinProjection || pinProjection.crossTrackMeters > maxPinCrossTrackMeters) {
    return { status: 'pin-off-route', ready: false, pinProjection, fixProjection: match.projection }
  }
  if (
    options.gpsPosition &&
    options.maxGpsToPinMeters !== undefined &&
    distanceMeters(options.gpsPosition, pinPosition) > options.maxGpsToPinMeters
  ) {
    return {
      status: 'gps-too-far-from-pin',
      ready: false,
      pinProjection,
      fixProjection: match.projection,
    }
  }

  const forwardMeters = match.nextState.chainageMeters - previous.chainageMeters
  if (match.direction !== 'forward' || forwardMeters < minimumForwardMeters) {
    return {
      status: match.direction === 'reverse' ? 'reverse-direction' : 'stationary',
      ready: false,
      pinProjection,
      fixProjection: match.projection,
    }
  }

  const pinDeltaMeters = pinProjection.chainageMeters - match.projection.chainageMeters
  if (pinDeltaMeters < -approachWindowMeters || pinDeltaMeters > approachWindowMeters) {
    return {
      status: 'pin-not-in-approach-window',
      ready: false,
      pinProjection,
      fixProjection: match.projection,
    }
  }

  return {
    status: 'ready',
    ready: true,
    pinProjection,
    fixProjection: match.projection,
  }
}

function rejected(
  status: RouteMatchStatus,
  projection: RouteProjection | null = null,
): RouteMatchResult {
  return { status, accepted: false, projection, direction: 'unknown', nextState: null }
}

function angleDifferenceDegrees(first: number, second: number): number {
  const difference = Math.abs(((first - second) % 360 + 360) % 360)
  return Math.min(difference, 360 - difference)
}

export function matchGpsPosition(
  route: PreparedRouteGeometry,
  fix: GpsFix,
  previous: RouteMatchState | null,
  options: RouteMatchOptions,
): RouteMatchResult {
  const maxGpsAgeMs = options.maxGpsAgeMs ?? 15_000
  const futureToleranceMs = options.futureToleranceMs ?? 2_000
  const maxAccuracyMeters = options.maxAccuracyMeters ?? 50
  const maxCrossTrackMeters = options.maxCrossTrackMeters ?? 80
  const maxSpeedMetersPerSecond = options.maxSpeedMetersPerSecond ?? 55
  const stationaryThresholdMeters = options.stationaryThresholdMeters ?? 2
  const ambiguityToleranceMeters = options.ambiguityToleranceMeters ?? 5
  const ambiguitySeparationMeters = options.ambiguitySeparationMeters ?? 100
  const expectedChainageWindowMeters = options.expectedChainageWindowMeters ?? 40

  if (
    !isValidPosition(fix.position) ||
    !Number.isFinite(fix.accuracyMeters) ||
    fix.accuracyMeters < 0 ||
    !Number.isFinite(fix.timestampMs) ||
    !Number.isFinite(options.nowMs) ||
    (fix.headingDegrees != null && (!Number.isFinite(fix.headingDegrees) || fix.headingDegrees < 0 || fix.headingDegrees > 360))
  ) {
    return rejected('invalid-fix')
  }
  if (options.nowMs - fix.timestampMs > maxGpsAgeMs) return rejected('stale-fix')
  if (fix.timestampMs - options.nowMs > futureToleranceMs) return rejected('future-fix')
  if (fix.accuracyMeters > maxAccuracyMeters) return rejected('poor-accuracy')
  if (
    previous &&
    (previous.routeId !== route.routeId ||
      !Number.isFinite(previous.chainageMeters) ||
      previous.chainageMeters < 0 ||
      previous.chainageMeters > route.totalLengthMeters ||
      !Number.isFinite(previous.timestampMs) ||
      !Number.isFinite(previous.accuracyMeters) ||
      previous.accuracyMeters < 0)
  ) {
    return rejected('route-mismatch')
  }
  if (previous && fix.timestampMs <= previous.timestampMs) return rejected('out-of-order-fix')

  const projections = getProjections(route, fix.position)
  const nearest = projections.reduce<RouteProjection | null>(
    (current, projection) =>
      current === null || projection.crossTrackMeters < current.crossTrackMeters ? projection : current,
    null,
  )
  if (!nearest) return rejected('invalid-fix')

  let candidates = projections.map((projection) => ({
    projection,
    score: projection.crossTrackMeters,
    deltaMeters: 0,
  }))

  if (!previous && options.expectedChainageMeters !== undefined) {
    const expectedChainageMeters = options.expectedChainageMeters
    if (
      expectedChainageMeters === undefined ||
      !Number.isFinite(expectedChainageMeters) ||
      expectedChainageMeters < 0 ||
      expectedChainageMeters > route.totalLengthMeters ||
      !Number.isFinite(expectedChainageWindowMeters) ||
      expectedChainageWindowMeters <= 0
    ) {
      return rejected('invalid-fix', nearest)
    }
    candidates = candidates.filter(
      ({ projection }) =>
        Math.abs(projection.chainageMeters - expectedChainageMeters) <=
        expectedChainageWindowMeters,
    )
    if (candidates.length === 0) return rejected('ambiguous-route-match', nearest)
  }

  if (previous) {
    const elapsedSeconds = (fix.timestampMs - previous.timestampMs) / 1000
    const allowedTravelMeters =
      maxSpeedMetersPerSecond * elapsedSeconds +
      previous.accuracyMeters +
      fix.accuracyMeters +
      stationaryThresholdMeters
    candidates = candidates
      .map(({ projection }) => {
        const deltaMeters = projection.chainageMeters - previous.chainageMeters
        const movementBearing = deltaMeters < 0
          ? (projection.segmentBearingDegrees + 180) % 360
          : projection.segmentBearingDegrees
        const headingPenalty =
          fix.headingDegrees == null || Math.abs(deltaMeters) <= stationaryThresholdMeters
            ? 0
            : angleDifferenceDegrees(fix.headingDegrees, movementBearing) * 0.05
        return {
          projection,
          deltaMeters,
          score:
            projection.crossTrackMeters +
            Math.abs(deltaMeters) * 0.01 +
            headingPenalty,
        }
      })
      .filter(({ deltaMeters }) => Math.abs(deltaMeters) <= allowedTravelMeters)
  }

  if (candidates.length === 0) return rejected('gps-jump', nearest)
  candidates.sort((first, second) => first.score - second.score)
  let best = candidates[0]
  const competingCandidate = candidates.slice(1).find(
    (candidate) =>
      Math.abs(candidate.projection.chainageMeters - best.projection.chainageMeters) >= ambiguitySeparationMeters,
  )
  if (
    competingCandidate &&
    competingCandidate.score - best.score <= ambiguityToleranceMeters
  ) {
    const preferredChainageMeters = options.expectedForwardChainageMeters
    const forwardCandidates =
      previous &&
      preferredChainageMeters !== undefined &&
      preferredChainageMeters > previous.chainageMeters
      ? candidates
          .filter(
            (candidate) =>
              candidate.deltaMeters > stationaryThresholdMeters &&
              candidate.projection.chainageMeters <= preferredChainageMeters + 20 &&
              candidate.score - best.score <= ambiguityToleranceMeters,
          )
          .sort(
            (first, second) =>
              Math.abs(first.projection.chainageMeters - preferredChainageMeters) -
              Math.abs(second.projection.chainageMeters - preferredChainageMeters),
          )
      : []
    const headingAwareForwardCandidates = fix.headingDegrees == null
      ? forwardCandidates
      : forwardCandidates.filter(
          (candidate) =>
            angleDifferenceDegrees(
              fix.headingDegrees!,
              candidate.projection.segmentBearingDegrees,
            ) <= 45,
        )
    const distinctForwardChainages = headingAwareForwardCandidates.filter(
      (candidate, index) =>
        index === 0 ||
        headingAwareForwardCandidates
          .slice(0, index)
          .every(
            (previousCandidate) =>
              Math.abs(
                candidate.projection.chainageMeters -
                  previousCandidate.projection.chainageMeters,
              ) >= ambiguitySeparationMeters,
          ),
    )
    const reverseCandidateSupportsAmbiguity = previous && fix.headingDegrees != null &&
      candidates.some(
        (candidate) =>
          candidate.deltaMeters < -stationaryThresholdMeters &&
          Math.abs(candidate.projection.chainageMeters - best.projection.chainageMeters) >=
            ambiguitySeparationMeters &&
          candidate.score - best.score <= ambiguityToleranceMeters &&
          angleDifferenceDegrees(
            fix.headingDegrees,
            candidate.projection.segmentBearingDegrees,
          ) >= 90,
      )
    if (distinctForwardChainages.length === 1 && reverseCandidateSupportsAmbiguity) {
      best = distinctForwardChainages[0]
    } else if (distinctForwardChainages.length === 1 && fix.headingDegrees == null) {
      best = distinctForwardChainages[0]
    } else {
      return rejected('ambiguous-route-match', best.projection)
    }
  }
  if (best.projection.crossTrackMeters > maxCrossTrackMeters) {
    return rejected('off-route', best.projection)
  }

  const direction: RouteDirection = previous
    ? best.deltaMeters > stationaryThresholdMeters
      ? 'forward'
      : best.deltaMeters < -stationaryThresholdMeters
        ? 'reverse'
        : 'stationary'
    : 'unknown'
  const nextState: RouteMatchState = {
    routeId: route.routeId,
    chainageMeters: best.projection.chainageMeters,
    segmentIndex: best.projection.segmentIndex,
    position: best.projection.position,
    timestampMs: fix.timestampMs,
    accuracyMeters: fix.accuracyMeters,
  }

  return {
    status: 'matched',
    accepted: true,
    projection: best.projection,
    direction,
    nextState,
  }
}
