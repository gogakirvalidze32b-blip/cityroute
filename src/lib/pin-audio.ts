/**
 * PIN audio trigger decision (pure, dependency-free).
 *
 * This module only decides WHEN a PIN's voice should play. It does NOT detect
 * PINs, does not touch coordinates / sort_order, and does not change the
 * strict-sequence rule: the "next" PIN is always the first untriggered one.
 * The only addition is audio catch-up so a voice is never lost when the driver
 * passes a PIN quickly or GPS skips a few metres.
 */

/** Voice starts when the driver is this close (m) to the next PIN. (was 5 m) */
export const AUDIO_TRIGGER_DISTANCE_M = 20
const REDUCED_AUDIO_TRIGGER_DISTANCE_M = 10

const REDUCED_AUDIO_TRIGGER_PIN_ORDERS: Readonly<Record<string, number>> = {
  'route-1': 32,
  'route-2': 26,
  'route-3': 28,
  'route-4': 29,
}

export function pinAudioTriggerDistanceMeters(route: string, sortOrder: number): number {
  return REDUCED_AUDIO_TRIGGER_PIN_ORDERS[route] === sortOrder
    ? REDUCED_AUDIO_TRIGGER_DISTANCE_M
    : AUDIO_TRIGGER_DISTANCE_M
}

/** Heading tolerance (°) used ONLY for audio. (was 55°) Map/nav keep gps.ts default. */
export const AUDIO_HEADING_TOLERANCE_DEG = 90

/** Closest approach (m) at which a PIN counts as "approached" for pass-by catch-up. */
export const AUDIO_PASSED_NEAR_M = 40

/** Driver is considered to have passed a PIN once this much farther than closest approach (m). */
export const AUDIO_PASSED_MARGIN_M = 8

/** How many PINs after the next one may be used to recover a missed voice. */
export const AUDIO_LOOKAHEAD_PINS = 2

/** Lookahead is only allowed if the driver really came this close (m) to the missed PIN. */
export const AUDIO_LOOKAHEAD_MIN_APPROACH_M = 60

/** GPS heading is unreliable below this speed (m/s) → heading check is skipped. */
export const AUDIO_HEADING_MIN_SPEED_MS = 1

/** Max attempts to play one PIN voice when playback itself fails. */
export const AUDIO_MAX_ATTEMPTS = 3

/** Two fixes further apart in time than this (ms) are not treated as one continuous movement. */
export const AUDIO_SEGMENT_MAX_GAP_MS = 60000

/** Two fixes further apart than this (m) are not treated as one straight movement. */
export const AUDIO_SEGMENT_MAX_LENGTH_M = 1000

/** The segment must pass this close (m) to the expected PIN to count as an approach. */
export const AUDIO_SEGMENT_NEAR_M = 25
/** Maximum implied speed between two fixes (m/s, 144 km/h); above it the movement is a GPS jump. */
export const AUDIO_SEGMENT_MAX_SPEED_MPS = 40

export type RoundaboutPinRoute = 'route-1' | 'route-2' | 'route-3' | 'route-4'
export type RoundaboutGatePhase = 'blocked' | 'approached' | 'departed' | 'returned'

export interface RoundaboutGateTarget {
  route: RoundaboutPinRoute
  sortOrder: number
  lat: number
  lng: number
}

export interface RoundaboutReturnGateState {
  route: RoundaboutPinRoute
  targetSortOrder: number
  phase: RoundaboutGatePhase
}

export interface RoundaboutReturnGateInput {
  route: RoundaboutPinRoute
  sortOrder: number
  lat: number
  lng: number
  currentChainageMeters: number
  targetChainageMeters: number
  currentCrossTrackMeters: number
  targetCrossTrackMeters: number
}

export const ROUNDABOUT_TARGETS: readonly RoundaboutGateTarget[] = []

const ROUNDABOUT_APPROACH_M = 22
const ROUNDABOUT_DEPARTURE_M = 250
const ROUNDABOUT_MAX_CROSS_TRACK_M = 30

function sameCoordinate(first: number, second: number): boolean {
  return Math.abs(first - second) < 0.0000005
}

export function identifyRoundaboutGateTarget(
  route: string,
  sortOrder: number,
  lat: number,
  lng: number,
): RoundaboutGateTarget | null {
  return ROUNDABOUT_TARGETS.find((target) =>
    target.route === route &&
    target.sortOrder === sortOrder &&
    sameCoordinate(target.lat, lat) &&
    sameCoordinate(target.lng, lng),
  ) ?? null
}

export function createRoundaboutReturnGate(
  route: RoundaboutPinRoute,
  sortOrder: number,
): RoundaboutReturnGateState {
  return { route, targetSortOrder: sortOrder, phase: 'blocked' }
}

export function updateRoundaboutReturnGate(
  state: RoundaboutReturnGateState | null,
  input: RoundaboutReturnGateInput,
): RoundaboutReturnGateState {
  const target = identifyRoundaboutGateTarget(input.route, input.sortOrder, input.lat, input.lng)
  if (!target) {
    return state?.route === input.route
      ? state
      : createRoundaboutReturnGate(input.route, input.sortOrder)
  }
  if (
    !state ||
    state.route !== target.route ||
    state.targetSortOrder !== target.sortOrder
  ) {
    state = createRoundaboutReturnGate(target.route, target.sortOrder)
  }
  if (
    !Number.isFinite(input.currentChainageMeters) ||
    !Number.isFinite(input.targetChainageMeters) ||
    input.currentCrossTrackMeters > ROUNDABOUT_MAX_CROSS_TRACK_M ||
    input.targetCrossTrackMeters > ROUNDABOUT_MAX_CROSS_TRACK_M
  ) {
    return state
  }

  const targetDistance = Math.abs(input.currentChainageMeters - input.targetChainageMeters)
  if (state.phase === 'blocked' && targetDistance <= ROUNDABOUT_APPROACH_M) {
    return { ...state, phase: 'approached' }
  }
  if (state.phase === 'approached' && targetDistance >= ROUNDABOUT_DEPARTURE_M) {
    return { ...state, phase: 'departed' }
  }
  if (state.phase === 'departed' && targetDistance <= ROUNDABOUT_APPROACH_M) {
    return { ...state, phase: 'returned' }
  }
  return state
}

export function isRoundaboutReturnGateOpened(
  route: string,
  sortOrder: number,
  lat: number,
  lng: number,
  state: RoundaboutReturnGateState | null,
): boolean {
  const target = identifyRoundaboutGateTarget(route, sortOrder, lat, lng)
  if (!target) return true
  return state?.route === target.route &&
    state.targetSortOrder === target.sortOrder &&
    state.phase === 'returned'
}

export interface TimedFix {
  lat: number
  lng: number
  /** ms epoch */
  t: number
}

const EARTH_RADIUS_M = 6371000

/**
 * Closest distance (m) between the PIN and the straight movement between two consecutive GPS fixes,
 * or null when that movement cannot be trusted as a pass of the PIN:
 *  - timestamps not strictly increasing, or gap above AUDIO_SEGMENT_MAX_GAP_MS
 *  - movement longer than AUDIO_SEGMENT_MAX_LENGTH_M or zero-length
 *  - PIN is behind the start of the movement (driving away from it)
 *  - closest point is farther than AUDIO_SEGMENT_NEAR_M
 * Pure; it only ever feeds the closest-approach bookkeeping and never selects a PIN.
 */
export function segmentApproachMeters(
  prev: TimedFix,
  cur: TimedFix,
  pin: readonly [number, number],
): number | null {
  const dt = cur.t - prev.t
  if (!Number.isFinite(dt) || dt <= 0 || dt > AUDIO_SEGMENT_MAX_GAP_MS) return null
  const lat0 = (prev.lat * Math.PI) / 180
  const toXY = (lat: number, lng: number): [number, number] => [
    ((lng - prev.lng) * Math.PI * EARTH_RADIUS_M * Math.cos(lat0)) / 180,
    ((lat - prev.lat) * Math.PI * EARTH_RADIUS_M) / 180,
  ]
  const [bx, by] = toXY(cur.lat, cur.lng)
  const [px, py] = toXY(pin[0], pin[1])
  const len2 = bx * bx + by * by
  if (!Number.isFinite(len2) || len2 === 0 || Math.sqrt(len2) > AUDIO_SEGMENT_MAX_LENGTH_M) return null
  // A teleport (GPS jump) is not a drive: reject physically implausible implied speed.
  if (Math.sqrt(len2) / (dt / 1000) > AUDIO_SEGMENT_MAX_SPEED_MPS) return null
  const u = (px * bx + py * by) / len2
  if (u < 0) return null
  const c = Math.min(1, u)
  const d = Math.hypot(px - bx * c, py - by * c)
  return d <= AUDIO_SEGMENT_NEAR_M ? d : null
}

/** Records a trusted segment pass of the expected PIN into the closest-approach map. */
export function recordSegmentApproach(
  minDist: Map<string, number>,
  pinId: string,
  prev: TimedFix | null,
  cur: TimedFix,
  pin: readonly [number, number],
): void {
  if (!prev) return
  const d = segmentApproachMeters(prev, cur, pin)
  if (d === null) return
  const old = minDist.get(pinId)
  if (old === undefined || d < old) minDist.set(pinId, d)
}

/**
 * Heading gate for audio. `matches` is the result of headingMatches(..., AUDIO_HEADING_TOLERANCE_DEG).
 * When the vehicle is (almost) stationary the GPS heading is noise, so never block audio on it.
 */
export function audioHeadingOk(matches: boolean, speedMs: number | null | undefined): boolean {
  if (speedMs != null && Number.isFinite(speedMs) && speedMs < AUDIO_HEADING_MIN_SPEED_MS) return true
  return matches
}

export type PinAudioReason = 'in-range' | 'passed' | 'lookahead'

export interface PinAudioInput {
  /** PIN ids in sort_order. */
  pinIds: readonly string[]
  /** Ids already announced (or silently passed). */
  triggered: ReadonlySet<string>
  /** Distance in metres from the driver to PIN at index i. Evaluated lazily. */
  distanceTo: (index: number) => number
  /** Heading gate for PIN at index i (already includes speed handling). Evaluated lazily. */
  headingOkAt: (index: number) => boolean
  /** Closest approach per PIN id. Mutated by this function. Reset it on session start. */
  minDist: Map<string, number>
  /** True while another voice is still playing → defer (catch-up recovers it later). */
  busy?: boolean
}

export interface PinAudioDecision {
  /** Index of the PIN whose voice must play now. */
  index: number
  /** Earlier untriggered PINs that were missed; mark as passed WITHOUT playing (stale instructions). */
  skipped: number[]
  reason: PinAudioReason
}

export function decidePinAudio(input: PinAudioInput): PinAudioDecision | null {
  const { pinIds, triggered, distanceTo, headingOkAt, minDist, busy } = input

  const next = pinIds.findIndex((id) => !triggered.has(id))
  if (next < 0) return null

  const nextId = pinIds[next]
  const d = distanceTo(next)
  const prevMin = minDist.get(nextId)
  const min = prevMin === undefined ? d : Math.min(prevMin, d)
  minDist.set(nextId, min)

  if (busy) return null

  // 1) Normal: close enough to the expected PIN and heading is acceptable.
  if (d <= AUDIO_TRIGGER_DISTANCE_M && headingOkAt(next)) {
    return { index: next, skipped: [], reason: 'in-range' }
  }

  // 2) Passed it: came near, now moving away, voice never played → play it now (late is better than never).
  if (min <= AUDIO_PASSED_NEAR_M && d - min >= AUDIO_PASSED_MARGIN_M) {
    return { index: next, skipped: [], reason: 'passed' }
  }

  // 3) Lookahead: GPS jumped past the expected PIN and we are now at one of the next few.
  //    Only when we genuinely approached the expected PIN, to avoid loops/overlaps skipping pins.
  if (min <= AUDIO_LOOKAHEAD_MIN_APPROACH_M) {
    const last = Math.min(pinIds.length - 1, next + AUDIO_LOOKAHEAD_PINS)
    for (let i = next + 1; i <= last; i++) {
      if (triggered.has(pinIds[i])) continue
      if (distanceTo(i) <= AUDIO_TRIGGER_DISTANCE_M && headingOkAt(i)) {
        const skipped: number[] = []
        for (let j = next; j < i; j++) if (!triggered.has(pinIds[j])) skipped.push(j)
        return { index: i, skipped, reason: 'lookahead' }
      }
    }
  }

  return null
}
