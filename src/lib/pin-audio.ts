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
