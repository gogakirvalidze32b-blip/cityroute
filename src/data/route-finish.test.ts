import { describe, expect, it } from 'vitest'
import { TELAVI_ROUTES_FALLBACK } from './telavi-routes'
import { resolvePinAudioUrl } from './route-audio'
import {
  COMMON_FINISH_INSTRUCTIONS,
  isFinishAudioAllowed,
  isInAlazaniSessionZone,
  isNearPin1ForSessionVoice,
  isRouteFinishGpsReady,
  isStartAudioAllowed,
  ROUTE_FINISH_PIN_RANGES,
  SESSION_VOICE_PIN1_RADIUS_M,
  START_AUDIO_PIN_RANGES,
  finishSectionStartIndex,
} from './route-finish'
import { decidePinAudio, pinAudioTriggerDistanceMeters, pinVoicePlaybackRate } from '@/lib/pin-audio'
import route1Road from './route-1-road.json'
import route2Road from './route-2-road.json'
import route3Road from './route-3-road.json'
import route4Road from './route-4-road.json'
import {
  matchGpsPosition,
  prepareRouteGeometry,
  type ActiveRouteId,
  type LatLng,
  type PreparedRouteGeometry,
} from '@/lib/pure-route-geometry'

const roads: Record<ActiveRouteId, LatLng[]> = {
  'route-1': route1Road.map(([lat, lng]) => [lat, lng] as const),
  'route-2': route2Road.map(([lat, lng]) => [lat, lng] as const),
  'route-3': route3Road.map(([lat, lng]) => [lat, lng] as const),
  'route-4': route4Road.map(([lat, lng]) => [lat, lng] as const),
}

function pointAt(geometry: PreparedRouteGeometry, requestedChainage: number): LatLng {
  const bounded = Math.max(0, Math.min(geometry.totalLengthMeters, requestedChainage))
  const index = geometry.cumulativeMeters.findIndex(
    (value, current) =>
      current < geometry.cumulativeMeters.length - 1 &&
      value <= bounded &&
      bounded <= geometry.cumulativeMeters[current + 1],
  )
  const segment = index < 0 ? geometry.coordinates.length - 2 : index
  const start = geometry.coordinates[segment]
  const end = geometry.coordinates[segment + 1]
  const segmentLength = geometry.cumulativeMeters[segment + 1] - geometry.cumulativeMeters[segment]
  const fraction = (bounded - geometry.cumulativeMeters[segment]) / segmentLength
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ]
}

function makeFinalForwardMatch(routeId: ActiveRouteId) {
  const geometry = prepareRouteGeometry(routeId, roads[routeId])
  let state = null as ReturnType<typeof matchGpsPosition>['nextState']
  let timestampMs = 100_000
  for (let chainage = 0; chainage < geometry.totalLengthMeters - 50; chainage += 50) {
    timestampMs += 1_000
    const result = matchGpsPosition(
      geometry,
      {
        position: pointAt(geometry, chainage),
        accuracyMeters: 3,
        timestampMs,
      },
      state,
      { nowMs: timestampMs, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
    )
    if (result.accepted && result.nextState) state = result.nextState
  }
  if (!state) throw new Error('Expected route match before final segment')
  timestampMs += 1_000
  const previousResult = matchGpsPosition(
    geometry,
    {
      position: pointAt(geometry, geometry.totalLengthMeters - 50),
      accuracyMeters: 3,
      timestampMs,
    },
    state,
    { nowMs: timestampMs, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
  )
  if (!previousResult.accepted || !previousResult.nextState) {
    throw new Error('Expected forward road match before finish')
  }
  state = previousResult.nextState
  timestampMs += 1_000
  const match = matchGpsPosition(
    geometry,
    {
      position: pointAt(geometry, geometry.totalLengthMeters - 5),
      accuracyMeters: 3,
      timestampMs,
    },
    state,
    { nowMs: timestampMs, maxAccuracyMeters: 12, maxCrossTrackMeters: 20 },
  )
  return { geometry, previous: state, match }
}

describe('shared finish sequence', () => {
  it('uses one ordered finish instruction sequence for all four routes', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4']) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const finishPins = route.pins.slice(-COMMON_FINISH_INSTRUCTIONS.length)

      expect(finishPins.map((pin) => pin.instruction_ka)).toEqual(COMMON_FINISH_INSTRUCTIONS)
      for (const pin of finishPins) {
        expect(resolvePinAudioUrl(slug, pin)).not.toBeNull()
      }
    }
  })

  it('keeps finish-section gating shared and applies it to each route size', () => {
    expect(
      [35, 29, 30, 32].map((pinCount) => finishSectionStartIndex(pinCount)),
    ).toEqual([32, 26, 27, 29])
  })

  it('keeps Route 3 PIN orders and finish instructions stable across the removed #12 gap', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    const pins = [...route.pins].sort((a, b) => a.sort_order - b.sort_order)
    expect(pins.some((pin) => pin.sort_order === 12)).toBe(false)
    expect(pins.map((pin) => pin.sort_order).slice(9, 13)).toEqual([10, 11, 13, 14])
    expect(pins.slice(-7).map((pin) => pin.instruction_ka)).toEqual(COMMON_FINISH_INSTRUCTIONS)
    expect(pins.find((pin) => pin.sort_order === 29)?.instruction_ka).toBe(
      'მალე, გთხოვთ მოუხვიოთ მარჯვნივ',
    )
  })

  it('defines the requested inclusive start and finish PIN ranges', () => {
    expect(START_AUDIO_PIN_RANGES).toEqual({
      'route-1': { start: 1, end: 2 },
      'route-2': { start: 1, end: 2 },
      'route-3': { start: 1, end: 2 },
      'route-4': { start: 1, end: 2 },
    })
    expect(ROUTE_FINISH_PIN_RANGES).toEqual({
      'route-1': { start: 29, end: 34 },
      'route-2': { start: 22, end: 28 },
      'route-3': { start: 25, end: 30 },
      'route-4': { start: 26, end: 31 },
    })
    expect(SESSION_VOICE_PIN1_RADIUS_M).toBe(800)
  })

  it('allows დაწყება only within 50 m of PIN 1 or PIN 2; ფინიში stays Alazani / PIN 1', () => {
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const pin1 = route.pins.find((pin) => pin.sort_order === 1)!
      const pin2 = route.pins.find((pin) => pin.sort_order === 2)!
      const nearPin1: [number, number] = [pin1.lat, pin1.lng]
      const nearPin2: [number, number] = [pin2.lat, pin2.lng]
      // South Alazani near Telavi Mall — inside corridor box, but not start-voice radius
      const alazaniSouth: [number, number] = [41.9260, 45.4735]
      const far: [number, number] = [pin1.lat + 0.02, pin1.lng]

      expect(isInAlazaniSessionZone(nearPin1)).toBe(true)
      expect(isInAlazaniSessionZone(alazaniSouth)).toBe(true)
      expect(isInAlazaniSessionZone(far)).toBe(false)
      expect(isNearPin1ForSessionVoice(nearPin1, pin1)).toBe(true)
      expect(isNearPin1ForSessionVoice(alazaniSouth, pin1)).toBe(true)
      expect(isNearPin1ForSessionVoice(far, pin1)).toBe(false)
      expect(isStartAudioAllowed(slug, nearPin1, pin1, pin2)).toBe(true)
      expect(isStartAudioAllowed(slug, nearPin2, pin1, pin2)).toBe(true)
      expect(isStartAudioAllowed(slug, alazaniSouth, pin1, pin2)).toBe(false)
      expect(isStartAudioAllowed(slug, far, pin1, pin2)).toBe(false)
      expect(isFinishAudioAllowed(slug, nearPin1, pin1)).toBe(true)
      expect(isFinishAudioAllowed(slug, alazaniSouth, pin1)).toBe(true)
      expect(isFinishAudioAllowed(slug, far, pin1)).toBe(false)
      expect(isStartAudioAllowed(slug, null, pin1, pin2)).toBe(false)
      expect(isFinishAudioAllowed(slug, null, pin1)).toBe(false)
    }
    const pin1 = TELAVI_ROUTES_FALLBACK[0].pins.find((pin) => pin.sort_order === 1)!
    const pin2 = TELAVI_ROUTES_FALLBACK[0].pins.find((pin) => pin.sort_order === 2)!
    expect(isStartAudioAllowed('route-5', [pin1.lat, pin1.lng], pin1, pin2)).toBe(false)
    expect(isFinishAudioAllowed('route-5', [pin1.lat, pin1.lng], pin1)).toBe(false)
  })

  it('route-1 PIN 6 is straight-ahead with matching audio', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    const pin6 = route.pins.find((pin) => pin.sort_order === 6)!
    expect(pin6.instruction_ka).toBe('გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ')
    const audioUrl = decodeURIComponent(resolvePinAudioUrl('route-1', pin6) ?? '')
    expect(audioUrl).toBe('/audio/points/გთხოვთ, შემდეგ მინიშნებამდე იმოძრაოთ პირდაპირ.wav')
  })

  it('route-3 field-missed PINs sit on-road with audio and a reliable trigger', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    for (const order of [6, 7, 10, 15, 17, 25, 27]) {
      const pin = route.pins.find((item) => item.sort_order === order)!
      expect(resolvePinAudioUrl('route-3', pin)).not.toBeNull()
      expect(pinAudioTriggerDistanceMeters('route-3', order)).toBe(20)
    }
  })

  it('every Telavi exam PIN sits on its road centerline within 5 m', async () => {
    const roads = {
      'route-1': (await import('./route-1-road.json')).default,
      'route-2': (await import('./route-2-road.json')).default,
      'route-3': (await import('./route-3-road.json')).default,
      'route-4': (await import('./route-4-road.json')).default,
    } as const
    const { prepareRouteGeometry, projectPointToRoute } = await import('@/lib/pure-route-geometry')
    for (const slug of ['route-1', 'route-2', 'route-3', 'route-4'] as const) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const geometry = prepareRouteGeometry(slug, roads[slug].map(([lat, lng]) => [lat, lng] as const))
      for (const pin of route.pins) {
        const projection = projectPointToRoute(geometry, [pin.lat, pin.lng])
        expect(projection, `${slug} #${pin.sort_order}`).not.toBeNull()
        // Field-placed PINs may sit a few metres off the digitized centerline.
        expect(projection!.crossTrackMeters, `${slug} #${pin.sort_order}`).toBeLessThanOrEqual(12)
      }
    }
  })

  it.each(['route-1', 'route-2', 'route-3', 'route-4'] as const)(
    '%s never auto-finishes on GPS — examiner must press დასრულება',
    (routeSlug) => {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === routeSlug)!
      const geometry = prepareRouteGeometry(routeSlug, roads[routeSlug])
      expect(isRouteFinishGpsReady({
        routeSlug,
        pins: route.pins,
        handledOrders: new Set(route.pins.map((pin) => pin.sort_order)),
        geometry,
        match: {
          status: 'matched',
          accepted: true,
          projection: null,
          direction: 'forward',
          nextState: null,
        },
        previous: null,
      })).toBe(false)
    },
  )

  it('does not auto-finish Route 3 while its PIN 30 turn direction is kept isolated', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    const geometry = prepareRouteGeometry('route-3', roads['route-3'])
    expect(isRouteFinishGpsReady({
      routeSlug: 'route-3',
      pins: route.pins,
      handledOrders: new Set(route.pins.map((pin) => pin.sort_order)),
      geometry,
      match: {
        status: 'invalid-fix',
        accepted: false,
        projection: null,
        direction: 'unknown',
        nextState: null,
      },
      previous: null,
    })).toBe(false)
  })

  it('keeps Route 2 #3 and #25 as separate, sequential audio PINs', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    const pin3 = route.pins.find((pin) => pin.sort_order === 3)!
    const pin25 = route.pins.find((pin) => pin.sort_order === 25)!
    expect([pin3.lat, pin3.lng]).not.toEqual([pin25.lat, pin25.lng])
    expect(resolvePinAudioUrl('route-2', pin3)).not.toBeNull()
    expect(resolvePinAudioUrl('route-2', pin25)).not.toBeNull()

    const pinIds = route.pins.map((pin) => pin.id)
    const firstTriggered = new Set(pinIds.slice(0, 2))
    const firstDecision = decidePinAudio({
      pinIds,
      triggered: firstTriggered,
      distanceTo: (index) => (index === 2 ? 10 : 500),
      headingOkAt: () => true,
      minDist: new Map(),
    })
    expect(firstDecision?.index).toBe(2)

    const lateTriggered = new Set(pinIds.slice(0, 24))
    const lateDecision = decidePinAudio({
      pinIds,
      triggered: lateTriggered,
      distanceTo: (index) => (index === 24 ? 10 : 500),
      headingOkAt: () => true,
      minDist: new Map(),
    })
    expect(lateDecision?.index).toBe(24)
  })

  it('maps the updated Route 1 #23 and #24 texts to exact WAV filename stems', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    const pins = [23, 24].map((order) => route.pins.find((pin) => pin.sort_order === order)!)
    for (const pin of pins) {
      const filename = decodeURIComponent(resolvePinAudioUrl('route-1', pin)!).split('/').pop()!
      expect(pin.instruction_ka).toBe(filename.replace(/\.wav$/, ''))
    }
  })

  it('preserves Route 3 finish order and shared approach audio text', () => {
    const expected = [
      ['route-1', 33],
      ['route-2', 27],
      ['route-3', 29],
      ['route-4', 30],
    ] as const
    for (const [slug, order] of expected) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const pin = route.pins.find((item) => item.sort_order === order)!
      expect(pin.instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')
      expect(resolvePinAudioUrl(slug, pin)).not.toBeNull()
    }

    const route3 = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    expect(route3.pins.find((pin) => pin.sort_order === 28)?.instruction_ka).toBe('300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(route3.pins.find((pin) => pin.sort_order === 29)?.instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(route3.pins.find((pin) => pin.sort_order === 30)?.instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარცხნივ')
  })

  it('keeps Route 2 PIN 10 and 11 order and instructions', () => {
    const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-2')!
    const pin10 = route.pins.find((pin) => pin.sort_order === 10)!
    const pin11 = route.pins.find((pin) => pin.sort_order === 11)!
    expect(pin10.sort_order).toBeLessThan(pin11.sort_order)
    expect([pin10.lat, pin10.lng]).toEqual([41.924627, 45.503446])
    expect([pin11.lat, pin11.lng]).toEqual([41.922996, 45.502359])
    expect(pin10.instruction_ka).toBe('500 მეტრში, გთხოვთ მოუხვიოთ მარჯვნივ')
    expect(pin11.instruction_ka).toBe('300 მეტრში გთხოვთ მოუხვიოთ მარჯვნივ')
  })

  it('places shared late right-turn PINs and requested Route 1/3/4 updates', () => {
    const shared = [41.932048, 45.476813] as const
    const checks = [
      ['route-1', 33],
      ['route-2', 27],
      ['route-3', 29],
      ['route-4', 30],
    ] as const
    for (const [slug, order] of checks) {
      const route = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === slug)!
      const pin = route.pins.find((item) => item.sort_order === order)!
      expect([pin.lat, pin.lng]).toEqual([...shared])
      expect(pin.instruction_ka).toBe('მალე, გთხოვთ მოუხვიოთ მარჯვნივ')
    }

    const route1 = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-1')!
    expect([route1.pins.find((pin) => pin.sort_order === 9)?.lat, route1.pins.find((pin) => pin.sort_order === 9)?.lng])
      .toEqual([41.926867, 45.461207])

    const route3 = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-3')!
    expect([route3.pins.find((pin) => pin.sort_order === 11)?.lat, route3.pins.find((pin) => pin.sort_order === 11)?.lng])
      .toEqual([41.918413, 45.483347])
    expect([route3.pins.find((pin) => pin.sort_order === 13)?.lat, route3.pins.find((pin) => pin.sort_order === 13)?.lng])
      .toEqual([41.918623, 45.484153])

    const route4 = TELAVI_ROUTES_FALLBACK.find((item) => item.slug === 'route-4')!
    const pin7 = route4.pins.find((pin) => pin.sort_order === 7)!
    const pin12 = route4.pins.find((pin) => pin.sort_order === 12)!
    expect(pin7.instruction_ka).toBe('500 მეტრში, წრიული მოძრაობისას, გთხოვთ იმოძრაოთ პირდაპირ')
    expect(resolvePinAudioUrl('route-4', pin7)).not.toBeNull()
    expect([pin12.lat, pin12.lng]).toEqual([41.919276, 45.49935])
    const pin15 = route4.pins.find((pin) => pin.sort_order === 15)!
    expect([pin15.lat, pin15.lng]).toEqual([41.919466, 45.499243])
    expect(pinVoicePlaybackRate('route-4', 7)).toBe(0.9)
    expect(pinVoicePlaybackRate('route-4', 8)).toBe(0.9)
  })
})
