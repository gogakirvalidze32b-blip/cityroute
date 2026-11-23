/**
 * Route-chainage progress for the exam HUD კმ / speed bands.
 *
 * Distance is always along-route chainage (meters from route start), never
 * accumulated GPS path length. Suspicious match jumps are rejected so the
 * last valid chainage is preserved until recovery or a confirmed PIN anchor.
 */

export type ChainageProgressDecision =
  | { readonly action: 'adopt'; readonly chainageMeters: number }
  | {
      readonly action: 'freeze'
      readonly chainageMeters: number
      readonly reason: 'no-match' | 'implausible-jump' | 'invalid-candidate'
    }
  | { readonly action: 'pin-anchor'; readonly chainageMeters: number }

export type ChainageStepOptions = {
  /** Last accepted / frozen chainage (meters). */
  readonly previousChainageMeters: number
  /** Candidate chainage from route match (meters). */
  readonly candidateChainageMeters: number
  /** Elapsed time since the previous locked fix (ms). */
  readonly elapsedMs: number
  /** Max along-route speed used for plausibility (m/s). Default 55. */
  readonly maxSpeedMetersPerSecond?: number
  /** Extra slack added to the forward budget (m). Default 40. */
  readonly forwardSlackMeters?: number
  /** Allowed small reverse wobble (m). Default 30. */
  readonly maxReverseMeters?: number
}

const DEFAULT_MAX_SPEED_MPS = 55
const DEFAULT_FORWARD_SLACK_M = 40
const DEFAULT_MAX_REVERSE_M = 30

export function isPlausibleChainageStep(options: ChainageStepOptions): boolean {
  const previous = options.previousChainageMeters
  const candidate = options.candidateChainageMeters
  if (!Number.isFinite(previous) || !Number.isFinite(candidate)) return false
  if (candidate < 0) return false

  const delta = candidate - previous
  const maxReverse = options.maxReverseMeters ?? DEFAULT_MAX_REVERSE_M
  if (delta < -maxReverse) return false

  const maxSpeed = options.maxSpeedMetersPerSecond ?? DEFAULT_MAX_SPEED_MPS
  const slack = options.forwardSlackMeters ?? DEFAULT_FORWARD_SLACK_M
  const elapsedMs = Number.isFinite(options.elapsedMs) ? Math.max(0, options.elapsedMs) : 0
  const allowedForward = maxSpeed * (elapsedMs / 1000) + slack
  if (delta > allowedForward) return false
  return true
}

/**
 * Decide whether an accepted route-match chainage should update HUD progress.
 * When there is no previous lock yet, the first finite candidate is adopted.
 */
export function decideChainageFromMatch(options: {
  readonly previousChainageMeters: number | null
  readonly candidateChainageMeters: number | null | undefined
  readonly matchAccepted: boolean
  readonly elapsedMs: number
  readonly maxSpeedMetersPerSecond?: number
  readonly forwardSlackMeters?: number
  readonly maxReverseMeters?: number
}): ChainageProgressDecision {
  const previous =
    options.previousChainageMeters != null && Number.isFinite(options.previousChainageMeters)
      ? Math.max(0, options.previousChainageMeters)
      : null
  const candidate = options.candidateChainageMeters

  if (!options.matchAccepted || candidate == null || !Number.isFinite(candidate) || candidate < 0) {
    return {
      action: 'freeze',
      chainageMeters: previous ?? 0,
      reason: previous == null ? 'no-match' : 'no-match',
    }
  }

  if (previous == null) {
    return { action: 'adopt', chainageMeters: candidate }
  }

  if (
    !isPlausibleChainageStep({
      previousChainageMeters: previous,
      candidateChainageMeters: candidate,
      elapsedMs: options.elapsedMs,
      maxSpeedMetersPerSecond: options.maxSpeedMetersPerSecond,
      forwardSlackMeters: options.forwardSlackMeters,
      maxReverseMeters: options.maxReverseMeters,
    })
  ) {
    return { action: 'freeze', chainageMeters: previous, reason: 'implausible-jump' }
  }

  return { action: 'adopt', chainageMeters: candidate }
}

/** Confirmed PIN recovery: exact predefined route chainage (no 0.1 rounding). */
export function decideChainageFromPinAnchor(pinChainageMeters: number): ChainageProgressDecision {
  if (!Number.isFinite(pinChainageMeters) || pinChainageMeters < 0) {
    return { action: 'freeze', chainageMeters: 0, reason: 'invalid-candidate' }
  }
  return { action: 'pin-anchor', chainageMeters: pinChainageMeters }
}

/** One GPS→route projection candidate used while seeding HUD chainage. */
export type SeedProjectionCandidate = {
  readonly chainageMeters: number
  readonly crossTrackMeters: number
}

export type SeedChainageDecision =
  | { readonly action: 'pin-exact'; readonly chainageMeters: number }
  | { readonly action: 'adopt'; readonly chainageMeters: number }
  | { readonly action: 'preserve-hint'; readonly chainageMeters: number }
  | { readonly action: 'none'; readonly chainageMeters: 0 }

const DEFAULT_MAX_PIN_EXACT_M = 40
/** Accept a non-nearest pass only when nearly as on-road as the geographic nearest. */
const DEFAULT_COMPETITIVE_XT_SLACK_M = 5
/** Hint/previous pass may be used when still on-road (dual carriage / out-and-back). */
const DEFAULT_MAX_ON_ROUTE_XT_M = 25

/**
 * Resolve GPS seed chainage without letting a distant expected-PIN window pull
 * the fix onto a parallel / ambiguous route section.
 *
 * Priority:
 * 1. Exact PIN chainage only when GPS is actually on the pin.
 * 2. Among on-road projections, prefer continuity with hint / previous chainage.
 * 3. Reject pin-window projections that are far off-road vs nearest, or that are
 *    an implausible jump from the GPS-nearest / hint chainage.
 * 4. If still ambiguous but a seek/previous hint exists, preserve that hint.
 */
export function resolveGpsSeedChainageMeters(options: {
  readonly nearest: SeedProjectionCandidate | null | undefined
  readonly pinAnchored?: SeedProjectionCandidate | null
  readonly hintAnchored?: SeedProjectionCandidate | null
  readonly exactPinChainageMeters?: number | null
  readonly distanceToPinMeters?: number | null
  readonly hintChainageMeters?: number | null
  readonly maxPinExactMeters?: number
  readonly competitiveCrossTrackSlackMeters?: number
  readonly maxOnRouteCrossTrackMeters?: number
}): SeedChainageDecision {
  const maxPinExact = options.maxPinExactMeters ?? DEFAULT_MAX_PIN_EXACT_M
  const xtSlack = options.competitiveCrossTrackSlackMeters ?? DEFAULT_COMPETITIVE_XT_SLACK_M
  const maxOnRouteXt = options.maxOnRouteCrossTrackMeters ?? DEFAULT_MAX_ON_ROUTE_XT_M

  const exactPin =
    options.exactPinChainageMeters != null && Number.isFinite(options.exactPinChainageMeters)
      ? Math.max(0, options.exactPinChainageMeters)
      : null
  const distToPin =
    options.distanceToPinMeters != null && Number.isFinite(options.distanceToPinMeters)
      ? options.distanceToPinMeters
      : null
  const hint =
    options.hintChainageMeters != null && Number.isFinite(options.hintChainageMeters)
      ? Math.max(0, options.hintChainageMeters)
      : null

  if (exactPin != null && distToPin != null && distToPin <= maxPinExact) {
    return { action: 'pin-exact', chainageMeters: exactPin }
  }

  const nearest = finiteCandidate(options.nearest)
  const hintAnchored = finiteCandidate(options.hintAnchored)
  const pinAnchored = finiteCandidate(options.pinAnchored)

  const continuityBase = hint ?? nearest?.chainageMeters ?? null

  const pinOk =
    pinAnchored != null &&
    pinAnchored.crossTrackMeters <= maxOnRouteXt &&
    (nearest == null ||
      pinAnchored.crossTrackMeters <= nearest.crossTrackMeters + xtSlack) &&
    (continuityBase == null ||
      isPlausibleChainageStep({
        previousChainageMeters: continuityBase,
        candidateChainageMeters: pinAnchored.chainageMeters,
        elapsedMs: 0,
      }))

  const hintOk =
    hintAnchored != null &&
    hintAnchored.crossTrackMeters <= maxOnRouteXt &&
    (nearest == null ||
      hintAnchored.crossTrackMeters <= nearest.crossTrackMeters + xtSlack ||
      // Dual-pass plazas: geographic nearest may be the opposing occurrence;
      // an on-route hint snap is still authoritative for demo seek / resume.
      (hint != null && hintAnchored.crossTrackMeters <= maxOnRouteXt))

  const candidates: SeedProjectionCandidate[] = []
  if (nearest) candidates.push(nearest)
  if (hintOk && hintAnchored) candidates.push(hintAnchored)
  if (pinOk && pinAnchored) candidates.push(pinAnchored)

  if (candidates.length === 0) {
    if (hint != null) return { action: 'preserve-hint', chainageMeters: hint }
    return { action: 'none', chainageMeters: 0 }
  }

  const minXt = Math.min(...candidates.map((c) => c.crossTrackMeters))
  const competitive = candidates.filter((c) => c.crossTrackMeters <= minXt + xtSlack)

  if (hint != null) {
    // Prefer the on-route hint snap when present — it encodes the seek/previous pass.
    if (hintOk && hintAnchored) {
      return { action: 'adopt', chainageMeters: hintAnchored.chainageMeters }
    }
    const closestToHint = competitive.reduce((best, c) =>
      Math.abs(c.chainageMeters - hint) < Math.abs(best.chainageMeters - hint) ? c : best,
    )
    // If every competitive projection is still far from the known hint, do not
    // invent progress — preserve the last valid / seek chainage.
    if (
      !isPlausibleChainageStep({
        previousChainageMeters: hint,
        candidateChainageMeters: closestToHint.chainageMeters,
        elapsedMs: 0,
      })
    ) {
      return { action: 'preserve-hint', chainageMeters: hint }
    }
    return { action: 'adopt', chainageMeters: closestToHint.chainageMeters }
  }

  // No hint: never prefer a pin-window pull over a clearly nearer on-road fix.
  if (nearest) {
    if (
      pinOk &&
      pinAnchored &&
      isPlausibleChainageStep({
        previousChainageMeters: nearest.chainageMeters,
        candidateChainageMeters: pinAnchored.chainageMeters,
        elapsedMs: 0,
      })
    ) {
      return { action: 'adopt', chainageMeters: pinAnchored.chainageMeters }
    }
    return { action: 'adopt', chainageMeters: nearest.chainageMeters }
  }

  if (pinOk && pinAnchored) {
    return { action: 'adopt', chainageMeters: pinAnchored.chainageMeters }
  }

  return { action: 'none', chainageMeters: 0 }
}

function finiteCandidate(
  value: SeedProjectionCandidate | null | undefined,
): SeedProjectionCandidate | null {
  if (
    !value ||
    !Number.isFinite(value.chainageMeters) ||
    value.chainageMeters < 0 ||
    !Number.isFinite(value.crossTrackMeters) ||
    value.crossTrackMeters < 0
  ) {
    return null
  }
  return value
}
