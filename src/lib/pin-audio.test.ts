import { describe, it, expect } from 'vitest'
import {
  AUDIO_HEADING_TOLERANCE_DEG,
  AUDIO_TRIGGER_DISTANCE_M,
  audioHeadingOk,
  decidePinAudio,
  type PinAudioDecision,
} from './pin-audio.ts'

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