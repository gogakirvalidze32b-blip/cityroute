import { afterEach, describe, expect, it } from 'vitest'
import route1Official from '@/data/route-1-official.json'
import { createExamSession } from '@/lib/exam-session'
import { clearActiveExam, describeSavedExam, loadActiveExam, saveActiveExam } from '@/lib/exam-persistence'
import { evaluateNextPin } from '@/lib/pin-cue'
import {
  decideExamStart,
  examProgress,
  resolveExamResume,
  RESUME_PENDING_MESSAGE,
  RESUME_UNRESOLVED_MESSAGE,
} from '@/lib/route-resume'
import { resolvePinAudioUrl } from '@/data/route-audio'
import type { PinRow } from '@/types/database'
import type { LatLng } from '@/lib/gps'

const route1Pins = route1Official.manoeuvres.map((m, index) => ({
  id: `p1-${index + 1}`,
  lat: m.lat,
  lng: m.lng,
  sort_order: index + 1,
  trigger_distance_m: m.type === 'start' || m.type === 'finish' ? 40 : 50,
}))

function handledThrough(order: number) {
  return new Set(route1Pins.filter((pin) => pin.sort_order <= order).map((pin) => pin.id))
}

describe('saved exam progress', () => {
  afterEach(() => {
    clearActiveExam()
  })

  it('keeps the saved next pin when the car is at pin 6, and does not choose pin 4', () => {
    const saved = examProgress(route1Pins, handledThrough(5))
    expect(saved.lastPassedPinId).toBe('p1-5')
    expect(saved.nextPinId).toBe('p1-6')

    const pin6 = route1Pins[5]
    const atPin6: LatLng = [pin6.lat, pin6.lng]
    const resumed = examProgress(route1Pins, handledThrough(5))
    expect(resumed.nextPinId).toBe('p1-6')
    expect(resumed.nextPinId).not.toBe('p1-4')
    expect(atPin6).toEqual([pin6.lat, pin6.lng])
  })

  it('does not select an earlier pin from pin 6 when no pin has been passed yet', () => {
    const fresh = examProgress(route1Pins, new Set())
    expect(fresh.lastPassedPinId).toBeNull()
    expect(fresh.nextPinId).toBe('p1-1')
  })

  it('does not replay a pin that was already passed', () => {
    const progress = examProgress(route1Pins, handledThrough(5))
    const passed = route1Pins.find((pin) => pin.id === progress.lastPassedPinId)!
    const next = route1Pins.find((pin) => pin.id === progress.nextPinId)!
    const decision = evaluateNextPin({
      pins: route1Pins,
      handledIds: handledThrough(5),
      inFlightId: null,
      user: [passed.lat, passed.lng],
      heading: null,
      speedMps: null,
      accuracyM: 8,
      approach: null,
    })
    expect(decision.pinId).toBe(next.id)
    expect(decision.pinId).not.toBe(passed.id)
    expect(decision.action).not.toBe('play')
  })

  it('starts a new exam at the first pin and drops the previous route progress', () => {
    saveActiveExam({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      phase: 'active',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      userPos: [route1Pins[5].lat, route1Pins[5].lng],
      heading: 90,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: ['p1-5'],
      lastPassedPinId: 'p1-5',
      nextPinId: 'p1-6',
      savedAt: Date.now(),
    })
    clearActiveExam()
    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')).toBeNull()
    expect(examProgress(route1Pins, new Set()).nextPinId).toBe('p1-1')
  })

  it('does not copy one route progress onto another route', () => {
    const slugs = ['route-1', 'route-2', 'route-3', 'route-4'] as const
    for (const slug of slugs) {
      const order = Number(slug.slice(-1))
      saveActiveExam({
        routeId: `local-${slug}`,
        routeSlug: slug,
        routeName: slug,
        phase: 'active',
        exam: createExamSession(`local-${slug}`, slug),
        userPos: null,
        heading: 0,
        speedKmh: 0,
        elapsedMs: 10,
        triggeredPins: [`p${order}-2`],
        lastPassedPinId: `p${order}-2`,
        nextPinId: `p${order}-3`,
        savedAt: Date.now(),
      })
      for (const other of slugs) {
        const loaded = loadActiveExam(`local-${other}`, other, other)
        if (other === slug) {
          expect(loaded?.triggeredPins).toEqual([`p${order}-2`])
          expect(loaded?.nextPinId).toBe(`p${order}-3`)
        } else {
          expect(loaded).toBeNull()
        }
      }
    }
  })

  it('keeps route 1 pin triggers on the first unhandled pin', () => {
    const first = route1Pins[0]
    const fourth = route1Pins[3]
    const inside = evaluateNextPin({
      pins: route1Pins,
      handledIds: new Set(),
      inFlightId: null,
      user: [first.lat, first.lng],
      heading: null,
      speedMps: null,
      accuracyM: 8,
      approach: null,
    })
    const atFourth = evaluateNextPin({
      pins: route1Pins,
      handledIds: new Set(),
      inFlightId: null,
      user: [fourth.lat, fourth.lng],
      heading: null,
      speedMps: null,
      accuracyM: 8,
      approach: null,
    })
    const coarse = evaluateNextPin({
      pins: route1Pins,
      handledIds: new Set(),
      inFlightId: null,
      user: [first.lat, first.lng],
      heading: null,
      speedMps: null,
      accuracyM: 80,
      approach: null,
    })
    expect(inside.action).toBe('play')
    expect(inside.pinId).toBe('p1-1')
    expect(atFourth.pinId).toBe('p1-1')
    expect(atFourth.action).not.toBe('play')
    expect(coarse.action).not.toBe('play')
    expect(coarse.pinId).toBe('p1-1')
  })
})

describe('start button resumes only this route', () => {
  afterEach(() => {
    clearActiveExam()
  })

  it('continues from pin 11 when pins 1-10 are already saved', () => {
    const triggered = route1Pins.filter((pin) => pin.sort_order <= 10).map((pin) => pin.id)
    saveActiveExam({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      phase: 'active',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: triggered,
      lastPassedPinId: 'p1-10',
      nextPinId: 'p1-11',
      savedAt: Date.now(),
    })
    const saved = loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')
    expect(decideExamStart(saved)).toBe('resume')
    const progress = examProgress(route1Pins, new Set(saved?.triggeredPins ?? []))
    expect(progress.lastPassedPinId).toBe('p1-10')
    expect(progress.nextPinId).toBe('p1-11')
  })

  it('starts at the first pin when this route has no saved exam', () => {
    expect(decideExamStart(null)).toBe('new')
    expect(examProgress(route1Pins, new Set()).nextPinId).toBe('p1-1')
  })

  it('does not resume route 1 progress on route 2', () => {
    saveActiveExam({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      phase: 'active',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: ['p1-10'],
      lastPassedPinId: 'p1-10',
      nextPinId: 'p1-11',
      savedAt: Date.now(),
    })
    const other = loadActiveExam('local-route-2', 'route-2', 'მარშრუტი 2')
    expect(decideExamStart(other)).toBe('new')
    expect(examProgress(route1Pins, new Set()).nextPinId).toBe('p1-1')
  })

  it('starts a finished exam from the first pin', () => {
    saveActiveExam({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      phase: 'active',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      userPos: null,
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: ['p1-10'],
      lastPassedPinId: 'p1-10',
      nextPinId: 'p1-11',
      savedAt: Date.now(),
    })
    clearActiveExam()
    const saved = loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')
    expect(decideExamStart(saved)).toBe('new')
    expect(examProgress(route1Pins, new Set()).nextPinId).toBe('p1-1')
  })
})

function saveThrough(order: number, nextOrder: number) {
  const triggered = route1Pins.filter((pin) => pin.sort_order <= order).map((pin) => pin.id)
  saveActiveExam({
    routeId: 'local-route-1',
    routeSlug: 'route-1',
    routeName: 'მარშრუტი 1',
    phase: 'active',
    exam: createExamSession('local-route-1', 'მარშრუტი 1'),
    userPos: [route1Pins[0].lat, route1Pins[0].lng],
    heading: 10,
    speedKmh: 0,
    elapsedMs: 15000,
    triggeredPins: triggered,
    lastPassedPinId: `p1-${order}`,
    nextPinId: `p1-${nextOrder}`,
    savedAt: Date.now(),
  })
}

describe('resume from pin 16', () => {
  afterEach(() => {
    clearActiveExam()
  })

  it('continues from pin 16 after pins 1-15 were saved, including a fresh page load', () => {
    saveThrough(15, 16)
    const reloaded = loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')
    const resolution = resolveExamResume(reloaded!, route1Pins, 'route-1')
    expect(resolution.status).toBe('resume')
    if (resolution.status !== 'resume') return
    expect(resolution.lastPassedSortOrder).toBe(15)
    expect(resolution.nextSortOrder).toBe(16)
    expect(resolution.triggeredIds).not.toContain('p1-16')
    expect(resolution.triggeredIds).toHaveLength(15)

    const reopened = loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')
    const again = resolveExamResume(reopened!, route1Pins, 'route-1')
    expect(again.status).toBe('resume')
    if (again.status !== 'resume') return
    expect(again.nextSortOrder).toBe(16)
  })

  it('places a save made with Supabase ids on the local pin list by sort_order', () => {
    const uuid = (order: number) => `00000000-0000-4000-8000-${String(order).padStart(12, '0')}`
    const resolution = resolveExamResume(
      {
        triggeredPins: Array.from({ length: 15 }, (_, i) => uuid(i + 1)),
        triggeredSortOrders: Array.from({ length: 15 }, (_, i) => i + 1),
        lastPassedSortOrder: 15,
        nextSortOrder: 16,
      },
      route1Pins,
      'route-1',
    )
    expect(resolution.status).toBe('resume')
    if (resolution.status !== 'resume') return
    expect(resolution.nextSortOrder).toBe(16)
    expect(resolution.triggeredIds).toEqual(route1Pins.slice(0, 15).map((pin) => pin.id))

    const remote = route1Pins.map((pin) => ({ ...pin, id: uuid(pin.sort_order) }))
    const local = resolveExamResume(
      { triggeredPins: route1Pins.slice(0, 15).map((pin) => pin.id), triggeredSortOrders: null },
      remote,
      'route-1',
    )
    expect(local.status).toBe('resume')
    if (local.status !== 'resume') return
    expect(local.nextSortOrder).toBe(16)
    expect(local.triggeredIds).toEqual(remote.slice(0, 15).map((pin) => pin.id))
  })

  it('continues from pin 21 after pins 1-20 were saved', () => {
    saveThrough(20, 21)
    const saved = loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')!
    const resolution = resolveExamResume(saved, route1Pins, 'route-1')
    expect(resolution.status).toBe('resume')
    if (resolution.status !== 'resume') return
    expect(resolution.lastPassedSortOrder).toBe(20)
    expect(resolution.nextSortOrder).toBe(21)
    expect(resolution.triggeredIds).toHaveLength(20)
  })

  it('reports an error for a gap or a next pin that disagrees with the handled pins', () => {
    const gap = resolveExamResume(
      { triggeredPins: [], triggeredSortOrders: [1, 2, 4] },
      route1Pins,
      'route-1',
    )
    expect(gap).toEqual({ status: 'error', message: RESUME_UNRESOLVED_MESSAGE })

    const wrongNext = resolveExamResume(
      { triggeredPins: [], triggeredSortOrders: [1, 2, 3], nextSortOrder: 1 },
      route1Pins,
      'route-1',
    )
    expect(wrongNext).toEqual({ status: 'error', message: RESUME_UNRESOLVED_MESSAGE })

    const unknownOrder = resolveExamResume(
      { triggeredPins: [], triggeredSortOrders: [1, 999] },
      route1Pins,
      'route-1',
    )
    expect(unknownOrder.status).toBe('error')
  })

  it('plays only pin 16 when the car is already next to it', () => {
    const handled = handledThrough(15)
    const pin16 = route1Pins[15]
    const decision = evaluateNextPin({
      pins: route1Pins,
      handledIds: handled,
      inFlightId: null,
      user: [pin16.lat, pin16.lng],
      heading: null,
      speedMps: null,
      accuracyM: 8,
      approach: null,
    })
    expect(decision.action).toBe('play')
    expect(decision.pinId).toBe('p1-16')
    expect(handled.has('p1-16')).toBe(false)
    for (const pin of route1Pins.filter((item) => item.sort_order <= 15)) {
      expect(decision.pinId).not.toBe(pin.id)
    }
    const instruction = route1Official.manoeuvres[15].instruction
    const row = {
      id: 'p1-16',
      route_id: 'r',
      lat: pin16.lat,
      lng: pin16.lng,
      radius_m: 25,
      trigger_distance_m: pin16.trigger_distance_m,
      instruction_ka: instruction,
      audio_url: null,
      sort_order: 16,
      active: true,
    } as PinRow
    expect(decodeURI(resolvePinAudioUrl('route-1', row)!)).toBe(`/audio/points/${instruction}.wav`)
    expect(pin16.lat).toBe(route1Official.manoeuvres[15].lat)
    expect(pin16.lng).toBe(route1Official.manoeuvres[15].lng)
  })

  it('does not skip pin 16 when GPS is coarse, far away, or the fix is missing', () => {
    const handled = handledThrough(15)
    const pin16 = route1Pins[15]
    const coarse = evaluateNextPin({
      pins: route1Pins,
      handledIds: handled,
      inFlightId: null,
      user: [pin16.lat, pin16.lng],
      heading: null,
      speedMps: null,
      accuracyM: 500,
      approach: null,
    })
    const far = evaluateNextPin({
      pins: route1Pins,
      handledIds: handled,
      inFlightId: null,
      user: [pin16.lat + 0.5, pin16.lng + 0.5],
      heading: null,
      speedMps: null,
      accuracyM: 8,
      approach: null,
    })
    expect(coarse.action).toBe('wait')
    expect(coarse.pinId).toBe('p1-16')
    expect(far.action).toBe('wait')
    expect(far.pinId).toBe('p1-16')
    expect(handled.size).toBe(15)
    expect([...handled]).not.toContain('p1-16')
  })

  it('does not treat an unreadable save as a new exam at pin 1', () => {
    localStorage.setItem('cityroute-active-exam', '{not-json')
    const described = describeSavedExam('local-route-1', 'route-1', 'მარშრუტი 1')
    expect(described.kind).toBe('corrupt')
    expect(loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')).toBeNull()
    expect(RESUME_UNRESOLVED_MESSAGE).toContain('PIN 1')
  })

  it('does not choose pin 1 when saved progress arrives before the pin list', () => {
    const resolution = resolveExamResume(
      { triggeredPins: [], triggeredSortOrders: Array.from({ length: 15 }, (_, i) => i + 1), nextSortOrder: 16 },
      [],
      'route-1',
    )
    expect(resolution.status).toBe('resume')
    if (resolution.status !== 'resume') return
    expect(resolution.handledOrders).toHaveLength(15)
    expect(resolution.nextSortOrder).toBe(16)
    expect(resolution.triggeredIds).toEqual([])
  })

  it('waits instead of guessing pin 1 when an old id-only save does not match this pin list yet', () => {
    saveActiveExam({
      routeId: 'local-route-1',
      routeSlug: 'route-1',
      routeName: 'მარშრუტი 1',
      phase: 'active',
      exam: createExamSession('local-route-1', 'მარშრუტი 1'),
      userPos: [route1Pins[15].lat, route1Pins[15].lng],
      heading: 0,
      speedKmh: 0,
      elapsedMs: 1000,
      triggeredPins: ['784f8b0a-b9d4-4959-a82f-23949e296ee5'],
      lastPassedPinId: '784f8b0a-b9d4-4959-a82f-23949e296ee5',
      nextPinId: '7fc58df9-a3db-4c84-81c6-0d5f2b566293',
      savedAt: Date.now(),
    })
    const saved = loadActiveExam('local-route-1', 'route-1', 'მარშრუტი 1')!
    const resolution = resolveExamResume(saved, route1Pins, 'route-1')
    expect(resolution).toEqual({ status: 'pending', message: RESUME_PENDING_MESSAGE })
    expect(route1Pins[0].id).toBe('p1-1')
    expect(saved.triggeredPins).toEqual(['784f8b0a-b9d4-4959-a82f-23949e296ee5'])
  })
})
