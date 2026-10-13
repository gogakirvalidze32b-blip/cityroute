import { describe, expect, it } from 'vitest'
import fixture from '@/data/audio-audit-pins.fixture.json'
import { distanceToPinMeters, type LatLng } from '@/lib/gps'
import { evaluateNextPin, resolveTriggerDistanceM } from '@/lib/pin-cue'
import { examRoadTrace } from '@/lib/pin-route-line'
import { chooseStartPin, type StartFix, type StartPinInput } from '@/lib/start-pin'

type FixturePin = { route: number; pin: number; lat: number; lng: number }

function routePins(route: number): StartPinInput[] {
  const rows = (fixture as FixturePin[]).filter((p) => p.route === route).sort((a, b) => a.pin - b.pin)
  return rows.map((p, i) => ({
    sort_order: p.pin,
    lat: p.lat,
    lng: p.lng,
    trigger_distance_m: i === 0 || i === rows.length - 1 ? 40 : 50,
  }))
}

const road = (route: number, pins: StartPinInput[]) => examRoadTrace(`route-${route}`, pins)
const pinOf = (pins: StartPinInput[], order: number) => pins.find((p) => p.sort_order === order)!

function bearingDeg(from: LatLng, to: LatLng): number {
  const φ1 = (from[0] * Math.PI) / 180
  const φ2 = (to[0] * Math.PI) / 180
  const Δλ = ((to[1] - from[1]) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const fixAt = (position: LatLng, extra: Partial<StartFix> = {}): StartFix => ({
  position,
  accuracyM: 8,
  headingDeg: null,
  speedMps: 0,
  ...extra,
})

/** Fixes every `stepM` metres along the street trace, heading = direction of travel. */
function driveTrace(line: LatLng[], stepM: number) {
  const fixes: { position: LatLng; heading: number }[] = []
  let carry = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const len = distanceToPinMeters(a, b)
    if (len === 0) continue
    const heading = bearingDeg(a, b)
    let d = carry
    while (d <= len) {
      const t = d / len
      fixes.push({ position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], heading })
      d += stepM
    }
    carry = d - len
  }
  return fixes
}

/** A street point between two consecutive pins, outside both trigger zones. */
function pointBetween(pins: StartPinInput[], line: LatLng[], k: number): LatLng | null {
  const a = pins[k]
  const b = pins[k + 1]
  const leg = distanceToPinMeters([a.lat, a.lng], [b.lat, b.lng])
  let best: { p: LatLng; score: number } | null = null
  for (const fix of driveTrace(line, 5)) {
    const da = distanceToPinMeters(fix.position, [a.lat, a.lng])
    const db = distanceToPinMeters(fix.position, [b.lat, b.lng])
    if (da <= resolveTriggerDistanceM(a.trigger_distance_m) + 5 || db <= resolveTriggerDistanceM(b.trigger_distance_m) + 5) continue
    const score = da + db - leg
    if (!best || score < best.score) best = { p: fix.position, score }
  }
  return best && best.score <= leg * 0.1 + 10 ? best.p : null
}

describe('starting pin for a new exam', () => {
  it('starts at PIN 1 at the agency on all four routes, even where the finish pins are close by', () => {
    for (const route of [1, 2, 3, 4]) {
      const pins = routePins(route)
      const first = pins[0]
      const decision = chooseStartPin(pins, fixAt([first.lat, first.lng]), road(route, pins))
      expect(decision, `route ${route}`).toEqual({ kind: 'start', sortOrder: first.sort_order, basis: 'agency' })
    }
  })

  it('keeps PIN 1 and reports why when GPS accuracy is worse than 20 m', () => {
    for (const route of [1, 2, 3, 4]) {
      const pins = routePins(route)
      const mid = pins[Math.floor(pins.length / 2)]
      expect(chooseStartPin(pins, fixAt([mid.lat, mid.lng], { accuracyM: 21 }), road(route, pins))).toEqual({
        kind: 'fallback',
        reason: 'accuracy',
      })
      expect(chooseStartPin(pins, fixAt([mid.lat, mid.lng], { accuracyM: null }), road(route, pins)).kind).toBe('fallback')
    }
  })

  it('does not place a car that is off the route', () => {
    const pins = routePins(1)
    expect(chooseStartPin(pins, fixAt([41.95, 45.6]), road(1, pins))).toEqual({ kind: 'fallback', reason: 'off-route' })
    expect(chooseStartPin([], fixAt([41.93, 45.47]), null)).toEqual({ kind: 'fallback', reason: 'no-pins' })
  })

  it('starts at the pin the car is standing at when that pin is unique', () => {
    for (const route of [1, 2, 3, 4]) {
      const pins = routePins(route)
      for (const pin of pins.slice(1)) {
        const decision = chooseStartPin(pins, fixAt([pin.lat, pin.lng]), road(route, pins))
        if (decision.kind === 'start') {
          expect(decision.sortOrder, `route ${route} pin ${pin.sort_order}`).toBeLessThanOrEqual(pin.sort_order)
          expect(
            distanceToPinMeters([pin.lat, pin.lng], [pinOf(pins, decision.sortOrder).lat, pinOf(pins, decision.sortOrder).lng]),
          ).toBeLessThanOrEqual(50)
        } else {
          expect(decision.kind, `route ${route} pin ${pin.sort_order}`).toBe('ambiguous')
          if (decision.kind === 'ambiguous') expect(decision.candidates).toContain(pin.sort_order)
        }
      }
    }
  })

  it('never picks a wrong upcoming pin when started between two pins, on all four routes', () => {
    const stats: string[] = []
    for (const route of [1, 2, 3, 4]) {
      const pins = routePins(route)
      const line = road(route, pins)!
      expect(line, `route ${route} street trace`).not.toBeNull()
      let started = 0
      let waited = 0
      let chosen = 0
      for (let k = 0; k + 1 < pins.length; k++) {
        const p = pointBetween(pins, line, k)
        if (!p) continue
        const next = pins[k + 1]
        const standing = chooseStartPin(pins, fixAt(p), line)
        if (standing.kind === 'start') {
          expect(standing.sortOrder, `route ${route} between ${k + 1}-${k + 2} standing`).toBe(next.sort_order)
          started++
          continue
        }
        expect(standing.kind, `route ${route} between ${k + 1}-${k + 2}`).toBe('ambiguous')
        if (standing.kind !== 'ambiguous') continue
        expect(standing.moving).toBe(false)
        expect(standing.candidates).toContain(next.sort_order)
        waited++
        const moving = chooseStartPin(
          pins,
          fixAt(p, { speedMps: 8, headingDeg: bearingDeg(p, [next.lat, next.lng]) }),
          line,
        )
        if (moving.kind === 'start') {
          expect(moving.sortOrder, `route ${route} between ${k + 1}-${k + 2} moving`).toBe(next.sort_order)
        } else {
          expect(moving.kind).toBe('ambiguous')
          if (moving.kind === 'ambiguous') {
            expect(moving.moving).toBe(true)
            expect(moving.candidates).toContain(next.sort_order)
          }
          chosen++
        }
      }
      stats.push(`route ${route}: started ${started}, waited for movement ${waited}, needs on-screen choice ${chosen}`)
    }
    expect(stats).toHaveLength(4)
  })

  it('on a full route 1 drive, a moving start never skips a pin and never stalls on one behind the car', () => {
    const pins = routePins(1)
    const line = road(1, pins)!
    const cuePins = pins.map((p) => ({ id: String(p.sort_order), lat: p.lat, lng: p.lng, trigger_distance_m: p.trigger_distance_m }))
    const fixes = driveTrace(line, 6)

    const cueAt = (i: number, handled: Set<string>) => {
      const step = evaluateNextPin({
        pins: cuePins,
        handledIds: handled,
        inFlightId: null,
        user: fixes[i].position,
        heading: fixes[i].heading,
        speedMps: 8,
        accuracyM: 8,
        approach: null,
      })
      if (step.action === 'play' && step.pinId) handled.add(step.pinId)
    }
    /** Sequential cues from fix `from` to the end of the drive; returns every pin spoken. */
    const driveFrom = (from: number, handled: Set<string>) => {
      for (let i = from; i < fixes.length; i++) cueAt(i, handled)
      return handled
    }

    const spoken = new Set<string>(['1'])
    let checked = 0
    let ambiguous = 0
    for (let i = 0; i < fixes.length; i++) {
      const truth = pins.find((p) => !spoken.has(String(p.sort_order)))
      if (!truth) break
      if (i % 3 === 0) {
        const decision = chooseStartPin(pins, fixAt(fixes[i].position, { speedMps: 8, headingDeg: fixes[i].heading }), line)
        const where = `fix ${i} at ${fixes[i].position.join(',')}, next spoken in a full drive: ${truth.sort_order}`
        if (decision.kind === 'start' && decision.basis !== 'agency') {
          checked++
          // A later pin would skip the ones before it.
          expect(decision.sortOrder, where).toBeLessThanOrEqual(truth.sort_order)
          // An earlier pin is fine only if the car still reaches it: every pin from the start on must play.
          const handled = new Set(pins.filter((p) => p.sort_order < decision.sortOrder).map((p) => String(p.sort_order)))
          expect(driveFrom(i, handled).size, where).toBe(pins.length)
        } else if (decision.kind === 'ambiguous') {
          ambiguous++
          expect(Math.max(...decision.candidates), where).toBeLessThanOrEqual(truth.sort_order)
          const completable = decision.candidates.filter((order) => {
            const handled = new Set(
              pins.filter((p) => p.sort_order < order).map((p) => String(p.sort_order)),
            )
            return driveFrom(i, handled).size === pins.length
          })
          expect(completable, where).not.toHaveLength(0)
        }
      }
      cueAt(i, spoken)
    }
    expect(checked).toBeGreaterThan(100)
    expect(ambiguous).toBeLessThan(checked)
  })

  it('does not guess between route 1 PINs 19 and 24, which are about 5 m apart', () => {
    const pins = routePins(1)
    const line = road(1, pins)!
    const p19 = pinOf(pins, 19)
    const standing = chooseStartPin(pins, fixAt([p19.lat, p19.lng]), line)
    expect(standing.kind).toBe('ambiguous')
    if (standing.kind === 'ambiguous') {
      expect(standing.candidates).toEqual(expect.arrayContaining([19, 24]))
      expect(standing.moving).toBe(false)
    }
    const towards20 = chooseStartPin(
      pins,
      fixAt([p19.lat, p19.lng], { speedMps: 8, headingDeg: bearingDeg([p19.lat, p19.lng], [pinOf(pins, 20).lat, pinOf(pins, 20).lng]) }),
      line,
    )
    const towards25 = chooseStartPin(
      pins,
      fixAt([p19.lat, p19.lng], { speedMps: 8, headingDeg: bearingDeg([p19.lat, p19.lng], [pinOf(pins, 25).lat, pinOf(pins, 25).lng]) }),
      line,
    )
    // On the pin and moving away: that pin or the one after it, never the other pass.
    if (towards20.kind === 'start') expect([19, 20]).toContain(towards20.sortOrder)
    else expect(towards20.kind).toBe('ambiguous')
    if (towards25.kind === 'start') expect([24, 25]).toContain(towards25.sortOrder)
    else expect(towards25.kind).toBe('ambiguous')
  })
})
