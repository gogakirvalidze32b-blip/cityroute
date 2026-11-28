/**
 * Zero-lag map arrow motion along the fixed route line (pure, display only).
 *
 * Gliding toward the LAST GPS fix always trails the real car by roughly one
 * fix interval. Instead, every frame the drawn arrow advances along the route
 * at the car's speed (dead-reckoning since the last fix) and is gently steered
 * toward the predicted position: filtered progress at the last fix plus
 * speed × time since that fix. Because it moves along the route line, it
 * follows curves and turns exactly instead of cutting chords.
 *
 *  - extrapolation is limited to about one fix interval, so a slowing car
 *    makes the arrow ease off instead of running ahead and then stopping;
 *  - an arrow that is ahead slows down smoothly (never moves backwards);
 *  - an arrow that is behind catches up smoothly (no lurch);
 *  - a large backwards jump (resume / route reset) or a gap > MOTION_SNAP_M snaps.
 *
 * It never feeds route progress, chainage, PIN triggering or speed.
 */
import type { PreparedRouteGeometry } from '@/lib/pure-route-geometry'

export type VehicleMotion = {
  readonly geometry: PreparedRouteGeometry
  /** Filtered display route progress at the latest fix (display-progress.ts). */
  readonly chainageMeters: number
  readonly speedMps: number
  /** Increments with every fix so equal values still count as a new fix. */
  readonly seq: number
}

export type MotionTrack = {
  readonly geometry: PreparedRouteGeometry
  readonly baseChainageMeters: number
  readonly speedMps: number
  readonly baseAtMs: number
  /** Smoothed interval between fixes (ms). */
  readonly fixIntervalMs: number
  /** Chainage currently drawn. */
  readonly shownChainageMeters: number
}

export const MOTION_DEFAULT_FIX_INTERVAL_MS = 1000
export const MOTION_MIN_HORIZON_MS = 250
export const MOTION_MAX_HORIZON_MS = 1200
/** Extrapolate up to this multiple of the fix interval past the last fix. */
export const MOTION_HORIZON_FACTOR = 1.1
/** Past the horizon the extrapolation eases off with this time constant. */
export const MOTION_EASE_OFF_MS = 180
/** Time constant for steering the arrow onto the predicted position. */
export const MOTION_CORRECTION_MS = 220
export const MOTION_SNAP_M = 150
/** A new fix this far BEHIND the drawn arrow is a relocation (reset/resume): snap. */
export const MOTION_BACKWARD_RELOCATE_M = 25

export function retargetMotionTrack(
  track: MotionTrack | null,
  motion: VehicleMotion,
  nowMs: number,
  /**
   * Route chainage of where the arrow is drawn right now (first fix only):
   * a fresh track then starts from there and eases on, instead of hopping.
   */
  currentChainageMeters: number | null = null,
): MotionTrack {
  const speed = Number.isFinite(motion.speedMps) && motion.speedMps > 0 ? motion.speedMps : 0
  const fresh =
    !track ||
    track.geometry !== motion.geometry ||
    !Number.isFinite(track.shownChainageMeters) ||
    motion.chainageMeters < track.shownChainageMeters - MOTION_BACKWARD_RELOCATE_M ||
    Math.abs(motion.chainageMeters - track.shownChainageMeters) > MOTION_SNAP_M
  let fixIntervalMs = track?.fixIntervalMs ?? MOTION_DEFAULT_FIX_INTERVAL_MS
  if (track && !fresh) {
    const interval = nowMs - track.baseAtMs
    if (interval > 50 && interval < 5000) fixIntervalMs = fixIntervalMs * 0.7 + interval * 0.3
  }
  return {
    geometry: motion.geometry,
    baseChainageMeters: motion.chainageMeters,
    // The display filter's speed is already learned from the real progress
    // (display-progress.ts), so it is used as is.
    speedMps: speed,
    baseAtMs: nowMs,
    fixIntervalMs,
    shownChainageMeters: fresh
      ? currentChainageMeters != null &&
        Number.isFinite(currentChainageMeters) &&
        currentChainageMeters <= motion.chainageMeters &&
        currentChainageMeters >= motion.chainageMeters - MOTION_BACKWARD_RELOCATE_M
        ? currentChainageMeters
        : motion.chainageMeters
      : track.shownChainageMeters,
  }
}

function horizonMs(track: MotionTrack): number {
  return Math.min(
    MOTION_MAX_HORIZON_MS,
    Math.max(MOTION_MIN_HORIZON_MS, track.fixIntervalMs * MOTION_HORIZON_FACTOR),
  )
}

/**
 * Effective extrapolation time: linear up to the horizon, then easing off
 * exponentially (a late fix makes the arrow slow down, never stop dead).
 */
function extrapolationMs(track: MotionTrack, elapsedMs: number): number {
  const horizon = horizonMs(track)
  const elapsed = Math.max(elapsedMs, 0)
  if (elapsed <= horizon) return elapsed
  return horizon + MOTION_EASE_OFF_MS * (1 - Math.exp(-(elapsed - horizon) / MOTION_EASE_OFF_MS))
}

/** Speed factor (0..1) of the extrapolation at this moment. */
function extrapolationRate(track: MotionTrack, elapsedMs: number): number {
  const horizon = horizonMs(track)
  const elapsed = Math.max(elapsedMs, 0)
  return elapsed <= horizon ? 1 : Math.exp(-(elapsed - horizon) / MOTION_EASE_OFF_MS)
}

export function motionTargetChainage(track: MotionTrack, nowMs: number): number {
  return Math.min(
    track.baseChainageMeters + (track.speedMps * extrapolationMs(track, nowMs - track.baseAtMs)) / 1000,
    track.geometry.totalLengthMeters,
  )
}

export function sampleMotionTrack(
  track: MotionTrack,
  nowMs: number,
  frameMs: number,
): { track: MotionTrack; chainageMeters: number; moving: boolean } {
  const dt = Math.max(frameMs, 0)
  const target = motionTargetChainage(track, nowMs)
  const shownBefore = track.shownChainageMeters
  let shown: number
  if (Math.abs(target - shownBefore) > MOTION_SNAP_M) {
    shown = target
  } else {
    // Dead-reckon at the car's speed, then steer the remaining error away.
    const rate = extrapolationRate(track, nowMs - track.baseAtMs)
    const advanced = shownBefore + (track.speedMps * rate * dt) / 1000
    const corrected = advanced + (target - advanced) * (1 - Math.exp(-dt / MOTION_CORRECTION_MS))
    shown = Math.max(shownBefore, Math.min(corrected, track.geometry.totalLengthMeters))
  }
  const moving =
    track.speedMps * extrapolationRate(track, nowMs - track.baseAtMs) > 0.05 || target - shown > 0.05
  return { track: { ...track, shownChainageMeters: shown }, chainageMeters: shown, moving }
}
