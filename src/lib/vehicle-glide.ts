/**
 * Visual vehicle glide (pure, display-only).
 *
 * Turns discrete accepted GPS positions into continuous on-screen motion: each
 * new target starts a constant-speed glide from wherever the arrow is NOW to the
 * new position, lasting about one GPS update interval, so the arrow keeps moving
 * between fixes instead of hopping and then waiting. It never feeds back into
 * GPS, route progress, chainage, PIN triggering or speed — it only decides
 * where the marker is DRAWN on a given animation frame.
 */
export type GlidePoint = readonly [number, number]

export type VehicleGlide = {
  readonly from: GlidePoint
  readonly to: GlidePoint
  /** Animation-frame time the current glide started (null = starts next frame). */
  readonly startFrameMs: number | null
  readonly durationMs: number
  /** Wall-clock time of the last accepted target. */
  readonly lastTargetWallMs: number | null
  /** Smoothed GPS update interval. */
  readonly intervalMs: number
}

/** Ignore target changes smaller than this (stationary GPS shimmer). */
export const GLIDE_DEADBAND_M = 0.4
/** Jumps larger than this are a relocation (resume, long GPS loss): snap. */
export const GLIDE_SNAP_M = 250
export const GLIDE_MIN_MS = 200
export const GLIDE_MAX_MS = 1200
const DEFAULT_INTERVAL_MS = 1000

export function metersBetweenPoints(a: GlidePoint, b: GlidePoint): number {
  const toRad = Math.PI / 180
  const dLat = (b[0] - a[0]) * toRad
  const dLng = (b[1] - a[1]) * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(Math.min(1, h)))
}

export function createVehicleGlide(position: GlidePoint): VehicleGlide {
  return {
    from: position,
    to: position,
    startFrameMs: null,
    durationMs: 0,
    lastTargetWallMs: null,
    intervalMs: DEFAULT_INTERVAL_MS,
  }
}

/**
 * A new accepted GPS position arrived. `displayed` is where the arrow is drawn
 * right now, so the new glide starts there (no visible jump).
 */
export function retargetVehicleGlide(
  glide: VehicleGlide,
  target: GlidePoint,
  displayed: GlidePoint,
  wallNowMs: number,
): VehicleGlide {
  if (metersBetweenPoints(glide.to, target) < GLIDE_DEADBAND_M) return glide
  const rawInterval =
    glide.lastTargetWallMs === null ? glide.intervalMs : Math.max(0, wallNowMs - glide.lastTargetWallMs)
  // Smooth irregular GPS intervals so one late/early fix does not change speed abruptly.
  const intervalMs = glide.lastTargetWallMs === null
    ? glide.intervalMs
    : glide.intervalMs * 0.5 + Math.min(rawInterval, 3000) * 0.5
  if (metersBetweenPoints(displayed, target) > GLIDE_SNAP_M) {
    return { from: target, to: target, startFrameMs: null, durationMs: 0, lastTargetWallMs: wallNowMs, intervalMs }
  }
  return {
    from: displayed,
    to: target,
    startFrameMs: null,
    durationMs: Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, intervalMs)),
    lastTargetWallMs: wallNowMs,
    intervalMs,
  }
}

export type GlideSample = {
  readonly glide: VehicleGlide
  readonly position: GlidePoint
  /** True once the arrow has reached the latest target. */
  readonly done: boolean
}

/** Where to draw the arrow on the animation frame at `frameMs`. */
export function sampleVehicleGlide(glide: VehicleGlide, frameMs: number): GlideSample {
  const started = glide.startFrameMs === null ? { ...glide, startFrameMs: frameMs } : glide
  if (started.durationMs <= 0) return { glide: started, position: started.to, done: true }
  const t = Math.min(1, Math.max(0, (frameMs - started.startFrameMs!) / started.durationMs))
  if (t >= 1) return { glide: started, position: started.to, done: true }
  // Constant speed (linear): consecutive glides chain into continuous motion.
  return {
    glide: started,
    position: [
      started.from[0] + (started.to[0] - started.from[0]) * t,
      started.from[1] + (started.to[1] - started.from[1]) * t,
    ],
    done: false,
  }
}
