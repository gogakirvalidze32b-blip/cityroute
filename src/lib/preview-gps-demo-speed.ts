/**
 * Preview-demo-only GPS simulation pacing.
 * Real device GPS / production navigation must not import or mirror these knobs.
 */

export const DEMO_SPEED_KMH_OPTIONS = [20, 40, 60, 100, 200] as const
export type DemoSpeedKmh = (typeof DEMO_SPEED_KMH_OPTIONS)[number]

export const DEMO_TIME_SCALE_OPTIONS = [1, 2, 5, 10] as const
export type DemoTimeScale = (typeof DEMO_TIME_SCALE_OPTIONS)[number]

/**
 * Default selected cruise ceiling (km/h). Adaptive mode still starts/approaches
 * pins at DEMO_NEAR_PIN_SPEED_KMH and only rises toward this on open stretches.
 */
export const DEFAULT_DEMO_SPEED_KMH: DemoSpeedKmh = 60

/** Near a PIN the simulator always slows to this (km/h). */
export const DEMO_NEAR_PIN_SPEED_KMH = 20

/** Within this along-track distance to the next PIN, use near-pin speed. */
export const DEMO_NEAR_PIN_DISTANCE_M = 35

/** Beyond this along-track distance, use the cruise (selected) speed. */
export const DEMO_CRUISE_DISTANCE_M = 70

/** Default wall-clock multiplier (1x = real-time for the selected km/h). */
export const DEFAULT_DEMO_TIME_SCALE: DemoTimeScale = 1

/**
 * Tightest known demo approach window is 5 m (Route 2 PIN 26).
 * Keep published chainage steps below that so high speed / time-scale never jumps past a trigger.
 */
export const MAX_DEMO_STEP_METERS = 2.5

/**
 * ExamDriveSession ignores GPS fixes that move < 2 m (Android speed=0 is allowed).
 * Every demo publish must clear that gate or PINs never confirm at low km/h.
 */
export const MIN_DEMO_STEP_METERS = 2.2

/**
 * Soft forward budget past a PIN while it is still the active target.
 * Must stay forward-only (no reverse) so the map arrow does not spin.
 */
export const DEMO_PIN_HOLD_SLACK_METERS = 12

/**
 * Start this far before the selected PIN so PLAY begins on open road (cruise),
 * then slows to near-pin speed as the first PIN approaches.
 */
export const DEMO_START_APPROACH_LEAD_METERS = 120

/** Base wall-clock tick at 1x; higher time scales shorten this (floored). */
export const DEMO_BASE_TICK_MS = 200
/**
 * Must be >= GpsFilter minTimeDeltaMs (100ms) or most demo fixes are rejected
 * as "too soon" and PINs never confirm — arrow looks stuck.
 */
export const DEMO_MIN_TICK_MS = 120

/**
 * Max along-track micro-publishes per wall-clock tick.
 * Must stay 1 so PIN/audio state can update before the next jump.
 */
export const MAX_DEMO_STEPS_PER_TICK = 1

export function isDemoSpeedKmh(value: number): value is DemoSpeedKmh {
  return (DEMO_SPEED_KMH_OPTIONS as readonly number[]).includes(value)
}

export function isDemoTimeScale(value: number): value is DemoTimeScale {
  return (DEMO_TIME_SCALE_OPTIONS as readonly number[]).includes(value)
}

/** Effective along-track speed including the demo time-scale multiplier. */
export function demoEffectiveSpeedKmh(speedKmh: number, timeScale: number): number {
  return Math.max(0, speedKmh) * Math.max(1, timeScale)
}

/**
 * Adaptive demo speed: 20 km/h near the next PIN, ramp up to cruise on open road.
 * `distanceToNextPinMeters` is along-track remaining distance (null = no PIN / finish stretch → cruise).
 */
export function demoAdaptiveSpeedKmh(
  distanceToNextPinMeters: number | null,
  cruiseSpeedKmh: number = DEFAULT_DEMO_SPEED_KMH,
  nearSpeedKmh: number = DEMO_NEAR_PIN_SPEED_KMH,
  nearDistanceM: number = DEMO_NEAR_PIN_DISTANCE_M,
  cruiseDistanceM: number = DEMO_CRUISE_DISTANCE_M,
): number {
  const cruise = Math.max(nearSpeedKmh, cruiseSpeedKmh)
  const near = Math.min(nearSpeedKmh, cruise)
  if (distanceToNextPinMeters == null || !Number.isFinite(distanceToNextPinMeters)) {
    return cruise
  }
  const distance = Math.max(0, distanceToNextPinMeters)
  if (distance <= nearDistanceM) return near
  if (distance >= cruiseDistanceM) return cruise
  const span = Math.max(1, cruiseDistanceM - nearDistanceM)
  const t = (distance - nearDistanceM) / span
  return near + t * (cruise - near)
}

/** Wall-clock delay between simulation ticks. Faster scales poll more often. */
export function demoTickIntervalMs(timeScale: number): number {
  const scale = Math.max(1, timeScale)
  return Math.max(DEMO_MIN_TICK_MS, Math.round(DEMO_BASE_TICK_MS / scale))
}

/**
 * Tick length so a MIN_DEMO_STEP_METERS move at `speedKmh` matches the selected pace
 * and still clears the exam engine's <2 m movement gate.
 */
export function demoTickIntervalForSpeed(speedKmh: number, timeScale: number = 1): number {
  const speed = Math.max(DEMO_NEAR_PIN_SPEED_KMH, speedKmh)
  const metersPerSec = demoEffectiveSpeedKmh(speed, timeScale) / 3.6
  const tickForMinStep = Math.ceil((MIN_DEMO_STEP_METERS / Math.max(0.1, metersPerSec)) * 1000)
  return Math.max(demoTickIntervalMs(timeScale), tickForMinStep)
}

/** Meters to advance along the route line for one wall-clock tick. */
export function demoAdvanceMeters(speedKmh: number, timeScale: number, tickMs: number): number {
  const seconds = Math.max(0, tickMs) / 1000
  const raw = (demoEffectiveSpeedKmh(speedKmh, timeScale) / 3.6) * seconds
  if (raw <= 0) return 0
  // Never publish a sub-2 m step — those are ignored by ExamDriveSession pin logic.
  return Math.min(MAX_DEMO_STEP_METERS, Math.max(MIN_DEMO_STEP_METERS, raw))
}

/**
 * Cap along-track advance so the simulator does not leap far past an unconfirmed PIN.
 * Always returns a forward-only step (never 0 while requested > 0) so the arrow
 * cannot freeze or reverse at the first PIN.
 */
export function demoAdvanceCappedToNextPin(
  fromChainage: number,
  requestedAdvanceMeters: number,
  nextPinChainageMeters: number | null,
  holdSlackMeters: number = DEMO_PIN_HOLD_SLACK_METERS,
  minStepMeters: number = MIN_DEMO_STEP_METERS,
): number {
  if (!(requestedAdvanceMeters > 0)) return 0
  const step = Math.max(minStepMeters, requestedAdvanceMeters)
  if (nextPinChainageMeters == null || !Number.isFinite(nextPinChainageMeters)) {
    return step
  }
  const holdAt = nextPinChainageMeters + Math.max(0, holdSlackMeters)
  if (fromChainage >= holdAt) {
    // Still creep forward so PIN confirmation / audio can catch up without reversing.
    return minStepMeters
  }
  return Math.min(step, Math.max(minStepMeters, holdAt - fromChainage))
}

/**
 * Split a large along-track jump into chainage samples that never exceed `maxStepMeters`.
 * Returns the absolute chainage values to publish (exclusive of `fromChainage`, inclusive of the end).
 * `maxSteps` defaults to 1 so each timer tick yields back to PIN/audio handling.
 */
export function demoMicroChainages(
  fromChainage: number,
  advanceMeters: number,
  totalLengthMeters: number,
  maxStepMeters: number = MAX_DEMO_STEP_METERS,
  maxSteps: number = MAX_DEMO_STEPS_PER_TICK,
): number[] {
  if (!(advanceMeters > 0) || !(totalLengthMeters > 0)) return []
  const start = Math.max(0, Math.min(fromChainage, totalLengthMeters))
  const target = Math.min(totalLengthMeters, start + advanceMeters)
  if (target <= start) return []

  const maxStep = Math.max(0.5, maxStepMeters)
  const stepBudget = Math.max(1, Math.floor(maxSteps))
  const chainages: number[] = []
  let cursor = start
  while (cursor < target && chainages.length < stepBudget) {
    const next = Math.min(target, cursor + maxStep)
    if (next <= cursor) break
    chainages.push(next)
    cursor = next
  }
  return chainages
}
