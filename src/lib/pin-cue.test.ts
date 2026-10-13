import { describe, expect, it } from 'vitest'
import { isStartPinAlreadyAnnounced, EXAM_START_AUDIO, EXAM_FINISH_AUDIO, EXAM_SUCCESS_AUDIO, resolvePinAudioUrl } from '@/data/route-audio'
import {
  evaluateNextPin,
  gpsFixCanConfirmPin,
  remapTriggeredPinIds,
  restoreTriggeredPinIds,
  resolveTriggerDistanceM,
  TRIGGER_FALLBACK_M,
  type CuePin,
  type PinApproach,
} from '@/lib/pin-cue'
import type { PinRow } from '@/types/database'
import type { LatLng } from '@/lib/gps'

const PIN: CuePin = { id: 'a', lat: 41.93, lng: 45.47, trigger_distance_m: 50 }
const NEXT: CuePin = { id: 'b', lat: 41.931, lng: 45.47, trigger_distance_m: 50 }

function step(
  user: LatLng,
  pins: CuePin[],
  handled: Set<string>,
  approach: PinApproach | null,
  extra?: { heading?: number | null; speedMps?: number | null; accuracyM?: number | null; inFlightId?: string | null },
) {
  return evaluateNextPin({
    pins,
    handledIds: handled,
    inFlightId: extra?.inFlightId ?? null,
    user,
    heading: extra?.heading === undefined ? null : extra.heading,
    speedMps: extra?.speedMps ?? null,
    accuracyM: extra?.accuracyM ?? null,
    approach,
  })
}

describe('trigger distance', () => {
  it('uses the pin radius and does not play early for speed or GPS error', () => {
    expect(resolveTriggerDistanceM(50, 0, 0)).toBe(50)
    expect(resolveTriggerDistanceM(50, 10, 0)).toBe(50)
    expect(resolveTriggerDistanceM(50, 0, 40)).toBe(50)
    expect(resolveTriggerDistanceM(50, 100, 100)).toBe(50)
    expect(gpsFixCanConfirmPin(80, 50)).toBe(false)
    expect(gpsFixCanConfirmPin(20, 50)).toBe(true)
  })

  it('falls back when the configured radius is missing or unusable, and does not shrink a valid one', () => {
    expect(resolveTriggerDistanceM(null, 0, 0)).toBe(TRIGGER_FALLBACK_M)
    expect(resolveTriggerDistanceM(undefined, 0, 0)).toBe(TRIGGER_FALLBACK_M)
    expect(resolveTriggerDistanceM(5, 0, 0)).toBe(TRIGGER_FALLBACK_M)
    expect(resolveTriggerDistanceM(150, 0, 0)).toBe(150)
  })
})

describe('pin sequence', () => {
  it('does not play before the trigger zone, even at speed', () => {
    const user: LatLng = [PIN.lat + 0.00055, PIN.lng]
    const decision = step(user, [PIN], new Set(), null, { speedMps: 25, accuracyM: 10 })
    expect(decision.triggerM).toBe(50)
    expect(decision.distanceM!).toBeGreaterThan(50)
    expect(decision.action).not.toBe('play')
  })

  it('plays only after the fix is inside the zone and accurate enough', () => {
    const inside = step([PIN.lat, PIN.lng], [PIN], new Set(), null, { accuracyM: 12, speedMps: 20 })
    const coarse = step([PIN.lat, PIN.lng], [PIN], new Set(), null, { accuracyM: 80 })
    expect(inside.action).toBe('play')
    expect(inside.pinId).toBe('a')
    expect(coarse.action).toBe('wait')
  })

  it('plays only the next pin, even when a later pin is closer', () => {
    const far: CuePin = { id: 'far', lat: 41.95, lng: 45.47, trigger_distance_m: 40 }
    const near: CuePin = { id: 'near', lat: 41.93, lng: 45.47, trigger_distance_m: 40 }
    const decision = step([41.93, 45.47], [far, near], new Set(), null)
    expect(decision.pinId).toBe('far')
    expect(decision.action).toBe('wait')
  })

  it('does not repeat a pin that was already spoken', () => {
    const decision = step([41.93, 45.47], [PIN], new Set(['a']), null)
    expect(decision.action).toBe('wait')
    expect(decision.pinId).toBeNull()
  })

  it('waits while that pin is already in flight so the phrase is not started twice', () => {
    const decision = step([PIN.lat, PIN.lng], [PIN], new Set(), null, { inFlightId: 'a' })
    expect(decision.action).toBe('wait')
    expect(decision.pinId).toBe('a')
  })

  it('retries a pin that is still in range when playback has not started', () => {
    const first = step([PIN.lat, PIN.lng], [PIN], new Set(), null)
    const retry = step([PIN.lat, PIN.lng], [PIN], new Set(), first.approach)
    expect(first.action).toBe('play')
    expect(retry.action).toBe('play')
  })

  it('does not skip the next pin when the car passes on a parallel road', () => {
    const handled = new Set<string>()
    let approach: PinApproach | null = null
    const headingAwayFromNorth = 90
    const samples: LatLng[] = [
      [41.9288, 45.47],
      [41.92955, 45.47],
      [41.9298, 45.47],
      [41.9304, 45.47],
      [41.9308, 45.47],
    ]
    for (const user of samples) {
      const decision = step(user, [PIN, NEXT], handled, approach, { heading: headingAwayFromNorth })
      approach = decision.approach
      expect(decision.action).not.toBe('skip')
      expect(decision.pinId).toBe('a')
    }
    expect(handled.has('a')).toBe(false)

    const stillNext = step([NEXT.lat, NEXT.lng], [PIN, NEXT], handled, approach, { heading: headingAwayFromNorth })
    expect(stillNext.pinId).toBe('a')
    expect(stillNext.action).not.toBe('play')
  })

  it('does not skip a pin when the GPS fix is coarser than the trigger', () => {
    const handled = new Set<string>()
    let approach: PinApproach | null = null
    const samples: LatLng[] = [
      [PIN.lat, PIN.lng],
      [PIN.lat + 0.001, PIN.lng],
      [PIN.lat + 0.002, PIN.lng],
    ]
    for (const user of samples) {
      const decision = step(user, [PIN, NEXT], handled, approach, { accuracyM: 80, heading: 90 })
      approach = decision.approach
      expect(decision.action).toBe('wait')
      expect(decision.pinId).toBe('a')
    }
    expect(handled.size).toBe(0)
  })
})

describe('session pin ids', () => {
  it('does not treat route 1 pin p1-1 as already announced', () => {
    expect(isStartPinAlreadyAnnounced('route-1', 'p1-1')).toBe(false)
    expect(isStartPinAlreadyAnnounced('route-2', 'p2-1')).toBe(false)
  })

  it('remaps a restored local id onto the live pin with the same sort order', () => {
    const pins = [
      { id: 'uuid-1', sort_order: 1 },
      { id: 'uuid-2', sort_order: 2 },
    ]
    const mapped = remapTriggeredPinIds(['p1-1', 'uuid-2', 'p2-1', 'other'], pins, 'route-1')
    expect([...mapped].sort()).toEqual(['uuid-1', 'uuid-2'])
    const route3 = remapTriggeredPinIds(['p2-1', 'p2-8', 'p3-2'], pins, 'route-3')
    expect([...route3]).toEqual(['uuid-2'])
  })

  it('keeps saved supabase ids while the loaded list is still the other route namespace', () => {
    const localPins = [
      { id: 'p1-1', sort_order: 1 },
      { id: 'p1-2', sort_order: 2 },
    ]
    const saved = ['784f8b0a-b9d4-4959-a82f-23949e296ee5', '7fc58df9-a3db-4c84-81c6-0d5f2b566293']
    expect([...restoreTriggeredPinIds(saved, [], 'route-1')]).toEqual(saved)
    expect([...restoreTriggeredPinIds(saved, localPins, 'route-1')]).toEqual(saved)

    const live = [
      { id: saved[0], sort_order: 1 },
      { id: saved[1], sort_order: 2 },
    ]
    expect([...restoreTriggeredPinIds(saved, live, 'route-1')].sort()).toEqual([...saved].sort())
    expect([...restoreTriggeredPinIds(['p1-1'], live, 'route-1')]).toEqual([saved[0]])
  })
})

describe('start and finish clips', () => {
  it('points the session chimes at the local wav files', () => {
    expect(decodeURI(EXAM_START_AUDIO)).toBe('/audio/დაწყება.wav')
    expect(decodeURI(EXAM_FINISH_AUDIO)).toBe('/audio/ფინიში.wav')
    expect(decodeURI(EXAM_SUCCESS_AUDIO)).toBe('/audio/გილოცავთ.wav')
  })

  it('plays the finish pin in sequence and resolves ფინიში.wav', () => {
    const finish: CuePin = { id: 'end', lat: 41.93, lng: 45.47, trigger_distance_m: 40 }
    const decision = step([finish.lat, finish.lng], [finish], new Set(), null)
    expect(decision.action).toBe('play')
    const url = resolvePinAudioUrl('route-1', {
      id: 'end',
      instruction_ka: 'ფინიში',
      audio_url: null,
    } as PinRow)
    expect(decodeURI(url!)).toBe('/audio/ფინიში.wav')
  })
})
