import { headingMatches, type LatLng } from '@/lib/gps'
import { gpsFixCanConfirmPin, type CueDecision } from '@/lib/pin-cue'

const STORAGE_KEY = 'cityroute-pin-debug'

/** `?pindebug=1` turns the on-screen pin diagnostics on (kept across reloads), `?pindebug=0` off. */
export function readPinDebugFlag(search: string, storage: Storage | null): boolean {
  const value = new URLSearchParams(search).get('pindebug')
  try {
    if (value === '1') storage?.setItem(STORAGE_KEY, '1')
    if (value === '0') storage?.removeItem(STORAGE_KEY)
    return storage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return value === '1'
  }
}

export type PinCueReason = 'play' | 'in-flight' | 'far' | 'heading' | 'accuracy' | 'none'

export const PIN_CUE_REASON_TEXT: Record<PinCueReason, string> = {
  play: 'ირთვება',
  'in-flight': 'აუდიო უკვე რიგშია',
  far: 'ტრიგერის ზონის გარეთ',
  heading: 'მიმართულება არ ემთხვევა',
  accuracy: 'GPS სიზუსტე არასაკმარისია',
  none: 'შემდეგი PIN არ არის',
}

export type PinCueDiagnostic = {
  reason: PinCueReason
  bearingToPin: number | null
  headingDiff: number | null
  facing: boolean
  accuracyOk: boolean
}

function bearingDeg(from: LatLng, to: LatLng): number {
  const φ1 = (from[0] * Math.PI) / 180
  const φ2 = (to[0] * Math.PI) / 180
  const Δλ = ((to[1] - from[1]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

/** Explains a decision from evaluateNextPin for display. Does not change the decision. */
export function describePinCue(args: {
  decision: CueDecision
  pin: { lat: number; lng: number } | null
  user: LatLng
  heading: number | null
  accuracyM: number | null
  inFlight: boolean
}): PinCueDiagnostic {
  const { decision, pin } = args
  if (!pin || decision.pinId == null || decision.triggerM == null) {
    return { reason: 'none', bearingToPin: null, headingDiff: null, facing: true, accuracyOk: true }
  }
  const pinAt: LatLng = [pin.lat, pin.lng]
  const bearingToPin = bearingDeg(args.user, pinAt)
  const hasHeading = args.heading != null && !Number.isNaN(args.heading)
  let headingDiff: number | null = null
  if (hasHeading) {
    const diff = Math.abs(bearingToPin - (args.heading as number)) % 360
    headingDiff = diff > 180 ? 360 - diff : diff
  }
  const facing = headingMatches(args.user, pinAt, args.heading)
  const accuracyOk = gpsFixCanConfirmPin(args.accuracyM, decision.triggerM)
  let reason: PinCueReason
  if (decision.action === 'play') reason = 'play'
  else if (args.inFlight) reason = 'in-flight'
  else if ((decision.distanceM ?? Infinity) > decision.triggerM) reason = 'far'
  else if (!facing) reason = 'heading'
  else if (!accuracyOk) reason = 'accuracy'
  else reason = 'in-flight'
  return { reason, bearingToPin, headingDiff, facing, accuracyOk }
}
