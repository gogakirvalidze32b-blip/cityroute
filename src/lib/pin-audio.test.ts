import { describe, it, expect } from 'vitest'
import {
  AUDIO_HEADING_TOLERANCE_DEG,
  AUDIO_TRIGGER_DISTANCE_M,
  audioHeadingOk,
  decidePinAudio,
  recordSegmentApproach,
  segmentApproachMeters,
  AUDIO_SEGMENT_MAX_GAP_MS,
  AUDIO_SEGMENT_MAX_LENGTH_M,
  AUDIO_SEGMENT_MAX_SPEED_MPS,
  AUDIO_SEGMENT_NEAR_M,
  ROUTE3_PIN12_AFTER_ROAD_U,
  canTriggerRoute3Pin12,
  type PinAudioDecision,
  type TimedFix,
} from './pin-audio.ts'
import route3Road from '@/data/route-3-road.json'
import { distanceToPinMeters } from '@/lib/gps'

type Fix = { dists: number[]; ok?: boolean[] }

function makeRunner(ids: string[]) {
  const triggered = new Set<string>()
  const minDist = new Map<string, number>()
  const played: string[] = []
  return {
    triggered,
    played,
    step(fix: Fix, busy = false): PinAudioDecision | null {
      const d = decidePinAudio({
        pinIds: ids,
        triggered,
        distanceTo: (i) => fix.dists[i],
        headingOkAt: (i) => fix.ok?.[i] ?? true,
        minDist,
        busy,
      })
      if (d) {
        d.skipped.forEach((i) => triggered.add(ids[i]))
        triggered.add(ids[d.index])
        played.push(ids[d.index])
      }
      return d
    },
  }
}

describe('PinAudio', () => {
  it('audio constants: 20 m trigger, 90 heading tolerance', () => {
    expect(AUDIO_TRIGGER_DISTANCE_M).toBe(20)
    expect(AUDIO_HEADING_TOLERANCE_DEG).toBe(90)
  })

  describe('Route 3 PIN #12 roundabout pass gate', () => {
    it('ignores the early overlapping trace pass and enables the later pass after #11', () => {
      const pin12: [number, number] = [41.9183, 45.482891]
      const earlyPass = (route3Road as [number, number][])
        .slice(229, 232)
        .some((point) => distanceToPinMeters(point, pin12) <= 4)
      const laterPass = (route3Road as [number, number][])
        .slice(255, 258)
        .some((point) => distanceToPinMeters(point, pin12) <= 4)

      expect(earlyPass).toBe(true)
      expect(laterPass).toBe(true)
      expect(ROUTE3_PIN12_AFTER_ROAD_U).toBe(256)
      expect(canTriggerRoute3Pin12(255.99)).toBe(false)
      expect(canTriggerRoute3Pin12(256)).toBe(true)
      expect(canTriggerRoute3Pin12(null)).toBe(false)
    })
  })

  it('plays the next PIN at 20 m, not at 25 m', () => {
    const r = makeRunner(['a', 'b'])
    expect(r.step({ dists: [25, 300] })).toBe(null)
    expect(r.step({ dists: [19, 300] })?.reason).toBe('in-range')
    expect(r.played).toEqual(['a'])
  })

  it('heading gate: blocked when wrong direction while moving, ignored when almost stationary', () => {
    expect(audioHeadingOk(false, 8)).toBe(false)
    expect(audioHeadingOk(true, 8)).toBe(true)
    expect(audioHeadingOk(false, 0.3)).toBe(true)
    expect(audioHeadingOk(false, null)).toBe(false)
  })

  it('wrong heading alone does not lose the voice: it plays once the PIN is passed', () => {
    const r = makeRunner(['a', 'b'])
    expect(r.step({ dists: [15, 300], ok: [false, true] })).toBe(null)
    expect(r.step({ dists: [12, 300], ok: [false, true] })).toBe(null)
    const d = r.step({ dists: [26, 300], ok: [false, true] })
    expect(d?.reason).toBe('passed')
    expect(r.played).toEqual(['a'])
  })

  it('GPS gap: closest fix was 35 m before and 35 m after → voice still plays (late)', () => {
    const r = makeRunner(['a', 'b'])
    expect(r.step({ dists: [105, 400] })).toBe(null)
    expect(r.step({ dists: [35, 330] })).toBe(null)
    expect(r.step({ dists: [35, 260] })).toBe(null)
    expect(r.step({ dists: [105, 190] })?.reason).toBe('passed')
  })

  it('lookahead: GPS jumped to the following PIN → it plays, the missed one is passed silently', () => {
    const r = makeRunner(['a', 'b', 'c'])
    r.step({ dists: [50, 130, 400] })
    const d = r.step({ dists: [70, 8, 300] })
    expect(d?.reason).toBe('lookahead')
    expect(d?.index).toBe(1)
    expect(d?.skipped).toEqual([0])
    expect(r.played).toEqual(['b'])
    expect(r.triggered.has('a')).toBe(true) // 'missed PIN must not block the sequence'
  })

  it('no skipping when the expected PIN was never approached (loops / overlapping streets)', () => {
    const r = makeRunner(['a', 'b', 'c'])
    expect(r.step({ dists: [500, 600, 10] })).toBe(null)
    expect(r.step({ dists: [500, 5, 400] })).toBe(null)
    expect(r.played).toEqual([])
  })

  it('lookahead is limited to the next 2 PINs', () => {
    const r = makeRunner(['a', 'b', 'c', 'd'])
    r.step({ dists: [50, 400, 400, 400] })
    expect(r.step({ dists: [90, 400, 400, 5] })).toBe(null)
  })

  it('busy defers playback but not tracking; nothing is lost afterwards', () => {
    const r = makeRunner(['a'])
    expect(r.step({ dists: [10] }, true)).toBe(null)
    expect(r.step({ dists: [10] })?.reason).toBe('in-range')
  })

  it('duplicate prevention: a triggered PIN is never returned again', () => {
    const r = makeRunner(['a', 'b'])
    r.step({ dists: [5, 300] })
    for (let i = 0; i < 5; i++) expect(r.step({ dists: [5, 300] })).toBe(null)
    expect(r.played).toEqual(['a'])
  })

  it('all PINs triggered → nothing to do', () => {
    const r = makeRunner(['a'])
    r.step({ dists: [1] })
    expect(r.step({ dists: [1] })).toBe(null)
  })

  it('simulated drives: every PIN voice plays exactly once, in order, at many speeds', () => {
    const pinPos = [200, 420, 640, 700, 1000, 1500]
    const ids = pinPos.map((_, i) => 'p' + i)
    for (const speed of [3, 8, 14, 22, 30, 45, 60, 70]) {
      const r = makeRunner(ids)
      for (let x = 0; x < 1900; x += speed) {
        r.step({ dists: pinPos.map((p) => Math.abs(p - x)) })
      }
      expect(r.played).toEqual(ids) // 'speed ' + speed + ' m per fix'
    }
  })

  it('simulated drive with GPS dropouts (random gaps) never loses or repeats a voice', () => {
    const pinPos = [150, 400, 650, 900]
    const ids = pinPos.map((_, i) => 'p' + i)
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let run = 0; run < 200; run++) {
      const r = makeRunner(ids)
      let x = 0
      while (x < 1300) {
        x += 8 + rnd() * 55
        r.step({ dists: pinPos.map((p) => Math.abs(p - x)) })
      }
      expect(r.played).toEqual(ids) // 'run ' + run
    }
  })
})

describe('segment approach (GPS gap between two fixes)', () => {
  const LAT0 = 41.93
  const LNG0 = 45.47
  const M_LAT = 110540
  const M_LNG = 111320 * Math.cos((LAT0 * Math.PI) / 180)
  const at = (east: number, north: number, t: number): TimedFix => ({ lat: LAT0 + north / M_LAT, lng: LNG0 + east / M_LNG, t })
  const pinAt = (east: number, north: number): [number, number] => [LAT0 + north / M_LAT, LNG0 + east / M_LNG]
  const distM = (a: TimedFix, p: readonly [number, number]) =>
    Math.hypot((a.lng - p[1]) * M_LNG, (a.lat - p[0]) * M_LAT)

  it('constants: 60 s gap, 1000 m length, 25 m closeness', () => {
    expect(AUDIO_SEGMENT_MAX_GAP_MS).toBe(60000)
    expect(AUDIO_SEGMENT_MAX_LENGTH_M).toBe(1000)
    expect(AUDIO_SEGMENT_NEAR_M).toBe(25)
  })

  it('movement passing right over the PIN between two fixes is detected', () => {
    const d = segmentApproachMeters(at(-80, 0, 0), at(80, 0, 10000), pinAt(0, 6))
    expect(d).not.toBeNull()
    expect(d!).toBeCloseTo(6, 0)
  })

  it('recovers the expected PIN after a plausible 30-second GPS outage', () => {
    const d = segmentApproachMeters(at(-100, 0, 0), at(100, 0, 30000), pinAt(0, 5))
    expect(d).not.toBeNull()
    expect(d!).toBeCloseTo(5, 0)
  })

  it('GPS gap: PIN passed unseen between two fixes → the existing passed rule plays it once, late', () => {
    const pin = pinAt(0, 5)
    const next = pinAt(400, 0)
    const ids = ['a', 'b']
    const triggered = new Set<string>()
    const minDist = new Map<string, number>()
    const fixes = [at(-200, 0, 0), at(-120, 0, 10000), at(120, 0, 20000), at(160, 0, 21000), at(200, 0, 22000)]
    const played: string[] = []
    let prev: TimedFix | null = null
    for (const f of fixes) {
      const nextIdx = ids.findIndex((id) => !triggered.has(id))
      if (nextIdx >= 0) recordSegmentApproach(minDist, ids[nextIdx], prev, f, nextIdx === 0 ? pin : next)
      const d = decidePinAudio({
        pinIds: ids,
        triggered,
        distanceTo: (i) => distM(f, i === 0 ? pin : next),
        headingOkAt: () => true,
        minDist,
      })
      if (d) {
        triggered.add(ids[d.index])
        played.push(ids[d.index])
      }
      prev = f
    }
    expect(played).toEqual(['a'])
  })

  it('without the segment record the same gap leaves the PIN unplayed (baseline)', () => {
    const pin = pinAt(0, 5)
    const minDist = new Map<string, number>()
    const triggered = new Set<string>()
    for (const f of [at(-200, 0, 0), at(-120, 0, 10000), at(120, 0, 20000), at(160, 0, 21000)]) {
      const d = decidePinAudio({
        pinIds: ['a', 'b'],
        triggered,
        distanceTo: (i) => (i === 0 ? distM(f, pin) : 9999),
        headingOkAt: () => true,
        minDist,
      })
      expect(d).toBeNull()
    }
  })

  it('opposite direction: PIN behind the start of the movement is not an approach', () => {
    expect(segmentApproachMeters(at(10, 0, 0), at(110, 0, 8000), pinAt(-5, 2))).toBeNull()
    expect(segmentApproachMeters(at(80, 0, 0), at(-80, 0, 10000), pinAt(100, 3))).toBeNull()
  })

  it('PIN on another road (more than 25 m beside the movement) is not an approach', () => {
    expect(segmentApproachMeters(at(-80, 0, 0), at(80, 0, 10000), pinAt(0, 40))).toBeNull()
    expect(segmentApproachMeters(at(-80, 0, 0), at(80, 0, 10000), pinAt(0, -26))).toBeNull()
  })

  it('movement over 1000 m is not trusted', () => {
    expect(segmentApproachMeters(at(-600, 0, 0), at(600, 0, 60000), pinAt(0, 3))).toBeNull()
    expect(segmentApproachMeters(at(-400, 0, 0), at(400, 0, 60000), pinAt(0, 3))).not.toBeNull()
  })

  it('GPS jump (implied speed above 40 m/s) is not a drive and not an approach', () => {
    expect(segmentApproachMeters(at(-100, 0, 0), at(100, 0, 1000), pinAt(0, 3))).toBeNull()
    expect(segmentApproachMeters(at(-100, 0, 0), at(100, 0, 5000), pinAt(0, 3))).not.toBeNull()
    expect(AUDIO_SEGMENT_MAX_SPEED_MPS).toBe(40)
  })

  it('long fix gap (over 60 s), equal or reversed timestamps, and zero movement are not trusted', () => {
    expect(segmentApproachMeters(at(-80, 0, 0), at(80, 0, 60001), pinAt(0, 3))).toBeNull()
    expect(segmentApproachMeters(at(-80, 0, 0), at(80, 0, 60000), pinAt(0, 3))).not.toBeNull()
    expect(segmentApproachMeters(at(-80, 0, 5000), at(80, 0, 5000), pinAt(0, 3))).toBeNull()
    expect(segmentApproachMeters(at(-80, 0, 9000), at(80, 0, 1000), pinAt(0, 3))).toBeNull()
    expect(segmentApproachMeters(at(0, 0, 0), at(0, 0, 5000), pinAt(0, 3))).toBeNull()
  })

  it('first fix (no previous) records nothing; duplicate records keep only the closest value', () => {
    const m = new Map<string, number>()
    recordSegmentApproach(m, 'a', null, at(0, 0, 0), pinAt(0, 3))
    expect(m.size).toBe(0)
    recordSegmentApproach(m, 'a', at(-80, 0, 0), at(80, 0, 10000), pinAt(0, 12))
    recordSegmentApproach(m, 'a', at(-80, 0, 0), at(80, 0, 10000), pinAt(0, 12))
    recordSegmentApproach(m, 'a', at(-80, 0, 0), at(80, 0, 10000), pinAt(0, 20))
    expect(m.get('a')).toBeCloseTo(12, 0)
  })

  it('the record never touches other PINs: only the expected PIN id is written', () => {
    const m = new Map<string, number>()
    recordSegmentApproach(m, 'expected', at(-80, 0, 0), at(80, 0, 10000), pinAt(0, 4))
    expect([...m.keys()]).toEqual(['expected'])
  })

  it('order and no duplicates: a drive with a mid-route gap plays every PIN once, in order, no lookahead', () => {
    const xs = [100, 300, 500, 700, 900]
    const pins = xs.map((x) => pinAt(x, 3))
    const ids = xs.map((_, i) => 'p' + i)
    const triggered = new Set<string>()
    const minDist = new Map<string, number>()
    const played: { id: string; reason: string }[] = []
    let prev: TimedFix | null = null
    let t = 0
    // 1 s fixes at 20 m/s, but x in (260, 500) is a GPS blackout (240 m, 12 s) that hides p1 at 300
    for (let x = 0; x <= 1100; x += 20) {
      t += 1000
      if (x > 260 && x < 500) continue
      const f = at(x, 0, t)
      const nextIdx = ids.findIndex((id) => !triggered.has(id))
      if (nextIdx >= 0) recordSegmentApproach(minDist, ids[nextIdx], prev, f, pins[nextIdx])
      const d = decidePinAudio({
        pinIds: ids,
        triggered,
        distanceTo: (i) => distM(f, pins[i]),
        headingOkAt: () => true,
        minDist,
      })
      if (d) {
        expect(d.reason).not.toBe('lookahead')
        expect(d.skipped).toEqual([])
        triggered.add(ids[d.index])
        played.push({ id: ids[d.index], reason: d.reason })
      }
      prev = f
    }
    expect(played.map((p) => p.id)).toEqual(ids)
  })

  it('busy audio: a pass recorded during playback is played afterwards, still in order', () => {
    const pin = pinAt(0, 4)
    const minDist = new Map<string, number>()
    const triggered = new Set<string>()
    recordSegmentApproach(minDist, 'a', at(-60, 0, 0), at(60, 0, 9000), pin)
    const fix = at(60, 0, 9000)
    const base = { pinIds: ['a', 'b'], triggered, distanceTo: (i: number) => (i === 0 ? distM(fix, pin) : 9999), headingOkAt: () => true, minDist }
    expect(decidePinAudio({ ...base, busy: true })).toBeNull()
    const d = decidePinAudio({ ...base, busy: false })
    expect(d?.index).toBe(0)
    expect(d?.reason).toBe('passed')
  })
})