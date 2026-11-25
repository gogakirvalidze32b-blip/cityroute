import { forwardBearingAlongRoute, type PreparedRouteGeometry } from '@/lib/pure-route-geometry'

/**
 * Vehicle-arrow heading helpers (arrow ONLY — no PIN / km / speed-zone logic).
 *
 * The arrow heading is a pure function of the arrow's along-route chainage
 * (forwardBearingAlongRoute). Two things used to make it wrong:
 *  1. A 10°-per-GPS-fix slew cap: a 90° corner needs 9 fixes, the car has
 *     already driven 75–125 m by then, so the arrow stayed diagonal.
 *  2. The raw matched chainage could hop forward onto the opposing pass at a
 *     hairpin for a fix or two, flipping the arrow ~110°.
 *
 * This module supplies the arrow-only chainage guard and the tuned constants.
 */

/** Look-ahead used to sample the forward road direction (unchanged: 14 m). */
export const ARROW_LOOK_AHEAD_M = 14
/** Ignore heading changes below this (GPS wobble on straights). */
export const ARROW_DEADBAND_DEG = 3
/**
 * Per-update heading cap. The target is already a continuous function of
 * chainage, so this only has to stop numeric flips; it must NOT throttle real
 * turns (it used to be 10°/fix).
 */
export const ARROW_MAX_STEP_DEG = 180

export type ArrowChainageState = {
  readonly chainageMeters: number
  readonly timestampMs: number
  /** Smoothed along-route speed (m/s). */
  readonly speedMps: number
}

const DEFAULT_SPEED_MPS = 15
const MAX_SPEED_MPS = 40
const GAP_RESET_MS = 8_000
const REBASE_BACKWARD_M = 30
const ADVANCE_SLACK_M = 8
const SPEED_HEADROOM = 1.6

/**
 * Arrow-only guard on the matched chainage:
 *  - never moves backward (small GPS regressions are ignored);
 *  - forward jumps are limited to what the observed speed allows, so a single
 *    bad match onto the opposing pass cannot spin the arrow;
 *  - after a long gap, or a large genuine re-lock (>30 m back), it re-bases.
 * Does NOT alter the HUD km / chainage progress, which stays in the caller.
 */
export function advanceArrowChainage(
  previous: ArrowChainageState | null,
  candidateChainageMeters: number,
  timestampMs: number,
): ArrowChainageState {
  if (!Number.isFinite(candidateChainageMeters) || !Number.isFinite(timestampMs)) {
    return previous ?? { chainageMeters: 0, timestampMs: 0, speedMps: DEFAULT_SPEED_MPS }
  }
  if (!previous) {
    return { chainageMeters: candidateChainageMeters, timestampMs, speedMps: DEFAULT_SPEED_MPS }
  }
  const dtMs = timestampMs - previous.timestampMs
  if (dtMs <= 0) return previous
  if (dtMs > GAP_RESET_MS) {
    return { chainageMeters: candidateChainageMeters, timestampMs, speedMps: previous.speedMps }
  }
  const delta = candidateChainageMeters - previous.chainageMeters
  if (delta < -REBASE_BACKWARD_M) {
    return { chainageMeters: candidateChainageMeters, timestampMs, speedMps: previous.speedMps }
  }
  const dtSec = dtMs / 1000
  const maxAdvance = Math.max(4, previous.speedMps * SPEED_HEADROOM) * dtSec + ADVANCE_SLACK_M
  const advance = Math.min(Math.max(0, delta), maxAdvance)
  const observed = Math.min(MAX_SPEED_MPS, advance / dtSec)
  const speedMps = previous.speedMps * 0.6 + observed * 0.4
  return { chainageMeters: previous.chainageMeters + advance, timestampMs, speedMps }
}

/**
 * Time-based heading slew for the map's per-frame loop. Moves `current` toward
 * `next` (already eased) but never faster than `maxDegPerSecond`, so a new GPS
 * fix at a corner rotates the arrow smoothly instead of snapping in ~0.2 s.
 * Shortest-arc, 0°/360° safe. Frame-rate independent.
 */
export const ARROW_MAX_ROTATION_DEG_PER_S = 240

export function limitHeadingStep(
  currentDeg: number,
  nextDeg: number,
  elapsedMs: number,
  maxDegPerSecond = ARROW_MAX_ROTATION_DEG_PER_S,
): number {
  if (!Number.isFinite(currentDeg)) return ((nextDeg % 360) + 360) % 360
  if (!Number.isFinite(nextDeg)) return currentDeg
  const turn = ((nextDeg - currentDeg + 540) % 360) - 180
  const maxStep = Math.max(0, maxDegPerSecond) * (Math.max(0, elapsedMs) / 1000)
  const step = Math.sign(turn) * Math.min(Math.abs(turn), maxStep)
  return (((currentDeg + step) % 360) + 360) % 360
}

// ---------------------------------------------------------------------------
// Wrong-pass self-correction (arrow only)
//
// Exam routes revisit the same street in opposite directions (gap ~0–1 m), so
// a position alone cannot tell which pass the car is on. If the session's
// chainage sits on the wrong pass, the arrow would face 180° backwards for the
// whole stretch. The real direction of travel (GPS track) is the tie-breaker.
// This only changes the chainage the ARROW heading reads — never HUD km, PIN
// progress, audio or match state.
// ---------------------------------------------------------------------------

type LL = readonly [number, number]
const EARTH_R = 6371008.8
const DEG = Math.PI / 180

function toXY(origin: LL, p: LL): [number, number] {
  return [(p[1] - origin[1]) * DEG * EARTH_R * Math.cos(origin[0] * DEG), (p[0] - origin[0]) * DEG * EARTH_R]
}
function bearingXY(dx: number, dy: number): number {
  return ((Math.atan2(dx, dy) / DEG) + 360) % 360
}
function turnBetween(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180
}

export type RoutePassCandidate = { readonly chainageMeters: number; readonly crossTrackMeters: number }

/** Every distinct pass of the route within `maxCrossTrackMeters` of `position`. */
export function routePassCandidates(
  geometry: PreparedRouteGeometry,
  position: LL,
  maxCrossTrackMeters = 15,
): RoutePassCandidate[] {
  const c = geometry.coordinates
  const cum = geometry.cumulativeMeters
  const raw: RoutePassCandidate[] = []
  for (let i = 0; i < c.length - 1; i += 1) {
    const a = toXY(position, c[i] as LL)
    const b = toXY(position, c[i + 1] as LL)
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2)) : 0
    const d = Math.hypot(a[0] + dx * t, a[1] + dy * t)
    if (d <= maxCrossTrackMeters) {
      raw.push({ chainageMeters: cum[i] + t * (cum[i + 1] - cum[i]), crossTrackMeters: d })
    }
  }
  raw.sort((x, y) => x.chainageMeters - y.chainageMeters)
  const out: RoutePassCandidate[] = []
  for (const r of raw) {
    const last = out[out.length - 1]
    if (last && r.chainageMeters - last.chainageMeters <= 60) {
      if (r.crossTrackMeters < last.crossTrackMeters) out[out.length - 1] = r
    } else {
      out.push(r)
    }
  }
  return out
}

export type ArrowTrackPoint = { readonly position: LL; readonly timestampMs: number }

export type ArrowTrackerState = {
  readonly chain: ArrowChainageState
  /** true once the arrow follows its own pass instead of the session's chainage. */
  readonly override: boolean
  readonly votes: number
  readonly track: readonly ArrowTrackPoint[]
}

const TRACK_MAX_AGE_MS = 15_000
const TRAVEL_MIN_BASELINE_M = 25
const TRAVEL_MAX_BASELINE_M = 120
const TRAVEL_MAX_DEVIATION_M = 7
const WRONG_PASS_MIN_DISAGREE_DEG = 120
const WRONG_PASS_MAX_CANDIDATE_DEG = 50
const WRONG_PASS_VOTES = 2
const SAME_PASS_M = 60
const MERGE_BACK_M = 40

/** Bearing of straight-ish recent movement (≥25 m baseline), else null. */
export function recentTravelBearing(track: readonly ArrowTrackPoint[], current: LL): number | null {
  for (let i = track.length - 1; i >= 0; i -= 1) {
    const [x, y] = toXY(current, track[i].position)
    const dist = Math.hypot(x, y)
    if (dist < TRAVEL_MIN_BASELINE_M) continue
    if (dist > TRAVEL_MAX_BASELINE_M) return null
    for (let j = i + 1; j < track.length; j += 1) {
      const [px, py] = toXY(current, track[j].position)
      // perpendicular distance of the intermediate fix from the chord
      const dev = Math.abs(px * y - py * x) / dist
      if (dev > TRAVEL_MAX_DEVIATION_M) return null
    }
    return bearingXY(-x, -y)
  }
  return null
}

/** Chainage of the other pass whose direction matches the car's real travel, or null. */
export function detectWrongPassChainage(
  geometry: PreparedRouteGeometry,
  position: LL,
  track: readonly ArrowTrackPoint[],
  arrowChainageMeters: number,
): number | null {
  const travel = recentTravelBearing(track, position)
  if (travel == null) return null
  const here = forwardBearingAlongRoute(geometry, arrowChainageMeters, ARROW_LOOK_AHEAD_M)
  if (here == null || Math.abs(turnBetween(here, travel)) < WRONG_PASS_MIN_DISAGREE_DEG) return null
  let best: { ch: number; diff: number } | null = null
  for (const cand of routePassCandidates(geometry, position, 15)) {
    if (Math.abs(cand.chainageMeters - arrowChainageMeters) <= SAME_PASS_M) continue
    const b = forwardBearingAlongRoute(geometry, cand.chainageMeters, ARROW_LOOK_AHEAD_M)
    if (b == null) continue
    const diff = Math.abs(turnBetween(b, travel))
    if (diff < WRONG_PASS_MAX_CANDIDATE_DEG && (!best || diff < best.diff)) best = { ch: cand.chainageMeters, diff }
  }
  return best ? best.ch : null
}

/**
 * One GPS fix of arrow-only chainage tracking. Normal mode follows the session's
 * matched chainage (guarded). If the car's real direction of travel disagrees
 * with the arrow's pass on two consecutive fixes and another pass of the same
 * road agrees, the arrow switches pass and tracks it by local projection until
 * the session's chainage agrees again.
 */
export function stepArrowTracker(
  state: ArrowTrackerState | null,
  input: {
    readonly geometry: PreparedRouteGeometry
    readonly position: LL
    readonly matchedChainageMeters: number | null
    readonly timestampMs: number
  },
): ArrowTrackerState | null {
  const { geometry, position, matchedChainageMeters, timestampMs } = input
  const track = [...(state?.track ?? []), { position, timestampMs }]
    .filter((p) => timestampMs - p.timestampMs <= TRACK_MAX_AGE_MS)
    .slice(-20)
  const hasMatch = matchedChainageMeters != null && Number.isFinite(matchedChainageMeters)
  let chain = state?.chain ?? null
  let override = state?.override ?? false
  let votes = state?.votes ?? 0

  if (!chain) {
    if (!hasMatch) return null
    chain = advanceArrowChainage(null, matchedChainageMeters as number, timestampMs)
    return { chain, override: false, votes: 0, track }
  }

  if (override) {
    const dtSec = Math.max(0, (timestampMs - chain.timestampMs) / 1000)
    const expected = chain.chainageMeters + chain.speedMps * dtSec
    const window = 40 + chain.speedMps * dtSec * 1.5
    let local: RoutePassCandidate | null = null
    for (const cand of routePassCandidates(geometry, position, 15)) {
      if (Math.abs(cand.chainageMeters - expected) > window) continue
      if (!local || Math.abs(cand.chainageMeters - expected) < Math.abs(local.chainageMeters - expected)) local = cand
    }
    if (local) chain = advanceArrowChainage(chain, local.chainageMeters, timestampMs)
    if (hasMatch && Math.abs((matchedChainageMeters as number) - chain.chainageMeters) <= MERGE_BACK_M) {
      override = false
    }
    return { chain, override, votes: 0, track }
  }

  if (hasMatch) chain = advanceArrowChainage(chain, matchedChainageMeters as number, timestampMs)
  const wrong = detectWrongPassChainage(geometry, position, track, chain.chainageMeters)
  votes = wrong != null ? votes + 1 : 0
  if (wrong != null && votes >= WRONG_PASS_VOTES) {
    chain = { chainageMeters: wrong, timestampMs, speedMps: chain.speedMps }
    return { chain, override: true, votes: 0, track }
  }
  return { chain, override, votes, track }
}
