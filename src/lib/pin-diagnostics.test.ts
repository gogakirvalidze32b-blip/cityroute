import { afterEach, describe, expect, it } from 'vitest'
import { evaluateNextPin } from '@/lib/pin-cue'
import { describePinCue, readPinDebugFlag } from '@/lib/pin-diagnostics'
import type { LatLng } from '@/lib/gps'

const pin = { id: 'p1-2', lat: 41.930785, lng: 45.475972, trigger_distance_m: 50 }
const north: LatLng = [pin.lat + 0.0003, pin.lng]
const south: LatLng = [pin.lat - 0.0003, pin.lng]

function explain(user: LatLng, heading: number | null, accuracyM: number) {
  const decision = evaluateNextPin({
    pins: [pin],
    handledIds: new Set(),
    inFlightId: null,
    user,
    heading,
    speedMps: 5,
    accuracyM,
    approach: null,
  })
  return { decision, diag: describePinCue({ decision, pin, user, heading, accuracyM, inFlight: false }) }
}

describe('pin diagnostics', () => {
  afterEach(() => localStorage.clear())

  it('agrees with the pin decision and names the blocking condition', () => {
    const approaching = explain(north, 180, 8)
    expect(approaching.decision.action).toBe('play')
    expect(approaching.diag.reason).toBe('play')

    const drivingAway = explain(south, 180, 8)
    expect(drivingAway.decision.action).toBe('wait')
    expect(drivingAway.diag.reason).toBe('heading')
    expect(drivingAway.diag.headingDiff).toBeGreaterThan(170)

    const coarse = explain(north, 180, 80)
    expect(coarse.decision.action).toBe('wait')
    expect(coarse.diag.reason).toBe('accuracy')

    const far = explain([pin.lat + 0.01, pin.lng], 180, 8)
    expect(far.diag.reason).toBe('far')

    const noHeading = explain(south, null, 8)
    expect(noHeading.decision.action).toBe('play')
    expect(noHeading.diag.headingDiff).toBeNull()
  })

  it('is off unless turned on with ?pindebug=1 and stays on until ?pindebug=0', () => {
    expect(readPinDebugFlag('', localStorage)).toBe(false)
    expect(readPinDebugFlag('?pindebug=1', localStorage)).toBe(true)
    expect(readPinDebugFlag('', localStorage)).toBe(true)
    expect(readPinDebugFlag('?pindebug=0', localStorage)).toBe(false)
    expect(readPinDebugFlag('', localStorage)).toBe(false)
  })
})
