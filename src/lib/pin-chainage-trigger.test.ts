import { describe, expect, it } from 'vitest'
import {
  chainagePinTableProblems,
  decideChainageTrigger,
  INITIAL_CHAINAGE_TRIGGER_STATE,
  PIN_PASS_TOLERANCE_M,
  type ChainagePin,
  type ChainageTriggerState,
} from './pin-chainage-trigger'

// Straight north-going road: 1 m chainage = 1 m north.
const LAT0 = 41.9
const LNG0 = 45.47
const M_PER_DEG = 111_195
const at = (meters: number, eastM = 0): [number, number] => [
  LAT0 + meters / M_PER_DEG,
  LNG0 + eastM / (M_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)),
]
const pin = (sortOrder: number, chainageMeters: number, leadMeters = 10, eastM = 0): ChainagePin => {
  const [lat, lng] = at(chainageMeters, eastM)
  return { sortOrder, chainageMeters, leadMeters, lat, lng }
}

const PINS = [pin(1, 15, 15), pin(2, 200), pin(3, 400), pin(4, 420), pin(5, 900, 20)]

function step(
  progress: number,
  done: Set<number>,
  state: ChainageTriggerState = INITIAL_CHAINAGE_TRIGGER_STATE,
  options: { accepted?: boolean; crossTrack?: number; gps?: [number, number] } = {},
) {
  return decideChainageTrigger({
    pins: PINS,
    done,
    progressAccepted: options.accepted ?? true,
    progressMeters: progress,
    crossTrackMeters: options.crossTrack ?? 2,
    gpsPosition: options.gps ?? at(progress),
    state,
  })
}

/** Drive a progress sequence; returns spoken and silently passed orders in event order. */
function drive(progresses: readonly (number | null)[], gpsEastM = 0) {
  const done = new Set<number>()
  let state = INITIAL_CHAINAGE_TRIGGER_STATE
  const events: string[] = []
  for (const progress of progresses) {
    const decision =
      progress === null
        ? step(0, done, state, { accepted: false })
        : step(progress, done, state, { gps: at(progress, gpsEastM) })
    state = decision.state
    for (const order of decision.passSilently) {
      done.add(order)
      events.push(`pass:${order}`)
    }
    if (decision.play !== null) {
      done.add(decision.play)
      events.push(`play:${decision.play}`)
    }
  }
  return events
}

describe('decideChainageTrigger', () => {
  it('fires exactly at chainage − lead, not before', () => {
    expect(step(189.9, new Set([1])).play).toBeNull()
    expect(step(190, new Set([1])).play).toBe(2)
  })

  it('never fires a PIN twice and keeps forward order', () => {
    const events = drive([0, 5, 15, 40, 190, 191, 195, 210, 390, 395, 410, 415, 880, 890])
    expect(events).toEqual(['play:1', 'play:2', 'play:3', 'play:4', 'play:5'])
  })

  it('ignores backward jitter after a PIN was handled', () => {
    expect(drive([0, 195, 180, 196, 170, 199])).toEqual(['play:1', 'play:2'])
  })

  it('does not depend on landing inside a small bubble: sparse 70 m steps still speak every PIN', () => {
    // Steps chosen so every PIN trigger point is crossed between fixes.
    expect(drive([0, 70, 140, 210, 280, 350, 420, 490, 560, 630, 700, 770, 840, 910])).toEqual([
      'play:1',
      'play:2',
      'pass:3',
      'play:4',
      'play:5',
    ])
  })

  it('plays only the latest relevant PIN when several are passed between fixes', () => {
    // From 300 straight to 425: #3 (400) is passed by 25 m → still relevant, but #4 (420) is latest.
    expect(drive([0, 199, 300, 425])).toEqual(['play:1', 'play:2', 'pass:3', 'play:4'])
  })

  it('never speaks an outdated PIN after a GPS outage; confirms on two fixes first', () => {
    // Outage from 150 to 260: PIN 2 (200) is now 60 m behind.
    const events = drive([0, 100, 150, null, null, null, 260, 270, 280])
    expect(events).toEqual(['play:1', 'pass:2'])
    expect(events).not.toContain('play:2')
  })

  it(`treats a PIN passed by ≤ ${PIN_PASS_TOLERANCE_M} m as still relevant (late, not lost)`, () => {
    expect(drive([0, 150, 229])).toEqual(['play:1', 'play:2'])
  })

  it('holds (never speaks) when route progress is near a PIN but GPS is physically far away (wrong pass)', () => {
    const decision = step(200, new Set([1]), INITIAL_CHAINAGE_TRIGGER_STATE, { gps: at(200, 150) })
    expect(decision.play).toBeNull()
    expect(decision.hold).toBe('position-mismatch')
    expect(decision.passSilently).toEqual([])
  })

  it('never speaks on a progress snap that is not physically consistent with the fix (Route 2 #8 case)', () => {
    // Progress 192 (≥ 200 − 10) but the fix is 44 m from that route point → hold, no audio.
    const early = step(192, new Set([1]), INITIAL_CHAINAGE_TRIGGER_STATE, { crossTrack: 44, gps: at(148) })
    expect(early.play).toBeNull()
    expect(early.hold).toBe('off-route-match')
    // Next consistent fix speaks it.
    expect(step(193, new Set([1]), early.state, { crossTrack: 4 }).play).toBe(2)
  })

  it('never speaks or silently passes on the opposite carriageway (heading ~180° off the route)', () => {
    const opposite = { gpsHeadingDegrees: 180, gpsSpeedMps: 12, routeBearingDegrees: 0 }
    const speak = decideChainageTrigger({
      pins: PINS, done: new Set([1]), progressAccepted: true, progressMeters: 195,
      crossTrackMeters: 8, gpsPosition: at(195), state: INITIAL_CHAINAGE_TRIGGER_STATE, ...opposite,
    })
    expect(speak.play).toBeNull()
    expect(speak.hold).toBe('direction-mismatch')
    const pass = decideChainageTrigger({
      pins: PINS, done: new Set([1]), progressAccepted: true, progressMeters: 300,
      crossTrackMeters: 8, gpsPosition: at(300), state: { confirmOrder: 2, confirmations: 5 }, ...opposite,
    })
    expect(pass.passSilently).toEqual([])
    // Same fix travelling forward speaks; a slow / heading-less fix is not blocked.
    expect(decideChainageTrigger({
      pins: PINS, done: new Set([1]), progressAccepted: true, progressMeters: 195, crossTrackMeters: 8,
      gpsPosition: at(195), state: INITIAL_CHAINAGE_TRIGGER_STATE,
      gpsHeadingDegrees: 20, gpsSpeedMps: 12, routeBearingDegrees: 0,
    }).play).toBe(2)
    expect(decideChainageTrigger({
      pins: PINS, done: new Set([1]), progressAccepted: true, progressMeters: 195, crossTrackMeters: 8,
      gpsPosition: at(195), state: INITIAL_CHAINAGE_TRIGGER_STATE,
      gpsHeadingDegrees: 180, gpsSpeedMps: 1, routeBearingDegrees: 0,
    }).play).toBe(2)
  })

  it('does not silently pass PINs on an off-road (high cross-track) match', () => {
    const decision = step(300, new Set([1]), { confirmOrder: 2, confirmations: 5 }, { crossTrack: 35 })
    expect(decision.passSilently).toEqual([])
    expect(decision.hold).toBe('awaiting-pass-confirmation')
  })

  it('ignores rejected / frozen matches and resumes on the next accepted fix', () => {
    expect(drive([0, null, null, 192])).toEqual(['play:1', 'play:2'])
  })

  it('reports done after the last PIN', () => {
    expect(step(5000, new Set([1, 2, 3, 4, 5])).hold).toBe('done')
  })

  it('handles a start mid-route: earlier PINs handled, next PIN fires at its own chainage only', () => {
    const done = new Set([1, 2])
    expect(step(380, done).play).toBeNull()
    expect(step(390, done).play).toBe(3)
  })
})

describe('chainagePinTableProblems', () => {
  it('accepts strictly increasing chainage', () => {
    expect(chainagePinTableProblems(PINS)).toEqual([])
  })

  it('reports non-increasing chainage and bad values instead of fixing them', () => {
    const problems = chainagePinTableProblems([pin(1, 15), pin(2, 10), pin(3, Number.NaN)])
    expect(problems.length).toBeGreaterThanOrEqual(2)
    expect(problems.join('\n')).toMatch(/#2: chainage 10\.0 m is not after #1/)
  })
})
