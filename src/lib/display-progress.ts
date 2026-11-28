/**
 * Display-only route progress for the MAP ARROW (pure).
 *
 * The accepted route match can leap ahead of the real car: GPS noise puts a fix
 * 10–20 m ahead, and the matcher sometimes snaps onto a point 30–45 m ahead
 * (lit-PIN corridor snaps). The arrow then visibly "jumps forward" and waits.
 * This filter decides where along the fixed route line the arrow is DRAWN:
 *
 *  - predict forward at the GPS speed, then blend toward the matched chainage
 *    (alpha filter) — follows a steady car without lag, damps noisy bursts;
 *  - ignore matches far from the raw GPS fix (snaps not supported by the fix);
 *  - never advance faster than the car can plausibly travel;
 *  - never move backwards (small reverse wobble is held);
 *  - accept relocations (resume, long GPS loss) directly.
 *
 * It never feeds route progress, chainage, PIN triggering or speed.
 */

export type DisplayProgress = {
  readonly chainageMeters: number
  readonly timestampMs: number
  /** Speed (m/s) the filter used — lets the map predict motion between fixes. */
  readonly speedMps: number
}

export type DisplayProgressInput = {
  readonly candidateChainageMeters: number
  /** Distance from the raw GPS fix to the matched route point. */
  readonly crossTrackMeters: number
  /** GPS speed (m/s) when reported; null/NaN = unknown. */
  readonly speedMps: number | null | undefined
  readonly timestampMs: number
}

/**
 * Local re-projection of the raw fix around the drawn arrow (used by the
 * caller): search ± this window of route around the arrow…
 */
export const DISPLAY_LOCAL_WINDOW_M = 40
/** …accept a local road position at most this far from the raw fix… */
export const DISPLAY_LOCAL_MAX_CROSS_TRACK_M = 10
/** …that fits the fix clearly better than the matcher's position… */
export const DISPLAY_LOCAL_BETTER_BY_M = 3
/** …and lies clearly apart from the matcher's position (another pass / snap). */
export const DISPLAY_LOCAL_MIN_GAP_M = 5

/** A match farther than this from its GPS fix is not trusted for display. */
export const DISPLAY_MAX_CROSS_TRACK_M = 20
/** A jump farther than this (either way) is a relocation: show it directly. */
export const DISPLAY_RELOCATE_M = 150
/** Blend factor toward the measured chainage after prediction. */
export const DISPLAY_BLEND = 0.25
/** Below this GPS speed the car is stationary: hold unless the match moves > STATIONARY_MOVE_M. */
const STATIONARY_SPEED_MPS = 0.5
const STATIONARY_MOVE_M = 3
/** Speed head-room and slack for the forward limit. */
const SPEED_FACTOR = 1.3
const SPEED_SLACK_MPS = 2
const ADVANCE_SLACK_M = 4
/** Longer gaps between fixes are not bridged by speed prediction (car may have stopped). */
export const PREDICT_MAX_GAP_S = 2
/** How strongly each reported GPS speed pulls the speed estimate (0..1). */
const REPORTED_SPEED_WEIGHT = 0.5
/** A slower reported speed (braking) is believed faster: never coast ahead. */
const REPORTED_SLOWER_WEIGHT = 0.7
/** Blend toward the measured progress when the prediction ran ahead of it. */
export const DISPLAY_BLEND_AHEAD = 0.6
/** Speed correction gain from the position residual (alpha-beta "beta"). */
const SPEED_LEARN_GAIN = 0.15
const MAX_SPEED_MPS = 60
/** The drawn progress may lead the latest measured progress by at most this… */
const LEAD_SLACK_M = 2
/** …plus this share of the distance travelled since the previous fix. */
const LEAD_SPEED_FACTOR = 0.5

export function stepDisplayProgress(
  state: DisplayProgress | null,
  input: DisplayProgressInput,
): DisplayProgress {
  const candidate = input.candidateChainageMeters
  const reportedSpeed =
    input.speedMps != null && Number.isFinite(input.speedMps) && input.speedMps >= 0
      ? input.speedMps
      : null
  if (!state || !Number.isFinite(state.chainageMeters)) {
    return { chainageMeters: candidate, timestampMs: input.timestampMs, speedMps: reportedSpeed ?? 0 }
  }
  const dtSec = Math.min(5, Math.max(0, (input.timestampMs - state.timestampMs) / 1000))
  const delta = candidate - state.chainageMeters
  if (Math.abs(delta) > DISPLAY_RELOCATE_M) {
    return { chainageMeters: candidate, timestampMs: input.timestampMs, speedMps: reportedSpeed ?? 0 }
  }
  if (!Number.isFinite(input.crossTrackMeters) || input.crossTrackMeters > DISPLAY_MAX_CROSS_TRACK_M) {
    // Not supported by the GPS fix: ignore its position, but keep moving at the
    // GPS speed (dead-reckoning) so the arrow neither jumps ahead nor falls behind.
    // Learned speed (tracks real progress) — a biased reported speed would
    // carry the arrow ahead of the car through the untrusted stretch.
    const speed =
      reportedSpeed !== null && reportedSpeed < STATIONARY_SPEED_MPS
        ? 0
        : Number.isFinite(state.speedMps) && state.speedMps > 0
          ? state.speedMps
          : (reportedSpeed ?? 0)
    const deadReckoned = state.chainageMeters + speed * Math.min(dtSec, PREDICT_MAX_GAP_S)
    return { chainageMeters: deadReckoned, timestampMs: input.timestampMs, speedMps: speed }
  }
  if (reportedSpeed !== null && reportedSpeed < STATIONARY_SPEED_MPS && Math.abs(delta) <= STATIONARY_MOVE_M) {
    // Stationary GPS shimmer: keep the arrow still.
    return { chainageMeters: state.chainageMeters, timestampMs: input.timestampMs, speedMps: 0 }
  }
  if (dtSec > PREDICT_MAX_GAP_S) {
    // After a gap without fixes the car may have stopped (or not): predicting
    // speed × gap overshoots. Resync on the measured progress, forward only.
    const speed = reportedSpeed ?? Math.max(0, delta) / dtSec
    const maxGapAdvance = (speed * SPEED_FACTOR + SPEED_SLACK_MPS) * dtSec + ADVANCE_SLACK_M
    const resynced = Math.min(state.chainageMeters + maxGapAdvance, Math.max(state.chainageMeters, candidate))
    return { chainageMeters: resynced, timestampMs: input.timestampMs, speedMps: speed }
  }
  // Alpha-beta tracker: the speed estimate learns the car's real progress, with
  // the reported GPS speed as a hint only — a biased or stale reported speed
  // can no longer park the arrow ahead of (or behind) the car.
  const priorSpeed = Number.isFinite(state.speedMps) && state.speedMps >= 0 ? state.speedMps : 0
  // A reported (near) standstill is trusted outright: never coast past a stop.
  const speed =
    reportedSpeed === null
      ? priorSpeed
      : reportedSpeed < STATIONARY_SPEED_MPS
        ? 0
        : priorSpeed +
          (reportedSpeed < priorSpeed ? REPORTED_SLOWER_WEIGHT : REPORTED_SPEED_WEIGHT) *
            (reportedSpeed - priorSpeed)
  const predicted = state.chainageMeters + speed * dtSec
  const residual = candidate - predicted
  // Prediction AHEAD of the measured car (it slowed down): follow it closely —
  // an arrow running ahead and then waiting is the visible fault. Prediction
  // behind: blend gently, so GPS noise / matcher snaps never jerk it forward.
  const blend = residual < 0 ? DISPLAY_BLEND_AHEAD : DISPLAY_BLEND
  const blended = predicted + blend * residual
  const learnedSpeed = Math.min(
    MAX_SPEED_MPS,
    Math.max(0, speed + (SPEED_LEARN_GAIN * residual) / Math.max(dtSec, 0.2)),
  )
  // Without a reported speed the only speed evidence is the progress itself.
  const limitSpeed = Math.max(
    speed,
    reportedSpeed ?? Math.max(0, delta) / Math.max(dtSec, 0.2),
  )
  const maxAdvance = (limitSpeed * SPEED_FACTOR + SPEED_SLACK_MPS) * dtSec + ADVANCE_SLACK_M
  // Never draw the car clearly AHEAD of where it was just measured, whatever
  // the reported speed claims (stale speed after a stop, biased sensors).
  const maxLead = candidate + LEAD_SLACK_M + LEAD_SPEED_FACTOR * learnedSpeed * dtSec
  const next = Math.min(
    state.chainageMeters + maxAdvance,
    Math.max(state.chainageMeters, Math.min(blended, maxLead)),
  )
  // Held back by the lead cap: the speed estimate was too high — take the
  // measured progress rate instead so the next prediction does not overrun.
  const measuredRate = Math.max(0, delta) / Math.max(dtSec, 0.2)
  const speedOut = blended > maxLead ? Math.min(learnedSpeed, measuredRate) : learnedSpeed
  return { chainageMeters: next, timestampMs: input.timestampMs, speedMps: speedOut }
}
