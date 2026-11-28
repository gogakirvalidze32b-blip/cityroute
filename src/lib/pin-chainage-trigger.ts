/**
 * Kilometre-crossing PIN trigger (pure, dependency-free).
 *
 * A PIN is anchored to an exact route chainage (metres from route start on the
 * frozen route geometry). It becomes due when the vehicle's ACCEPTED route
 * progress reaches `chainage − lead`. GPS is still required — it produces the
 * route progress — but the trigger no longer depends on landing inside a small
 * bubble around the PIN coordinate, so sparse fixes, speed and short GPS
 * outages cannot make a PIN (and every PIN after it) disappear.
 *
 * Policy when progress has passed several pending PINs:
 *  - play only the latest PIN that is still relevant (not passed by more than
 *    PIN_PASS_TOLERANCE_M) and mark the earlier ones as passed silently;
 *  - a PIN that the vehicle has already driven past is never spoken; it is
 *    marked passed silently once that is confirmed on consecutive fixes.
 *
 * Safety: a PIN is only spoken when the raw GPS fix is physically near the PIN
 * coordinate (PIN_POSITION_SAFETY_M). On loops / overlapping roads a wrong-pass
 * route match therefore holds instead of speaking.
 */

export type LatLngTuple = readonly [number, number]

export type ChainagePin = {
  readonly sortOrder: number
  /** Exact route chainage of the PIN (metres from route start). */
  readonly chainageMeters: number
  /** Speak this many metres before the PIN chainage (existing audio radius). */
  readonly leadMeters: number
  /** Real-world PIN coordinate (used only for the safety check). */
  readonly lat: number
  readonly lng: number
}

/** A PIN passed by more than this is outdated and is never spoken. */
export const PIN_PASS_TOLERANCE_M = 30
/** Raw GPS must be within this distance of the PIN coordinate to speak it. */
export const PIN_POSITION_SAFETY_M = 60
/**
 * The raw GPS fix must lie this close to the matched route point (cross-track)
 * before route progress is trusted to SPEAK a PIN. The legacy matcher accepts
 * "lit-PIN recovery" snaps up to 70 m off the fix — e.g. Route 2 #8 progress
 * jumped 44 m ahead onto the turn vertex — and those must never speak early.
 */
export const PIN_FIRE_MAX_CROSS_TRACK_M = 25
/**
 * With a reliable GPS heading the car must drive within this angle of the
 * route's forward direction at the matched point. A match on the OPPOSITE
 * carriageway (Alazani dual passes, finish hairpins) is ~180° off and holds.
 */
export const PIN_FIRE_MAX_HEADING_DIFF_DEG = 100
/** GPS heading is only trusted at or above this speed (m/s). */
export const PIN_HEADING_MIN_SPEED_MPS = 3
/** Cross-track ceiling (m) for a fix to count towards a silent pass. */
export const PIN_SILENT_PASS_MAX_CROSS_TRACK_M = 20
/** Consecutive accepted fixes beyond a PIN before it is marked passed silently. */
export const PIN_SILENT_PASS_CONFIRMATIONS = 2

export type ChainageTriggerState = {
  readonly confirmOrder: number | null
  readonly confirmations: number
}

export const INITIAL_CHAINAGE_TRIGGER_STATE: ChainageTriggerState = {
  confirmOrder: null,
  confirmations: 0,
}

export type ChainageTriggerHold =
  | 'none'
  | 'done'
  | 'not-accepted'
  | 'not-reached'
  | 'off-route-match'
  | 'direction-mismatch'
  | 'position-mismatch'
  | 'awaiting-pass-confirmation'

export type ChainageTriggerDecision = {
  /** sort_order to speak now, or null. */
  readonly play: number | null
  /** Earlier PINs to mark passed WITHOUT audio, in order. */
  readonly passSilently: readonly number[]
  readonly hold: ChainageTriggerHold
  readonly state: ChainageTriggerState
}

export type ChainageTriggerInput = {
  /** PINs sorted by sort_order with strictly increasing chainage. */
  readonly pins: readonly ChainagePin[]
  /** Orders already handled, spoken, queued or passed. */
  readonly done: ReadonlySet<number>
  /** True only for a route match that was accepted AND adopted as progress. */
  readonly progressAccepted: boolean
  readonly progressMeters: number
  readonly crossTrackMeters: number
  readonly gpsPosition: LatLngTuple
  /** Raw GPS heading (deg) and speed (m/s), when the device reports them. */
  readonly gpsHeadingDegrees?: number | null
  readonly gpsSpeedMps?: number | null
  /** Forward bearing (deg) of the route at the matched point. */
  readonly routeBearingDegrees?: number | null
  readonly state: ChainageTriggerState
}

function headingDifference(a: number, b: number): number {
  const diff = Math.abs((((a - b) % 360) + 360) % 360)
  return Math.min(diff, 360 - diff)
}

/** False only when a trustworthy GPS heading clearly contradicts the route direction. */
export function headingConsistentWithRoute(input: Pick<
  ChainageTriggerInput,
  'gpsHeadingDegrees' | 'gpsSpeedMps' | 'routeBearingDegrees'
>): boolean {
  const { gpsHeadingDegrees: heading, gpsSpeedMps: speed, routeBearingDegrees: bearing } = input
  if (heading == null || bearing == null || speed == null) return true
  if (!Number.isFinite(heading) || !Number.isFinite(bearing) || !Number.isFinite(speed)) return true
  if (speed < PIN_HEADING_MIN_SPEED_MPS) return true
  return headingDifference(heading, bearing) <= PIN_FIRE_MAX_HEADING_DIFF_DEG
}

export function metersBetween(a: LatLngTuple, b: LatLngTuple): number {
  const toRad = Math.PI / 180
  const dLat = (b[0] - a[0]) * toRad
  const dLng = (b[1] - a[1]) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, h)))
}

function hold(
  reason: ChainageTriggerHold,
  state: ChainageTriggerState,
): ChainageTriggerDecision {
  return { play: null, passSilently: [], hold: reason, state }
}

export function decideChainageTrigger(input: ChainageTriggerInput): ChainageTriggerDecision {
  const { pins, done, state } = input
  const pendingIndex = pins.findIndex((pin) => !done.has(pin.sortOrder))
  if (pendingIndex < 0) return hold('done', INITIAL_CHAINAGE_TRIGGER_STATE)
  if (
    !input.progressAccepted ||
    !Number.isFinite(input.progressMeters) ||
    !Number.isFinite(input.crossTrackMeters)
  ) {
    return hold('not-accepted', state)
  }

  const progress = input.progressMeters
  // Consecutive pending PINs whose trigger point has been reached.
  const reached: ChainagePin[] = []
  for (let index = pendingIndex; index < pins.length; index += 1) {
    const pin = pins[index]!
    if (done.has(pin.sortOrder)) continue
    if (progress < pin.chainageMeters - pin.leadMeters) break
    reached.push(pin)
  }
  if (reached.length === 0) return hold('not-reached', INITIAL_CHAINAGE_TRIGGER_STATE)

  const latest = reached[reached.length - 1]!
  const earlier = reached.slice(0, -1).map((pin) => pin.sortOrder)

  if (progress <= latest.chainageMeters + PIN_PASS_TOLERANCE_M) {
    if (input.crossTrackMeters > PIN_FIRE_MAX_CROSS_TRACK_M) {
      // Progress is not physically consistent with the fix (snap/overshoot or a
      // wrong pass). Hold; a consistent fix will speak it, or it gets passed.
      return hold('off-route-match', INITIAL_CHAINAGE_TRIGGER_STATE)
    }
    if (!headingConsistentWithRoute(input)) {
      // Matched onto the opposite carriageway / other pass: never speak there.
      return hold('direction-mismatch', INITIAL_CHAINAGE_TRIGGER_STATE)
    }
    const distance = metersBetween(input.gpsPosition, [latest.lat, latest.lng])
    if (distance > PIN_POSITION_SAFETY_M) {
      // Route progress says "here", the car is not physically near the PIN:
      // likely a wrong pass on a loop / overlap. Never speak; wait.
      return hold('position-mismatch', INITIAL_CHAINAGE_TRIGGER_STATE)
    }
    return {
      play: latest.sortOrder,
      passSilently: earlier,
      hold: 'none',
      state: INITIAL_CHAINAGE_TRIGGER_STATE,
    }
  }

  // Every reached PIN is already behind the vehicle → outdated. Confirm before
  // marking them passed so one bad match cannot silently skip instructions.
  if (input.crossTrackMeters > PIN_SILENT_PASS_MAX_CROSS_TRACK_M || !headingConsistentWithRoute(input)) {
    return hold('awaiting-pass-confirmation', INITIAL_CHAINAGE_TRIGGER_STATE)
  }
  const confirmations =
    state.confirmOrder === latest.sortOrder ? state.confirmations + 1 : 1
  if (confirmations < PIN_SILENT_PASS_CONFIRMATIONS) {
    return hold('awaiting-pass-confirmation', { confirmOrder: latest.sortOrder, confirmations })
  }
  return {
    play: null,
    passSilently: reached.map((pin) => pin.sortOrder),
    hold: 'none',
    state: INITIAL_CHAINAGE_TRIGGER_STATE,
  }
}

/** Validation used by tests and the chainage table loader. */
export function chainagePinTableProblems(pins: readonly ChainagePin[]): string[] {
  const problems: string[] = []
  for (const [index, pin] of pins.entries()) {
    if (!Number.isFinite(pin.chainageMeters) || pin.chainageMeters < 0) {
      problems.push(`#${pin.sortOrder}: invalid chainage ${pin.chainageMeters}`)
    }
    if (!Number.isFinite(pin.leadMeters) || pin.leadMeters < 0) {
      problems.push(`#${pin.sortOrder}: invalid lead ${pin.leadMeters}`)
    }
    const previous = pins[index - 1]
    if (previous) {
      if (pin.sortOrder <= previous.sortOrder) {
        problems.push(`#${pin.sortOrder}: sort_order not increasing after #${previous.sortOrder}`)
      }
      if (pin.chainageMeters <= previous.chainageMeters) {
        problems.push(
          `#${pin.sortOrder}: chainage ${pin.chainageMeters.toFixed(1)} m is not after #${previous.sortOrder} (${previous.chainageMeters.toFixed(1)} m)`,
        )
      }
    }
  }
  return problems
}
